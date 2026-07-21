// Core logic for Jennifer Assistant

// State variables
let state = {
    geminiKey: localStorage.getItem('jennifer_gemini_key') || '',
    googleClientId: localStorage.getItem('jennifer_google_client_id') || '',
    accessToken: localStorage.getItem('jennifer_access_token') || '',
    tokenExpiry: localStorage.getItem('jennifer_token_expiry') || '0',
    
    // Drive Folder IDs
    rootFolderId: null,
    memoryFolderId: null,
    chatsFolderId: null,
    filesFolderId: null, // New
    
    // Stored knowledge dictionary
    knowledge: {},
    knowledgeFileId: null,
    
    // Stored files metadata list
    uploadedFiles: [], // New
    selectedAttachment: null, // New
    
    // Chat session
    currentChatId: null,
    chatHistory: [],
    
    // Interface & Voice Settings
    voiceMuted: false,
    isListening: false,
    isThinking: false
};

// Web Speech API interfaces
let recognition = null;
let tokenClient = null;

// Initialize the app on load
window.addEventListener('DOMContentLoaded', () => {
    initUI();
    initSettings();
    initWebSpeech();
    initFileUpload();
    
    // Try to initialize GIS if client ID is already saved
    if (state.googleClientId) {
        setTimeout(initGoogleAuth, 1000);
    }
    
    // Check if token is still valid
    if (state.accessToken && Date.now() < parseInt(state.tokenExpiry)) {
        updateAuthStatus(true);
        initGoogleDrive();
    } else {
        updateAuthStatus(false);
    }
});

// Initialize UI elements and events
function initUI() {
    // Modal controls
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });
    
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });
    
    // Close modal on click outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });
    
    // Save Settings
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    
    // OAuth buttons
    document.getElementById('login-btn').addEventListener('click', loginWithGoogle);
    document.getElementById('logout-btn').addEventListener('click', logoutGoogle);
    
    // Voice Mute Toggle
    const muteBtn = document.getElementById('mute-voice-btn');
    muteBtn.addEventListener('click', () => {
        state.voiceMuted = !state.voiceMuted;
        document.getElementById('voice-on-icon').classList.toggle('hidden', state.voiceMuted);
        document.getElementById('voice-off-icon').classList.toggle('hidden', !state.voiceMuted);
        if (state.voiceMuted) {
            window.speechSynthesis.cancel();
        }
    });
    
    // Message Send Events
    document.getElementById('send-btn').addEventListener('click', handleUserSendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleUserSendMessage();
        }
    });
    
    // Auto-growing textarea
    const textarea = document.getElementById('chat-input');
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight - 4) + 'px';
    });
}

// Load configurations in settings modal
function initSettings() {
    if (state.geminiKey) {
        document.getElementById('gemini-key').value = state.geminiKey;
    }
    if (state.googleClientId) {
        document.getElementById('google-client-id').value = state.googleClientId;
    }
}

// Save inputs from the settings modal
function saveSettings() {
    const key = document.getElementById('gemini-key').value.trim();
    const clientId = document.getElementById('google-client-id').value.trim();
    
    if (!key) {
        alert("Inserisci una chiave API di Gemini valida!");
        return;
    }
    
    const clientChanged = (clientId !== state.googleClientId);
    
    state.geminiKey = key;
    state.googleClientId = clientId;
    
    localStorage.setItem('jennifer_gemini_key', key);
    localStorage.setItem('jennifer_google_client_id', clientId);
    
    document.getElementById('settings-modal').classList.add('hidden');
    
    if (clientId) {
        initGoogleAuth();
        if (clientChanged) {
            // Force re-login with new client ID
            loginWithGoogle();
        }
    }
    
    addMessage("system", "Impostazioni salvate correttamente!");
    updateStatus("online", "Configurato. Pronto per connettere Google Drive.");
}

/* ==========================================
   Google OAuth2 Authentication (GIS)
   ========================================== */

