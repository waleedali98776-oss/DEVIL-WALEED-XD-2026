const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const {
    makeInMemoryStore,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    makeWASocket,
    isJidBroadcast
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = 21454;

// Create necessary directories
if (!fs.existsSync("temp")) {
    fs.mkdirSync("temp");
}
if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}
if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs");
}
if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active client instances and tasks
const activeClients = new Map();
const activeTasks = new Map();
const taskLogs = new Map();
const userSessions = new Map();

// System Statistics
const systemStats = {
    totalMessagesSent: 0,
    totalSessions: 0,
    totalTasks: 0,
    uptime: Date.now(),
    errors: 0,
    successfulTasks: 0,
    failedTasks: 0
};

// Load stats from file if exists
try {
    if (fs.existsSync("data/stats.json")) {
        const savedStats = JSON.parse(fs.readFileSync("data/stats.json", "utf8"));
        Object.assign(systemStats, savedStats);
    }
} catch (e) {
    console.log("No previous stats found, starting fresh");
}

// Generate short unique session ID
function generateShortSessionId() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

// Generate short task ID
function generateShortTaskId() {
    return 't' + Math.random().toString(36).substring(2, 8);
}

// Save stats to file 
function saveStats() {
    try {
        fs.writeFileSync("data/stats.json", JSON.stringify(systemStats, null, 2));
    } catch (e) {
        console.error("Error saving stats:", e);
    }
}

// Middleware to track user sessions
app.use((req, res, next) => {
    const userIP = req.ip || req.connection.remoteAddress;
    req.userIP = userIP;
    next();
});

// System Monitoring
setInterval(() => {
    systemStats.totalSessions = activeClients.size;
    systemStats.totalTasks = Array.from(activeClients.values()).reduce((acc, client) => 
        acc + (client.tasks ? client.tasks.length : 0), 0
    );
    saveStats();
}, 300000);

// Enhanced cleanup function
setInterval(() => {
    const now = Date.now();
    for (let [sessionId, clientInfo] of activeClients.entries()) {
        if (clientInfo.lastActivity && (now - clientInfo.lastActivity > 24 * 60 * 60 * 1000)) {
            if (clientInfo.client) {
                clientInfo.client.end();
            }
            activeClients.delete(sessionId);
            
            for (let [ip, sessId] of userSessions.entries()) {
                if (sessId === sessionId) {
                    userSessions.delete(ip); 
                    break;
                }
            }
            console.log(`Cleaned up inactive session: ${sessionId}`);
        }
    }
    
    for (let [taskId, logs] of taskLogs.entries()) {
        if (logs.length > 200) {
            logs.splice(200);
        }
    }
}, 60 * 60 * 1000);

