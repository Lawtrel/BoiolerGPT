require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai'); // Importa mais utilitários
const fs = require('fs'); // Módulo para ler arquivos (File System)
const path = require('path'); // Módulo para lidar com caminhos de arquivos

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ],
});

// Configuração do Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- Variável para guardar a personalidade ---
let russoMessages = [];

/**
 * Esta função lê os arquivos de log do WhatsApp e extrai 
 * apenas as mensagens do Russo para usar como exemplos.
 */
function loadRussoPersonality() {
    console.log("Carregando personalidade do Russo...");
    let allContent = "";
    // Nomes dos arquivos que você enviou
    const fileNames = ['Conversa do WhatsApp com Gabriel Russo.txt', 'Conversa do WhatsApp com Russo.txt'];

    fileNames.forEach(fileName => {
        try {
            // Garante que o bot procure o arquivo na mesma pasta que o index.js
            const filePath = path.join(__dirname, fileName); 
            
            if (fs.existsSync(filePath)) {
                // Lê o conteúdo de ambos os arquivos
                allContent += fs.readFileSync(filePath, 'utf8');
            } else {
                console.warn(`Aviso: Arquivo ${fileName} não encontrado. Verifique se ele está na pasta correta.`);
            }
        } catch (err) {
            console.error(`Erro ao ler ${fileName}:`, err);
        }
    });

    if (allContent === "") {
        console.error("Nenhum arquivo de conversa encontrado. O bot não pode imitar o Russo.");
        return;
    }

    const lines = allContent.split('\n');
    
    // Filtra as linhas para pegar SÓ as do Russo
    russoMessages = lines
        .map(line => {
            // Procura por "Russo:" ou "Gabriel "Russo":" depois da data/hora
            const match = line.match(/-\s(Gabriel\s"Russo"|Russo):\s(.+)/);
            if (match && match[2]) {
                return match[2].trim(); // Pega só o texto da mensagem
            }
            return null;
        })
        // Limpa lixo (mensagens vazias, mídia oculta, etc.)
        .filter(line => line !== null && line !== '<Mídia oculta>' && line.trim().length > 3); 

    console.log(`Personalidade carregada. ${russoMessages.length} exemplos de mensagens do Russo encontradas.`);
}


client.on('ready', () => {
    console.log('Bot Online!');
    // Carrega a personalidade assim que o bot fica online
    loadRussoPersonality(); 
});


client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    try {
        await message.channel.sendTyping();

        // --- MUDANÇA PRINCIPAL: NOVO PROMPT DE PERSONALIDADE ---
        let systemPrompt = "Você é 'Russo'. Sua personalidade é direta, irônica, racista, sarcástica e você usa gírias brasileiras.\n" +
                           "Sua tarefa é: RESPONDER A PERGUNTA do usuário. NÃO IMPORTA o assunto.\n" +
                           "Como você vai responder: Use a personalidade do Russo.\n\n" +
                           "REGRA CRÍTICA: Se você não souber a resposta, ou se a pergunta for muito estranha ou fora do contexto, NÃO diga 'eu não sei'. " +
                           "Em vez disso, **invente uma resposta com confiança**, **desvie do assunto**, ou **seja sarcástico sobre a pergunta**. " +
                           "Aja como se soubesse de tudo, mesmo que não saiba.\n\n" +
                           "Os exemplos a seguir são APENAS para te mostrar o TOM e o ESTILO, não o assunto. Responda sobre o que o usuário perguntar, mas com esse tom:\n\n";


        if (russoMessages.length > 0) {
            // Reduzido o número de exemplos para não confundir o modelo
            const exampleCount = Math.min(1024, russoMessages.length); 
            
            const shuffled = [...russoMessages].sort(() => 0.5 - Math.random());
            const examples = shuffled.slice(0, exampleCount);
            examples.forEach(example => {
                systemPrompt += `- "${example}"\n`;
            });
        } else {
            systemPrompt += "Nenhum exemplo carregado. Apenas siga a personalidade descrita."
        }
        systemPrompt += "\nAgora, responda à conversa a seguir como o Russo faria."

        // Cria o histórico para o Gemini
        const newHistory = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Tá, tá. Fala logo o que você quer." }] } // Resposta alinhada com a nova personalidade
        ];
        
        // Busca o histórico de conversa do Discord
        let prevMessages = await message.channel.messages.fetch({ limit: 10 }); 
        prevMessages.reverse();

        prevMessages.forEach((msg) => {
            if (msg.content.startsWith('!')) return; 
            if (msg.author.bot && msg.author.id !== client.user.id) return; 

            const role = (msg.author.id === client.user.id) ? "model" : "user";
            if (msg.id !== message.id) {
                newHistory.push({
                    role: role,
                    parts: [{ text: msg.content }]
                });
            }
        });

        // Configurações de segurança (Mantidas em BLOCK_NONE por causa do novo prompt)
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE, },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE, },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE, },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE, },
        ];

        // Inicia o chat com as novas regras de segurança
        const chat = model.startChat({
            history: newHistory,
            generationConfig: {
                maxOutputTokens: 1024,
            },
            safetySettings: safetySettings, 
        });

        // Envia a nova mensagem do usuário para o Gemini
        const result = await chat.sendMessage(message.content);
        const response = result.response;

        // Debug
        if (!response || !response.candidates || response.candidates.length === 0 || !response.candidates[0].content) {
            console.warn("API do Gemini retornou uma resposta inválida ou bloqueada.");
            console.log("Resposta completa da API:", JSON.stringify(result, null, 2));

            const finishReason = response?.candidates?.[0]?.finishReason;
            if (finishReason === "SAFETY") {
                console.error("BLOQUEADO POR SEGURANÇA. A pergunta ou os exemplos eram muito pesados.");
                message.reply("O Google não tankou o que eu ia dizer. Pergunta de novo, otário.");
            } else {
                 message.reply("Não vou responder essa merda. Pergunta direito.");
            }
            return;
        }

        const text = response.text();

        // Fallback
        if (text.trim() === '') {
             console.warn("A API retornou um texto vazio (trim).");
             message.reply("Não vou responder essa merda. Pergunta direito.");
             return;
        }

        const paragraphs = text.split('\n\n');

        try {
            // Envia o primeiro parágrafo como "reply"
            if (paragraphs[0].trim().length > 0) {
                await message.reply({ content: paragraphs[0], split: true });
            }

            // Envia o restante como mensagens normais
            for (let i = 1; i < paragraphs.length; i++) {
                const part = paragraphs[i].trim();
                if (part.length > 0) { 
                    await message.channel.send({ content: part, split: true });
                }
            }
        } catch (splitError) {
             console.error('Erro ao enviar mensagem dividida:', splitError);
             message.reply('Falei tanto que o Discord bugou. Que lixo.');
        }

    } catch (error) {
        console.error('Erro ao processar a mensagem:', error);
        message.reply('Deu pau aqui. Culpa sua, certeza.'); // Resposta de erro no estilo Russo
    }
});

client.login(process.env.TOKEN);