function initGoogleAuth() {
    if (!state.googleClientId || !window.google) return;
    
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: state.googleClientId,
            scope: 'https://www.googleapis.com/auth/drive.file',
            callback: (response) => {
                if (response.error !== undefined) {
                    console.error("Auth error:", response);
                    addMessage("assistant", `Errore di autenticazione Google: ${response.error_description || response.error}`);
                    updateAuthStatus(false);
                    return;
                }
                
                state.accessToken = response.access_token;
                // Tokens usually expire in 3600 seconds (1 hour). Let's set safety buffer.
                const expiryTime = Date.now() + (response.expires_in * 1000) - 60000;
                
                localStorage.setItem('jennifer_access_token', state.accessToken);
                localStorage.setItem('jennifer_token_expiry', expiryTime.toString());
                state.tokenExpiry = expiryTime.toString();
                
                updateAuthStatus(true);
                initGoogleDrive();
            },
        });
    } catch (err) {
        console.error("Failed to initialize Google Identity Client:", err);
    }
}

function loginWithGoogle() {
    if (!state.googleClientId) {
        alert("Inserisci prima il tuo Google Client ID nelle impostazioni!");
        document.getElementById('settings-modal').classList.remove('hidden');
        return;
    }
    
    if (!tokenClient) {
        initGoogleAuth();
    }
    
    if (tokenClient) {
        // Trigger login popup
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Impossibile caricare il client di autenticazione Google. Controlla la tua connessione.");
    }
}

function logoutGoogle() {
    if (state.accessToken) {
        google.accounts.oauth2.revoke(state.accessToken, () => {
            state.accessToken = '';
            state.tokenExpiry = '0';
            localStorage.removeItem('jennifer_access_token');
            localStorage.removeItem('jennifer_token_expiry');
            updateAuthStatus(false);
            addMessage("system", "Account scollegato correttamente.");
            updateStatus("offline", "In attesa di configurazione...");
            document.getElementById('knowledge-list').innerHTML = 
                '<li class="empty-state">Nessuna informazione. Connetti Google Drive per caricarla!</li>';
        });
    }
}

function updateAuthStatus(isConnected) {
    const badge = document.getElementById('auth-status');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (isConnected) {
        badge.innerText = "Google Connesso";
        badge.className = "status-badge connected";
        loginBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        updateStatus("online", "Pronto");
    } else {
        badge.innerText = "Non Connesso a Google";
        badge.className = "status-badge disconnected";
        loginBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
    }
}

/* ==========================================
   Google Drive File API Layer
   ========================================== */

async function makeDriveRequest(url, options = {}) {
    // If token expired, prompt log in
    if (Date.now() >= parseInt(state.tokenExpiry)) {
        updateAuthStatus(false);
        loginWithGoogle();
        throw new Error("Token di accesso Google scaduto. Esegui nuovamente l'accesso.");
    }
    
    if (!options.headers) {
        options.headers = {};
    }
    options.headers['Authorization'] = `Bearer ${state.accessToken}`;
    
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Drive API Error:", errorData);
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }
    return response;
}

// Set up the directory tree in Google Drive
async function initGoogleDrive() {
    updateStatus("thinking", "Inizializzazione cartelle su Google Drive...");
    document.getElementById('knowledge-list-loader').classList.remove('hidden');
    
    try {
        // Find or create Jennifer_Assistant main folder
        state.rootFolderId = await findOrCreateFolder('Jennifer_Assistant');
        
        // Find or create subfolders
        state.memoryFolderId = await findOrCreateFolder('memory', state.rootFolderId);
        state.chatsFolderId = await findOrCreateFolder('chats', state.rootFolderId);
        state.filesFolderId = await findOrCreateFolder('knowledge_files', state.rootFolderId);
        
        // Load compounding knowledge base file (knowledge_base.json)
        await loadKnowledgeBase();
        
        // Load list of files
        await listUploadedFiles();
        
        updateStatus("online", "Pronto ed allineato con Google Drive");
        addMessage("system", "Connessione stabilita con Google Drive! Ho caricato il mio database dei ricordi.");
        
        // Initialize new chat file for this session
        await startNewChatSession();
        
    } catch (err) {
        console.error(err);
        addMessage("assistant", `Errore durante il collegamento con Google Drive: ${err.message}. Prova ad accedere nuovamente.`);
        updateStatus("offline", "Errore di connessione a Drive");
    } finally {
        document.getElementById('knowledge-list-loader').classList.add('hidden');
    }
}