// ==========================================
// DARK RGB THEME CSS (WALEED BRANDING)
// ==========================================
const darkRgbCss = `
    <style>
        body { background: #050505; color: #eee; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
        .container { background: #0d0d0d; border: 2px solid transparent; border-radius: 15px; padding: 30px; width: 90%; max-width: 600px; box-shadow: 0 0 20px rgba(255, 0, 150, 0.5); animation: rgbBorder 5s infinite linear; margin-bottom: 25px; box-sizing: border-box; }
        @keyframes rgbBorder { 0% { border-color: #ff0055; box-shadow: 0 0 20px #ff0055; } 33% { border-color: #00ffcc; box-shadow: 0 0 20px #00ffcc; } 66% { border-color: #aa00ff; box-shadow: 0 0 20px #aa00ff; } 100% { border-color: #ff0055; box-shadow: 0 0 20px #ff0055; } }
        h1 { text-align: center; background: linear-gradient(90deg, #ff0055, #00ffcc, #aa00ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 2.5em; margin-bottom: 10px; letter-spacing: 5px; }
        h2 { text-align: center; color: #00ffcc; text-shadow: 0 0 10px #00ffcc; margin-top: 0; }
        h3 { color: #ff0055; text-shadow: 0 0 5px #ff0055; border-bottom: 1px solid #333; padding-bottom: 10px; }
        p, li { line-height: 1.6; }
        input, select, button, textarea { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; font-size: 16px; box-sizing: border-box; }
        input:focus, select:focus { outline: none; border-color: #00ffcc; box-shadow: 0 0 10px #00ffcc; }
        button { background: linear-gradient(90deg, #ff0055, #aa00ff); color: white; font-weight: bold; cursor: pointer; border: none; transition: 0.3s; }
        button:hover { background: linear-gradient(90deg, #aa00ff, #00ffcc); box-shadow: 0 0 15px #00ffcc; }
        a { color: #00ffcc; text-decoration: none; font-weight: bold; display: block; text-align: center; margin-top: 15px; }
        a:hover { text-shadow: 0 0 10px #00ffcc; }
        .status-connected { color: #00ffcc; text-shadow: 0 0 10px #00ffcc; font-weight: bold; }
        .status-disconnected { color: #ff0055; text-shadow: 0 0 10px #ff0055; font-weight: bold; }
        .log-success { color: #00ffcc; }
        .log-error { color: #ff0055; }
        .log-info { color: #aa00ff; }
        .code-box { text-align: center; font-size: 2.2em; color: #00ffcc; text-shadow: 0 0 15px #00ffcc; letter-spacing: 3px; background: #111; padding: 15px; border-radius: 10px; border: 1px dashed #00ffcc; margin: 20px 0; }
        .stop-btn { background: linear-gradient(90deg, #ff0000, #880000) !important; }
        .stop-btn:hover { box-shadow: 0 0 15px #ff0000 !important; }
    </style>
`;

// System API Routes
app.get("/api/stats", (req, res) => {
    const uptime = Date.now() - systemStats.uptime;
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    
    res.json({
        ...systemStats,
        uptime: `${hours}h ${minutes}m`,
        activeSessions: activeClients.size,
        activeTasks: Array.from(activeClients.values()).reduce((acc, client) => 
            acc + (client.tasks ? client.tasks.length : 0), 0
        ),
        timestamp: new Date().toISOString()
    });
});

app.get("/api/sessions", (req, res) => {
    const sessions = Array.from(activeClients.entries()).map(([sessionId, clientInfo]) => ({
        sessionId,
        number: clientInfo.number,
        isConnected: clientInfo.isConnected,
        lastActivity: clientInfo.lastActivity,
        taskCount: clientInfo.tasks ? clientInfo.tasks.length : 0
    }));
    res.json(sessions);
});

// Main Home Route - WALEED DARK RGB THEME
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WALEED - WhatsApp Control Panel</title>
        ${darkRgbCss}
    </head>
    <body>
        <div class="container">
            <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
            <h2>WhatsApp Control Panel</h2>
        </div>

        <div class="container">
            <h3>🔗 WhatsApp Pairing</h3>
            <form action="/code" method="GET">
                <input type="text" name="number" placeholder="Your WhatsApp Number (e.g., 923xxxxxxxxx)" required>
                <button type="submit">Generate Pairing Code</button>
            </form>
        </div>

        <div class="container">
            <h3>🚀 Send Messages</h3>
            <form action="/send-message" method="POST" enctype="multipart/form-data">
                <select name="targetType" required>
                    <option value="phone">Phone Number</option>
                    <option value="group">Group ID</option>
                </select>
                <input type="text" name="target" placeholder="Target Number / Group ID" required>
                <input type="file" name="messageFile" accept=".txt" required>
                <input type="text" name="prefix" placeholder="Message Prefix (Optional)">
                <input type="number" name="delaySec" placeholder="Delay (Seconds)" value="5" required>
                <button type="submit">Start Sending Messages</button>
            </form>
        </div>

        <div class="container">
            <h3>⚙️ Session Management</h3>
            <form action="/view-session" method="POST">
                <input type="text" name="sessionId" placeholder="Enter Your Session ID" required>
                <button type="submit">View Session Status</button>
            </form>
            <a href="/get-groups">📋 Show My Groups</a>
        </div>
    </body>
    </html>
    `);
});

// REST OF YOUR ORIGINAL ROUTES EXACTLY AS BEFORE
app.get("/code", async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, "");
    const userIP = req.userIP;
    const sessionId = generateShortSessionId();
    const sessionPath = path.join("temp", sessionId);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async key => {
                return {}
            }
        });

        if (!waClient.authState.creds.registered) {
            await delay(1500);
            
            const phoneNumber = num.replace(/[^0-9]/g, "");
            const code = await waClient.requestPairingCode(phoneNumber);
            
            activeClients.set(sessionId, {  
                client: waClient,  
                number: num,  
                authPath: sessionPath,
                isConnected: false,
                tasks: [],
                lastActivity: Date.now()
            });  
            
            userSessions.set(userIP, sessionId);

            res.send(`
            <!DOCTYPE html>
            <html><head><title>Pairing Code - WALEED</title>${darkRgbCss}</head>
            <body>
                <div class="container">
                    <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
                    <h2>Pairing Code Generated</h2>
                    <div class="code-box">${code}</div>
                    <p>Save this code to pair your device.</p>
                    <p><strong>Session ID:</strong> <span style="color:#aa00ff; text-shadow:0 0 5px #aa00ff;">${sessionId}</span></p>
                    <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                    <a href="/">[Go Back to Home]</a>
                </div>
            </body></html>
            `);  
        }  

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`WhatsApp Connected for ${num}! Session ID: ${sessionId}`);  
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = true;
                    clientInfo.lastActivity = Date.now();
                }
            } else if (connection === "close") {
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = false;
                    console.log(`Connection closed for Session ID: ${sessionId}`);
                    
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log(`Attempting to reconnect for Session ID: ${sessionId}...`);
                        await delay(10000);
                        initializeClient(sessionId, num, sessionPath);
                    }
                }
            }  
        });

    } catch (err) {
        console.error("Error in pairing:", err);
        res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Pairing Error</h2><p>${err.message}</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
});

async function initializeClient(sessionId, num, sessionPath) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false
        });

        const clientInfo = activeClients.get(sessionId) || {
            number: num,
            authPath: sessionPath,
            tasks: [],
            lastActivity: Date.now()
        };
        
        clientInfo.client = waClient;
        activeClients.set(sessionId, clientInfo);

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`Reconnected successfully for Session ID: ${sessionId}`);  
                clientInfo.isConnected = true;
                clientInfo.lastActivity = Date.now();
                
                if (clientInfo.tasks && clientInfo.tasks.length > 0) {
                    clientInfo.tasks.forEach(task => {
                        if (task.isSending && !task.stopRequested) {
                            console.log(`Resuming task ${task.taskId} for session ${sessionId}`);
                            const messages = task.messages || [];
                            if (messages.length > 0) {
                                sendMessagesLoop(
                                    sessionId, 
                                    task.taskId, 
                                    messages, 
                                    waClient, 
                                    task.target, 
                                    task.targetType, 
                                    task.delaySec, 
                                    task.prefix, 
                                    clientInfo.number
                                );
                            }
                        }
                    });
                }
            } else if (connection === "close") {
                clientInfo.isConnected = false;
                console.log(`Connection closed again for Session ID: ${sessionId}`);
                
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log(`Reconnecting again for Session ID: ${sessionId}...`);
                    await delay(10000);
                    initializeClient(sessionId, num, sessionPath);
                }
            }  
        });

    } catch (err) {
        console.error(`Reconnection failed for Session ID: ${sessionId}`, err);
        setTimeout(() => initializeClient(sessionId, num, sessionPath), 30000);
    }
}

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix } = req.body;
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>No active WhatsApp session found. Please generate a pairing code first.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    const clientInfo = activeClients.get(sessionId);
    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Missing required fields. Please ensure all fields are filled.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
        
        if (messages.length === 0) {
            return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Message file is empty.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
        }

        const taskId = generateShortTaskId();
        
        const taskInfo = {
            taskId,
            target,
            targetType,
            messages,
            delaySec,
            prefix,
            isSending: true,
            stopRequested: false,
            totalMessages: messages.length,
            sentMessages: 0,
            currentMessageIndex: 0,
            startTime: new Date(),
            logs: []
        };
        
        if (!clientInfo.tasks) clientInfo.tasks = [];
        clientInfo.tasks.push(taskInfo);
        clientInfo.lastActivity = Date.now();
        
        taskLogs.set(taskId, []);
        
        systemStats.totalMessagesSent += messages.length;
        systemStats.totalTasks++;
        
        res.send();
        
        sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber);

    } catch (error) {
        console.error(`[${sessionId}] Error:`, error);
        systemStats.errors++;
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>${error.message}</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
});

async function sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber) {
    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) return;
    
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo) return;
    
    const logs = taskLogs.get(taskId) || [];
    
    try {
        let index = taskInfo.currentMessageIndex;
        const recipient = targetType === "group" ? target + "@g.us" : target + "@s.whatsapp.net";
        
        while (taskInfo.isSending && !taskInfo.stopRequested) {
            if (!clientInfo.isConnected) {
                const waitingLog = {
                    type: "info",
                    message: `[${new Date().toLocaleString()}] Waiting for connection...`,
                    details: `Paused until reconnected`,
                    timestamp: new Date()
                };
                
                logs.unshift(waitingLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.log(`[${sessionId}] Connection lost, pausing task ${taskId}`);
                await delay(10000);
                continue;
            }
            
            let msg = messages[index];
            if (prefix && prefix.trim() !== "") {
                msg = `${prefix.trim()} ${msg}`;
            }
            
            const timestamp = new Date().toLocaleString();
            const messageNumber = taskInfo.sentMessages + 1;
            const cycleNumber = Math.floor(taskInfo.sentMessages / messages.length) + 1;
            
            try {
                await waClient.sendMessage(recipient, { text: msg });
                
                const successLog = {
                    type: "success",
                    message: `[${timestamp}] Msg #${messageNumber} (Cycle ${cycleNumber}) sent to ${target}`,
                    details: `"${msg}"`,
                    timestamp: new Date()
                };
                
                logs.unshift(successLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.log(`[${sessionId}] Sent message #${messageNumber} (Cycle ${cycleNumber}) from ${senderNumber} to ${target}`);
                
                taskInfo.sentMessages++;
                systemStats.totalMessagesSent++;
                index = (index + 1) % messages.length;
                taskInfo.currentMessageIndex = index;
                taskInfo.currentCycle = cycleNumber;
                clientInfo.lastActivity = Date.now();
                
            } catch (sendError) {
                const errorLog = {
                    type: "error",
                    message: `[${timestamp}] Failed to send msg #${messageNumber} to ${target}`,
                    details: `Error: ${sendError.message}`,
                    timestamp: new Date()
                };
                
                logs.unshift(errorLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);
                
                console.error(`[${sessionId}] Error sending message:`, sendError);
                systemStats.errors++;
                
                if (sendError.message.includes("connection") || sendError.message.includes("socket") || 
                    sendError.message.includes("timeout") || sendError.message.includes("not connected")) {
                    clientInfo.isConnected = false;
                    console.log(`Connection issue for session ${sessionId}, waiting for reconnect...`);
                    await delay(5000);
                    continue;
                }
                
                await delay(5000);
            }
            
            await delay(delaySec * 1000);
        }
        
        taskInfo.endTime = new Date();
        taskInfo.isSending = false;
        
        if (taskInfo.stopRequested) {
            systemStats.failedTasks++;
        } else {
            systemStats.successfulTasks++;
        }
        
        const completionLog = {
            type: "info",
            message: `[${new Date().toLocaleString()}] Task stopped`,
            details: `Total sent: ${taskInfo.sentMessages} in ${taskInfo.currentCycle || 1} cycle(s)`,
            timestamp: new Date()
        };
        
        logs.unshift(completionLog);
        taskLogs.set(taskId, logs);
        
    } catch (error) {
        console.error(`[${sessionId}] Error in message loop:`, error);
        systemStats.errors++;
        systemStats.failedTasks++;
        
        const errorLog = {
            type: "error",
            message: `[${new Date().toLocaleString()}] Critical error`,
            details: `Error: ${error.message}`,
            timestamp: new Date()
        };
        
        logs.unshift(errorLog);
        taskLogs.set(taskId, logs);
        
        taskInfo.error = error.message;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();
    }
}