async function findOrCreateFolder(name, parentId = null) {
    let query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) {
        query += ` and '${parentId}' in parents`;
    }
    
    const response = await makeDriveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`);
    const data = await response.json();
    
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    
    // Folder doesn't exist, create it
    const body = {
        name: name,
        mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) {
        body.parents = [parentId];
    }
    
    const createResponse = await makeDriveRequest('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    const folder = await createResponse.json();
    return folder.id;
}

// Load knowledge_base.json from memory folder
async function loadKnowledgeBase() {
    const filename = 'knowledge_base.json';
    let query = `name='${filename}' and '${state.memoryFolderId}' in parents and trashed=false`;
    
    const response = await makeDriveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`);
    const data = await response.json();
    
    if (data.files && data.files.length > 0) {
        state.knowledgeFileId = data.files[0].id;
        const fileContent = await readFileContent(state.knowledgeFileId);
        state.knowledge = typeof fileContent === 'object' ? fileContent : {};
    } else {
        // File doesn't exist, create it empty
        state.knowledge = {};
        state.knowledgeFileId = await writeJsonFile(filename, state.memoryFolderId, state.knowledge);
    }
    
    updateKnowledgeUI();
}

async function readFileContent(fileId) {
    const response = await makeDriveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        return {};
    }
}

async function writeJsonFile(filename, folderId, content) {
    const contentString = JSON.stringify(content, null, 2);
    
    // 1. Create file metadata first
    const metadataBody = {
        name: filename,
        parents: [folderId]
    };
    
    const metadataResponse = await makeDriveRequest('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadataBody)
    });
    
    const fileMetadata = await metadataResponse.json();
    
    // 2. Upload the actual content string
    await makeDriveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileMetadata.id}?uploadType=media`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: contentString
    });
    
    return fileMetadata.id;
}

async function updateFileContent(fileId, content) {
    const contentString = JSON.stringify(content, null, 2);
    await makeDriveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: contentString
    });
}

// Synchronize memory back to Google Drive
async function saveKnowledgeBaseToDrive() {
    if (!state.knowledgeFileId) return;
    try {
        await updateFileContent(state.knowledgeFileId, state.knowledge);
        updateKnowledgeUI();
    } catch (err) {
        console.error("Failed to save knowledge to drive:", err);
    }
}

// Start a new chat session file on Drive
async function startNewChatSession() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `chat_${timestamp}.json`;
    
    const initialSession = {
        created_at: new Date().toISOString(),
        messages: []
    };
    
    try {
        state.currentChatId = await writeJsonFile(filename, state.chatsFolderId, initialSession);
    } catch (err) {
        console.error("Failed to create chat session file:", err);
    }
}

// Append new messages to the current chat session file on Drive
async function appendMessageToSession(role, content, attachment = null) {
    if (!state.currentChatId) return;
    
    state.chatHistory.push({ role, content, attachment });
    
    try {
        const session = {
            created_at: new Date().toISOString(), // Fallback
            messages: state.chatHistory.map(m => ({
                role: m.role,
                text: m.content,
                attachment: m.attachment ? { name: m.attachment.name, mimeType: m.attachment.mimeType } : null,
                timestamp: new Date().toISOString()
            }))
        };
        await updateFileContent(state.currentChatId, session);
    } catch (err) {
        console.error("Failed to update chat session file:", err);
    }
}

// Redraw list of compounding memory topics on the left panel
function updateKnowledgeUI() {
    const list = document.getElementById('knowledge-list');
    list.innerHTML = '';
    
    const keys = Object.keys(state.knowledge);
    
    if (keys.length === 0) {
        list.innerHTML = '<li class="empty-state">Nessuna informazione memorizzata. Parla con Jennifer per insegnarle cose nuove!</li>';
        return;
    }
    
    keys.forEach(key => {
        const item = document.createElement('li');
        item.className = 'knowledge-item';
        item.innerHTML = `
            <span><strong>${key}</strong></span>
            <span class="delete-topic" title="Elimina questo ricordo" data-topic="${key}">&times;</span>
        `;
        
        // Show contents on click
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-topic')) {
                e.stopPropagation();
                deleteKnowledgeTopic(key);
                return;
            }
            alert(`Ricordo: ${key}\n\nContenuto:\n${state.knowledge[key]}`);
        });
        
        list.appendChild(item);
    });
}

// Remove a specific memory item
async function deleteKnowledgeTopic(topic) {
    if (confirm(`Sei sicuro di voler far dimenticare a Jennifer l'argomento "${topic}"?`)) {
        delete state.knowledge[topic];
        await saveKnowledgeBaseToDrive();
        addMessage("system", `Ho dimenticato l'argomento: "${topic}".`);
    }
}

/* ==========================================
   Gemini API Integration & Function Tools
   ========================================== */

async function callGeminiAPI(messages) {
    if (!state.geminiKey) {
        throw new Error("API Key di Gemini non configurata. Inseriscila nelle impostazioni.");
    }
    
    // Inject current compounding knowledge directly into system instruction so Jennifer is always informed!
    let knowledgeSnippet = "";
    if (Object.keys(state.knowledge).length > 0) {
        knowledgeSnippet = "\nEcco i ricordi/informazioni attuali che hai su di me (usali per contestualizzare le risposte):\n";
        for (const [topic, content] of Object.entries(state.knowledge)) {
            knowledgeSnippet += `- ${topic}: ${content}\n`;
        }
    }
    
    const systemPrompt = `Sei Jennifer, una assistente personale amichevole, estremamente intelligente e premurosa.
Comunichi in italiano, in modo fluido, caloroso e naturale.
Hai accesso completo a Google Drive per memorizzare e richiamare informazioni personali sul tuo utente.
Usa i ricordi memorizzati per personalizzare l'esperienza e rispondere a tono, evitando di fare domande su cose che dovresti già sapere.${knowledgeSnippet}

Se l'utente ti comunica informazioni importanti (come passioni, compleanni, preferenze o cose che desidera che tu ricordi nel tempo), usa lo strumento "save_knowledge" per salvarle su Google Drive.

Quando analizzi allegati o documenti (come file PDF o immagini), riassumi ed esponi le informazioni in modo discorsivo e con parole tue. Non citare o copiare ampie porzioni del testo dell'allegato parola per parola per evitare filtri di riproduzione letterale (verbatim).`;

    // Define function declarations (Tools) for Gemini
    const tools = [{
        functionDeclarations: [
            {
                name: "save_knowledge",
                description: "Salva un ricordo permanente o un'informazione importante sul proprietario in Google Drive. Usalo quando l'utente ti comunica dettagli importanti da ricordare nelle chat future.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        topic: {
                            type: "STRING",
                            description: "Il titolo/argomento in formato snake_case (es: compleanno_utente, colore_preferito, cane_nome, orario_palestra)."
                        },
                        content: {
                            type: "STRING",
                            description: "Il contenuto descrittivo dell'informazione da memorizzare."
                        }
                    },
                    required: ["topic", "content"]
                }
            },
            {
                name: "delete_knowledge",
                description: "Rimuove o fa dimenticare un ricordo o un argomento memorizzato su Google Drive.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        topic: {
                            type: "STRING",
                            description: "Il nome dell'argomento da eliminare."
                        }
                    },
                    required: ["topic"]
                }
            }
        ]
    }];

    // Transform chat history to Gemini standard structure
    const contentsPayload = messages.map(msg => {
        const parts = [{ text: msg.content }];
        if (msg.attachment) {
            parts.push({
                inlineData: {
                    mimeType: msg.attachment.mimeType,
                    data: msg.attachment.base64
                }
            });
        }
        return {
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: parts
        };
    });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${state.geminiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: contentsPayload,
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            tools: tools,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 800
            }
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }
    
    return await response.json();
}