app.get("/session-status", (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`<!DOCTYPE html><html><head><title>Not Found</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Session Not Found</h2><p>Session ID ${sessionId} not found or expired.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    const clientInfo = activeClients.get(sessionId);
    
    res.send(`
    <!DOCTYPE html>
    <html><head><title>Session Status - WALEED</title>${darkRgbCss}</head>
    <body>
        <div class="container">
            <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
            <h2>Session Status</h2>
            <p><strong>Session:</strong> ${sessionId}</p>
            <p><strong>WhatsApp:</strong> ${clientInfo.number}</p>
            <p><strong>Status:</strong> <span class="${clientInfo.isConnected ? 'status-connected' : 'status-disconnected'}">${clientInfo.isConnected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}</span></p>
            <p><strong>Last active:</strong> ${new Date(clientInfo.lastActivity).toLocaleString()}</p>
            
            ${clientInfo.tasks && clientInfo.tasks.length > 0 ? `
                <h3>Active Tasks (${clientInfo.tasks.length})</h3>
                ${clientInfo.tasks.map(task => `
                    <div style="background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:15px; border-left: 4px solid ${task.isSending ? '#00ffcc' : '#ff0055'};">
                        <p><strong>Target:</strong> ${task.target} (${task.targetType})</p>
                        <p><strong>Task ID:</strong> ${task.taskId}</p>
                        <p><strong>Status:</strong> <span class="${task.isSending ? 'status-connected' : 'status-disconnected'}">${task.isSending ? '🔄 RUNNING' : task.stopRequested ? '⏹️ STOPPED' : '✅ COMPLETED'}</span></p>
                        <p><strong>Sent:</strong> ${task.sentMessages} / ${task.totalMessages} ${task.currentCycle ? '(Cycle ' + task.currentCycle + ')' : ''}</p>
                        <p><strong>Start:</strong> ${task.startTime.toLocaleString()}</p>
                        <form action="/task-logs" method="GET" style="display:inline; width:auto; margin-right:10px;">
                            <input type="hidden" name="sessionId" value="${sessionId}">
                            <input type="hidden" name="taskId" value="${task.taskId}">
                            <button type="submit" style="width:auto; padding:8px 15px; margin:5px 0;">View Logs</button>
                        </form>
                        <form action="/stop-task" method="POST" style="display:inline; width:auto;">
                            <input type="hidden" name="sessionId" value="${sessionId}">
                            <input type="hidden" name="taskId" value="${task.taskId}">
                            <button type="submit" class="stop-btn" style="width:auto; padding:8px 15px; margin:5px 0;">Stop Task</button>
                        </form>
                    </div>
                `).join('')}
            ` : `
                <h3>No Active Tasks</h3>
                <p>This session has no active message sending tasks.</p>
            `}
            
            <form action="/stop-session" method="POST" style="margin-top:20px;">
                <input type="hidden" name="sessionId" value="${sessionId}">
                <button type="submit" class="stop-btn">Stop Entire Session</button>
            </form>
            <a href="/">[Back to Home]</a>
        </div>
    </body></html>
    `);
});

app.get("/task-logs", (req, res) => {
    const { sessionId, taskId } = req.query;
    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Invalid Session or Task ID.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    const logs = taskLogs.get(taskId) || [];
    const clientInfo = activeClients.get(sessionId);
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    
    if (!taskInfo) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Task not found.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
    
    let logsHtml = '';
    logs.forEach(log => {
        const colorClass = log.type === 'success' ? 'log-success' : log.type === 'error' ? 'log-error' : 'log-info';
        logsHtml += `<div class="${colorClass}" style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px; border-left: 3px solid currentColor;">`;
        logsHtml += `<strong>${log.message}</strong><br>`;
        logsHtml += `<small>${log.details}</small>`;
        logsHtml += `</div>`;
    });
    
    if (logs.length === 0) {
        logsHtml = '<p style="text-align:center; color:#888;">No logs yet. Messages will start sending shortly...</p>';
    }
    
    res.send(`
    <!DOCTYPE html>
    <html><head>
        <title>Task Logs - WALEED</title>
        ${darkRgbCss}
        <meta http-equiv="refresh" content="${taskInfo.isSending ? 10 : 0}">
    </head>
    <body>
        <div class="container">
            <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
            <h2>Task Logs</h2>
            <p><strong>Task ID:</strong> ${taskId}</p>
            <p><strong>Status:</strong> <span class="${taskInfo.isSending ? 'status-connected' : 'status-disconnected'}">${taskInfo.isSending ? 'RUNNING' : taskInfo.stopRequested ? 'STOPPED' : 'COMPLETED'}</span></p>
            <p><strong>Target:</strong> ${taskInfo.target} (${taskInfo.targetType})</p>
            <p><strong>Sent:</strong> ${taskInfo.sentMessages} of ${taskInfo.totalMessages}</p>
            <p><strong>Start:</strong> ${taskInfo.startTime.toLocaleString()}</p>
            ${taskInfo.endTime ? `<p><strong>End:</strong> ${taskInfo.endTime.toLocaleString()}</p>` : ''}
            ${taskInfo.error ? `<p style="color:#ff0055;"><strong>Error:</strong> ${taskInfo.error}</p>` : ''}
            <p style="text-align:center; color:#888; font-size:0.9em;">${taskInfo.isSending ? 'Auto-refresh every 10 sec' : ''}</p>
            
            <h3>Live Logs (Newest First)</h3>
            ${logsHtml}
            
            <a href="/session-status?sessionId=${sessionId}">[Return to Session Status]</a>
        </div>
    </body></html>
    `);
});

app.post("/view-session", (req, res) => {
    const { sessionId } = req.body;
    res.redirect(`/session-status?sessionId=${sessionId}`);
});

app.post("/stop-session", async (req, res) => {
    const { sessionId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Invalid Session ID.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        
        if (clientInfo.tasks) {
            clientInfo.tasks.forEach(task => {
                task.stopRequested = true;
                task.isSending = false;
                task.endTime = new Date();
            });
        }
        
        if (clientInfo.client) {
            clientInfo.client.end();
        }
        
        activeClients.delete(sessionId);
        
        for (let [ip, sessId] of userSessions.entries()) {
            if (sessId === sessionId) {
                userSessions.delete(ip);
                break;
            }
        }

        res.send(`
        <!DOCTYPE html><html><head><title>Session Stopped - WALEED</title>${darkRgbCss}</head>
        <body>
            <div class="container">
                <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
                <h2 style="color:#ff0055;">Session Stopped</h2>
                <p>Session <strong>${sessionId}</strong> stopped successfully.</p>
                <p>All tasks in this session have been stopped.</p>
                <a href="/">[Go Back to Home]</a>
            </div>
        </body></html>
        `);

    } catch (error) {
        console.error(`Error stopping session ${sessionId}:`, error);
        res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>${error.message}</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
});

app.post("/stop-task", async (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Invalid Session ID.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
        
        if (!taskInfo) {
            return res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>Task not found.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
        }
        
        taskInfo.stopRequested = true;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();

        const logs = taskLogs.get(taskId) || [];
        logs.unshift({
            type: "info",
            message: `[${new Date().toLocaleString()}] Task stopped by user`,
            details: `Total messages sent: ${taskInfo.sentMessages}`,
            timestamp: new Date()
        });
        taskLogs.set(taskId, logs);

        res.send(`
        <!DOCTYPE html><html><head><title>Task Stopped - WALEED</title>${darkRgbCss}</head>
        <body>
            <div class="container">
                <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
                <h2 style="color:#ff0055;">Task Stopped</h2>
                <p>Task <strong>${taskId}</strong> has been stopped.</p>
                <a href="/session-status?sessionId=${sessionId}">[Return to Session Status]</a>
            </div>
        </body></html>
        `);

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error</h2><p>${error.message}</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
});

app.get("/get-groups", async (req, res) => {
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`<!DOCTYPE html><html><head><title>No Session</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ No Active Session</h2><p>Please generate a pairing code first to connect your WhatsApp account.</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }

    try {
        const { client: waClient, number: senderNumber } = activeClients.get(sessionId);
        const groups = await waClient.groupFetchAllParticipating();
        
        let groupsList = `
        <!DOCTYPE html>
        <html><head><title>My Groups - WALEED</title>${darkRgbCss}</head>
        <body>
            <div class="container">
                <h1>𝐖 𝐀 𝐋 𝐄 𝐄 𝐃</h1>
                <h2>Connected as: ${senderNumber}</h2>
        `;
        
        if (Object.keys(groups).length === 0) {
            groupsList += `<p style="text-align:center;">No Groups Found. You are not a member of any WhatsApp groups.</p>`;
        } else {
            groupsList += `<h3>Your Groups (${Object.keys(groups).length})</h3>`;
            
            Object.keys(groups).forEach((groupId, index) => {
                const group = groups[groupId];
                const cleanGroupId = groupId.replace('@g.us', '');
                const participantsCount = group.participants ? group.participants.length : 0;
                const creationDate = group.creation ? new Date(group.creation * 1000).toLocaleDateString() : 'Unknown';
                
                groupsList += `
                    <div style="background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:15px; border-left: 4px solid #aa00ff;">
                        <p><strong>${index + 1}. ${group.subject || 'Unknown Group'}</strong></p>
                        <p><strong>Group UID:</strong> <span style="color:#00ffcc; word-break:break-all;">${cleanGroupId}</span></p>
                        <p><strong>Participants:</strong> ${participantsCount} | <strong>Created:</strong> ${creationDate}</p>
                        <button onclick="navigator.clipboard.writeText('${cleanGroupId}'); this.innerText='Copied!'; setTimeout(()=>this.innerText='Copy UID', 2000);" style="width:auto; padding:8px 15px; margin-top:10px;">Copy UID</button>
                    </div>
                `;
            });
            
            groupsList += `<p style="text-align:center; color:#888;">Total ${Object.keys(groups).length} groups loaded</p>`;
        }
        
        groupsList += `
                <a href="/">[Back to Home]</a>
            </div>
        </body></html>
        `;
        
        res.send(groupsList);

    } catch (error) {
        console.error("Error fetching groups:", error);
        res.send(`<!DOCTYPE html><html><head><title>Error</title>${darkRgbCss}</head><body><div class="container"><h2 style="color:#ff0055;">⚠️ Error Loading Groups</h2><p>${error.message}</p><a href="/">[Go Back to Home]</a></div></body></html>`);
    }
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    activeClients.forEach(({ client }, sessionId) => {
        client.end();
        console.log(`Closed connection for Session ID: ${sessionId}`);
    });
    process.exit();
});

app.listen(PORT, () => {
    console.log(`🚀 𝐖 𝐀 𝐋 𝐄 𝐄 𝐃 🔥Server Started on http://localhost:${PORT}`);
    console.log(`✅ All Systems Integrated Successfully!`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