// Loop handling sending chats to Gemini, executing tools if recommended, and submitting results back
async function processConversationTurn(userText, attachment = null) {
    if (state.isThinking) return;
    
    // Add user message to UI and history logs
    addMessage("user", userText, attachment);
    await appendMessageToSession("user", userText, attachment);
    
    updateStatus("thinking", "Jennifer sta pensando...");
    
    // Setup message list for the API call
    let activeConversation = [...state.chatHistory];
    
    try {
        let isDone = false;
        let loops = 0;
        let responseJson = null;
        
        while (!isDone && loops < 5) {
            loops++;
            responseJson = await callGeminiAPI(activeConversation);
            
            const candidate = responseJson.candidates?.[0];
            const content = candidate?.content;
            const parts = content?.parts || [];
            
            // Check for tool function calls
            const functionCalls = parts.filter(p => p.functionCall);
            
            if (functionCalls.length > 0) {
                // Jennifer wants to execute a tool!
                const functionCall = functionCalls[0].functionCall;
                const toolName = functionCall.name;
                const toolArgs = functionCall.args;
                
                showToolIndicator(toolName, toolArgs);
                
                let toolResult = {};
                
                if (toolName === "save_knowledge") {
                    const { topic, content: val } = toolArgs;
                    state.knowledge[topic] = val;
                    await saveKnowledgeBaseToDrive();
                    toolResult = { status: "success", message: `Argomento "${topic}" salvato con successo nei ricordi su Google Drive.` };
                } else if (toolName === "delete_knowledge") {
                    const { topic } = toolArgs;
                    if (state.knowledge[topic]) {
                        delete state.knowledge[topic];
                        await saveKnowledgeBaseToDrive();
                        toolResult = { status: "success", message: `Argomento "${topic}" rimosso.` };
                    } else {
                        toolResult = { status: "error", message: `Argomento "${topic}" non trovato.` };
                    }
                }
                
                // Add the model's tool call suggestion to history
                activeConversation.push({
                    role: "assistant",
                    content: JSON.stringify({ functionCalls: [functionCall] }) // simulated representation
                });
                
                // Add tool result response to history (Gemini requires this structure)
                activeConversation.push({
                    role: "user",
                    content: JSON.stringify({
                        functionResponses: [{
                            name: toolName,
                            response: toolResult
                        }]
                    })
                });
                
                removeToolIndicator();
            } else {
                // No function calls, get text response
                const assistantText = parts.map(p => p.text || '').join('');
                if (assistantText) {
                    addMessage("assistant", assistantText);
                    await appendMessageToSession("assistant", assistantText);
                    speakText(assistantText);
                }
                isDone = true;
            }
        }
        
        updateStatus("online", "Pronto");
        
    } catch (err) {
        console.error(err);
        addMessage("assistant", `Chiedo scusa, si è verificato un errore: ${err.message}`);
        updateStatus("online", "Errore generato");
    }
}

/* ==========================================
   Voice Synthesis (TTS) & Recognition (STT)
   ========================================== */

function initWebSpeech() {
    // 1. Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'it-IT';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        
        recognition.onstart = () => {
            state.isListening = true;
            const micBtn = document.getElementById('mic-btn');
            micBtn.classList.add('listening');
            updateStatus("online", "Ti sto ascoltando...");
        };
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log("Recognized speech:", transcript);
            document.getElementById('chat-input').value = transcript;
            
            // Auto submit
            setTimeout(() => {
                handleUserSendMessage();
            }, 500);
        };
        
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            if (event.error !== 'no-speech') {
                addMessage("system", `Errore riconoscimento vocale: ${event.error}`);
            }
            stopListeningState();
        };
        
        recognition.onend = () => {
            stopListeningState();
        };
        
        // Mic button handler
        const micBtn = document.getElementById('mic-btn');
        micBtn.addEventListener('click', toggleSpeechRecognition);
        
    } else {
        console.warn("Speech Recognition not supported in this browser.");
        document.getElementById('mic-btn').style.display = 'none';
    }
    
    // Pre-load voices for SpeechSynthesis
    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.getVoices();
            };
        }
    }
}

function toggleSpeechRecognition() {
    if (!recognition) return;
    
    if (state.isListening) {
        recognition.stop();
    } else {
        // Cancel any speaking response
        window.speechSynthesis.cancel();
        
        try {
            recognition.start();
        } catch (e) {
            console.error("Failed to start speech recognition:", e);
        }
    }
}

function stopListeningState() {
    state.isListening = false;
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.classList.remove('listening');
    updateStatus("online", "Pronto");
}

function speakText(text) {
    if (state.voiceMuted || !window.speechSynthesis) return;
    
    // Stop any current reading
    window.speechSynthesis.cancel();
    
    // Clean code blocks and markdown symbols
    let cleanText = text.replace(/```[\s\S]*?```/g, '[codice scritto nella chat]');
    cleanText = cleanText.replace(/[*#`_\-]/g, '');
    cleanText = cleanText.replace(/\[/g, '').replace(/\]/g, ''); // brackets
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'it-IT';
    
    // Try to get a high quality Italian voice
    const voices = window.speechSynthesis.getVoices();
    const itVoice = voices.find(voice => voice.lang.includes('it'));
    if (itVoice) {
        utterance.voice = itVoice;
    }
    
    utterance.onstart = () => {
        updateStatus("online", "Jennifer sta parlando...");
        document.getElementById('status-dot').className = 'dot online';
    };
    
    utterance.onend = () => {
        updateStatus("online", "Pronto");
    };
    
    window.speechSynthesis.speak(utterance);
}

/* ==========================================
   UI Utility helpers
   ========================================== */

function updateStatus(dotClass, text) {
    const dot = document.getElementById('status-dot');
    const textEl = document.getElementById('status-text');
    
    dot.className = `dot ${dotClass}`;
    textEl.innerText = text;
    
    state.isThinking = (dotClass === 'thinking');
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function addMessage(role, text, attachment = null) {
    const container = document.getElementById('messages-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    if (role === 'system') {
        bubble.innerHTML = `<i>${escapeHTML(text)}</i>`;
    } else {
        // Escape HTML first to prevent rendering bugs with brackets < >
        let escaped = escapeHTML(text);
        
        // Quick simple formatting for markdown bold and paragraphs
        let formatted = escaped
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
            
        if (attachment) {
            const isImg = attachment.mimeType.startsWith('image/');
            const attachmentHtml = isImg
                ? `<div class="chat-attachment"><img src="data:${attachment.mimeType};base64,${attachment.base64}" class="chat-img-attachment"></div>`
                : `<div class="chat-attachment doc-attachment">
                     <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                     <span>${escapeHTML(attachment.name)}</span>
                   </div>`;
            formatted = attachmentHtml + formatted;
        }
        
        bubble.innerHTML = formatted;
    }
    
    messageDiv.appendChild(bubble);
    container.appendChild(messageDiv);
    
    // Auto Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function showToolIndicator(name, args) {
    const container = document.getElementById('messages-container');
    
    const indicatorDiv = document.createElement('div');
    indicatorDiv.id = 'active-tool-indicator';
    indicatorDiv.className = 'tool-indicator';
    indicatorDiv.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>Esecuzione memoria: ${name}(${JSON.stringify(args)})</span>
    `;
    
    container.appendChild(indicatorDiv);
    container.scrollTop = container.scrollHeight;
}

function removeToolIndicator() {
    const el = document.getElementById('active-tool-indicator');
    if (el) el.remove();
}

async function handleUserSendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    
    // Allow sending just the image/file if there's an attachment
    if (!text && !state.selectedAttachment) return;
    
    const attachment = state.selectedAttachment;
    
    // Clear input box
    input.value = '';
    input.style.height = 'auto';
    
    // Upload file to Google Drive in background if selected
    if (attachment) {
        // Wait if attachment is still loading base64
        if (!attachment.base64) {
            updateStatus("thinking", "Lettura file in corso...");
            let waitTime = 0;
            while (!attachment.base64 && waitTime < 50) {
                await new Promise(r => setTimeout(r, 100));
                waitTime++;
            }
        }

        // Trigger Google Drive upload in the background
        uploadFileToDriveInBackground(attachment);
        
        // Clear UI preview immediately
        document.getElementById('preview-container').classList.add('hidden');
        document.getElementById('file-input').value = '';
        state.selectedAttachment = null;
    }
    
    state.isThinking = false;
    await processConversationTurn(text || "Ho allegato un file.", attachment);
}

// Background file upload helper
function uploadFileToDriveInBackground(attachment) {
    uploadFileToDrive(attachment, state.filesFolderId)
        .then(() => {
            console.log(`File ${attachment.name} archived on Google Drive.`);
            listUploadedFiles(); // Refresh files sidebar list
        })
        .catch(err => {
            console.error("Background file upload failed:", err);
            addMessage("system", `Errore durante il salvataggio in background di "${attachment.name}" su Google Drive: ${err.message}`);
        });
}

// Helper to determine accurate MIME type based on name or system type
function getFileMimeType(file) {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop().toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        case 'webp': return 'image/webp';
        case 'gif': return 'image/gif';
        case 'txt': return 'text/plain';
        case 'json': return 'application/json';
        case 'csv': return 'text/csv';
        case 'html':
        case 'htm': return 'text/html';
        default: return 'application/octet-stream';
    }
}

// Initialize file upload handlers
function initFileUpload() {
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const cancelBtn = document.getElementById('cancel-preview-btn');
    
    if (!attachBtn || !fileInput || !cancelBtn) return;
    
    // Trigger hidden file input click
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    // Handle file selection
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check size limit (e.g. 4MB for inline data base64 and fast uploads)
        if (file.size > 4 * 1024 * 1024) {
            alert("Il file è troppo grande! Seleziona un file inferiore a 4MB.");
            fileInput.value = '';
            return;
        }
        
        const calculatedMimeType = getFileMimeType(file);
        
        const currentAttachment = {
            fileObj: file,
            name: file.name,
            mimeType: calculatedMimeType,
            size: file.size,
            base64: null
        };
        state.selectedAttachment = currentAttachment;
        
        // Show preview container
        const previewContainer = document.getElementById('preview-container');
        const previewImg = document.getElementById('preview-img');
        const previewDoc = document.getElementById('preview-doc-icon');
        const previewDocName = document.getElementById('preview-doc-name');
        
        previewContainer.classList.remove('hidden');
        
        const isImage = calculatedMimeType.startsWith('image/');
        if (isImage) {
            previewImg.classList.remove('hidden');
            previewDoc.classList.add('hidden');
            
            // Read image as base64 for preview and API
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImg.src = event.target.result;
                currentAttachment.base64 = event.target.result.split(',')[1];
            };
            reader.readAsDataURL(file);
        } else {
            previewImg.classList.add('hidden');
            previewDoc.classList.remove('hidden');
            previewDocName.innerText = file.name;
            
            // Read file as base64 in background
            const reader = new FileReader();
            reader.onload = (event) => {
                currentAttachment.base64 = event.target.result.split(',')[1];
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Clear preview
    cancelBtn.addEventListener('click', () => {
        fileInput.value = '';
        document.getElementById('preview-container').classList.add('hidden');
        state.selectedAttachment = null;
    });
}

// Upload file to Google Drive using HTTP v3
async function uploadFileToDrive(fileObj, folderId) {
    if (!state.accessToken) throw new Error("Utente non autenticato con Google");
    
    // 1. Create file metadata
    const metadata = {
        name: fileObj.name,
        parents: [folderId]
    };
    
    const response = await makeDriveRequest('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });
    
    const fileMetadata = await response.json();
    const fileId = fileMetadata.id;
    
    // 2. Upload actual binary file content
    await makeDriveRequest(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
            'Content-Type': fileObj.mimeType
        },
        body: fileObj.fileObj
    });
    
    return fileId;
}

// List files inside knowledge_files subfolder in Drive
async function listUploadedFiles() {
    const list = document.getElementById('files-list');
    const loader = document.getElementById('files-list-loader');
    if (!list) return;
    
    if (loader) loader.classList.remove('hidden');
    
    try {
        if (!state.filesFolderId) return;
        
        let query = `'${state.filesFolderId}' in parents and trashed=false`;
        const response = await makeDriveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink)&orderBy=createdTime desc`);
        const data = await response.json();
        
        list.innerHTML = '';
        const files = data.files || [];
        
        if (files.length === 0) {
            list.innerHTML = '<li class="empty-state">Nessun file archiviato. Allega una foto o un documento in chat!</li>';
            return;
        }
        
        files.forEach(file => {
            const item = document.createElement('li');
            item.className = 'file-item';
            
            const isImage = file.mimeType.startsWith('image/');
            const iconSvg = isImage 
                ? `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`
                : `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            
            item.innerHTML = `
                <div class="file-info">
                    ${iconSvg}
                    <span class="file-name" title="${file.name}">${file.name}</span>
                </div>
                <div class="file-actions">
                    <span class="delete-file" title="Elimina questo file" data-id="${file.id}">&times;</span>
                </div>
            `;
            
            // Open Drive link on click
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-file')) {
                    e.stopPropagation();
                    deleteFileFromDrive(file.id, file.name);
                    return;
                }
                if (file.webViewLink) {
                    window.open(file.webViewLink, '_blank');
                } else {
                    alert(`File: ${file.name}\nMIME: ${file.mimeType}`);
                }
            });
            
            list.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to list files:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Delete file from Drive
async function deleteFileFromDrive(fileId, name) {
    if (confirm(`Sei sicuro di voler eliminare definitivamente il file "${name}" da Google Drive?`)) {
        try {
            await makeDriveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE'
            });
            addMessage("system", `File "${name}" eliminato con successo.`);
            await listUploadedFiles();
        } catch (err) {
            console.error("Failed to delete file:", err);
            alert(`Errore durante l'eliminazione del file: ${err.message}`);
        }
    }
}
