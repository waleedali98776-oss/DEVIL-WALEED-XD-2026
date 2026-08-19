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

const upload = multer({  dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active client instances and tasks
const activeClients = new Map();
const activeTasks = new Map();
const taskLogs = new Map();
const userSessions = new Map();

// 🔥 NEW: Track manually disconnected sessions to prevent auto-reconnect
const manuallyDisconnectedSessions = new Set();
// 🔥 NEW: Track pair code sessions that never connected, for timeout purposes
const pairCodeSessions = new Map();

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

// 🔥 NEW: Check and remove timeout pair code sessions (from index.js)
function checkPairCodeTimeouts() {
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    pairCodeSessions.forEach((info, sessionId) => {
        if (!info.hasConnected && (now - info.createdAt) > TIMEOUT_MS) {
            console.log(`⏰ Pair code session ${sessionId} timeout - never connected in 10 minutes`);
            completeSessionCleanup(sessionId);
        }
    });
}

setInterval(() => {
    checkPairCodeTimeouts();
}, 2 * 60 * 1000);

// 🔥 NEW: Complete permanent session cleanup (from index.js)
function completeSessionCleanup(sessionId) {
    console.log(`🗑️ Starting COMPLETE PERMANENT cleanup for session: ${sessionId}`);
    manuallyDisconnectedSessions.add(sessionId);
    
    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) return;
    
    if (clientInfo.tasks) {
        clientInfo.tasks.forEach(task => {
            task.stopRequested = true;
            task.isSending = false;
            task.endTime = new Date();
            if (taskLogs.has(task.taskId)) {
                taskLogs.delete(task.taskId);
            }
        });
    }
    
    if (clientInfo.client) {
        try {
            clientInfo.client.end();
        } catch (error) {
            console.error(`Error closing client for ${sessionId}: ${error.message}`);
        }
    }
    
    if (clientInfo.authPath && fs.existsSync(clientInfo.authPath)) {
        try {
            fs.rmSync(clientInfo.authPath, { recursive: true, force: true });
            console.log(`💥 PERMANENTLY DELETED auth folder: ${clientInfo.authPath}`);
        } catch (error) {
            console.error(`Error deleting auth folder for ${sessionId}: ${error.message}`);
        }
    }
    
    activeClients.delete(sessionId);
    
    for (let [ip, sessId] of userSessions.entries()) {
        if (sessId === sessionId) {
            userSessions.delete(ip);
            break;
        }
    }
    
    if (pairCodeSessions.has(sessionId)) {
        pairCodeSessions.delete(sessionId);
    }
    
    console.log(`✅ COMPLETE PERMANENT cleanup finished for session: ${sessionId}`);
}

// 🔥 NEW: Session recovery with infinite reconnect (from index.js)
async function recoverSession(sessionId, clientInfo) {
    if (manuallyDisconnectedSessions.has(sessionId)) {
        console.log(`❌ Session ${sessionId} was manually disconnected. Skipping auto-reconnect.`);
        return null;
    }
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(clientInfo.authPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async () => ({}),
            markOnlineOnConnect: false,
            retryRequestDelayMs: 1000,
            maxRetries: 1000000000,
            connectTimeoutMs: 60000
        });
        
        clientInfo.client = waClient;
        clientInfo.isConnected = false;
        activeClients.set(sessionId, clientInfo);
        
        waClient.ev.on("creds.update", saveCreds);
        waClient.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (manuallyDisconnectedSessions.has(sessionId)) {
                if (waClient) {
                    try { waClient.end(); } catch (e) { /* Ignore */ }
                }
                return;
            }
            
            if (connection === "open") {
                console.log(`Session ${sessionId} reconnected successfully!`);
                clientInfo.isConnected = true;
                clientInfo.lastActivity = Date.now();
                
                if (pairCodeSessions.has(sessionId)) {
                    pairCodeSessions.get(sessionId).hasConnected = true;
                }
                
                if (clientInfo.tasks && clientInfo.tasks.length > 0) {
                    clientInfo.tasks.forEach(task => {
                        if (task.isSending && !task.stopRequested) {
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
            }
            else if (connection === "close") {
                clientInfo.isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                if (manuallyDisconnectedSessions.has(sessionId)) return;
                
                if (statusCode === 401) {
                    console.log(`Session ${sessionId} logged out from WhatsApp. Removing session.`);
                    completeSessionCleanup(sessionId);
                    return;
                }
                
                console.log(`Reconnecting session ${sessionId} in 10000ms...`);
                setTimeout(() => {
                    if (!manuallyDisconnectedSessions.has(sessionId)) {
                        recoverSession(sessionId, clientInfo);
                    }
                }, 10000);
            }
        });
        
        return waClient;
    } catch (error) {
        console.error(`Failed to recover session ${sessionId}: ${error.message}`);
        if (!manuallyDisconnectedSessions.has(sessionId)) {
            setTimeout(() => {
                recoverSession(sessionId, clientInfo);
            }, 30000);
        }
        return null;
    }
}

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

// Main Home Route with All Systems - COMPACT CYBER NEON THEME
app.get("/", (req, res) => {
    res.send(`
    
 ༒︎    𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑    ༒︎⁩
                 ɪ ᴀᴍ ᴀ ᴅᴇᴠɪʟ ᴏꜰ ᴍʏ ᴡᴏʀʟᴅ 0 Total Msgs 0 Sessions 0 Active Tasks 0h 0m Uptime  SYSTEM CONTROL
                  Refresh
                      Info
                      Sessions
                      Clear Logs
                      System ready.
                 WhatsApp Pairing Your WhatsApp Number 
                            Generate Pairing Code
                         Send Messages Target Type Select Type Phone Number Group ID Target Number/Group ID Message File (.txt) Message Prefix (Optional) Delay (Seconds) Start Sending Messages Session Management Your WhatsApp Number 
                        Generate Pairing Code
                     Your Session ID Show My Session Show My Groups Stop My Session View Session Tasks Enter Your Session ID 
                            Show My Tasks
                        
 SYSTEM CONSOLE
                    
 Clear
                        
    `);
});

// 🔥 REPLACED: Pairing system from index.js
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
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async key => { return {} },
            markOnlineOnConnect: false,
            retryRequestDelayMs: 3000,
            maxRetries: 1000000000,
            connectTimeoutMs: 60000
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
                lastActivity: Date.now(),
                createdAt: new Date().toISOString()
            });  
            
            // 🔥 NEW: Track pair code session for 10-minute timeout
            pairCodeSessions.set(sessionId, {
                createdAt: Date.now(),
                hasConnected: false
            });
            
            userSessions.set(userIP, sessionId);

            res.send(`  
                
Pairing Code: ${code}
Save this code to pair your device
To pair your device:
Open WhatsApp on your phone
Go to Settings → Linked Devices → Link a Device
Enter this pairing code when prompted
After pairing, start sending messages
Your Session ID: ${sessionId}
Save this Session ID to manage your tasks
[Go Back to Home](/)
  
            `);  
        }  

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            
            if (manuallyDisconnectedSessions.has(sessionId)) {
                console.log(`❌ Session ${sessionId} is manually disconnected. Ignoring connection updates.`);
                return;
            }
            
            if (connection === "open") {  
                console.log(`WhatsApp Connected for ${num}! Session ID: ${sessionId}`);  
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = true;
                    clientInfo.lastActivity = Date.now();
                    
                    if (pairCodeSessions.has(sessionId)) {
                        pairCodeSessions.get(sessionId).hasConnected = true;
                        console.log(`✅ Pair code session ${sessionId} successfully connected`);
                    }
                }
            } else if (connection === "close") {
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = false;
                    console.log(`Connection closed for Session ID: ${sessionId}`);
                    
                    if (manuallyDisconnectedSessions.has(sessionId)) {
                        console.log(`❌ Session ${sessionId} was manually disconnected. Not reconnecting.`);
                        return;
                    }
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    if (statusCode === 401) {
                        console.log(`Session ${sessionId} logged out from WhatsApp. Removing session.`);
                        completeSessionCleanup(sessionId);
                        return;
                    }
                    
                    console.log(`Attempting to reconnect for Session ID: ${sessionId}...`);
                    await delay(10000);
                    recoverSession(sessionId, clientInfo);
                }
            }  
        });

    } catch (err) {
        console.error("Error in pairing:", err);
        res.send(`
[Go Back](/)
`);
    }
});

// 🔥 REMOVED: initializeClient function (replaced by recoverSession from index.js)

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix } = req.body;
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`
Error: No active WhatsApp session found. Please generate a pairing code first.
`);
    }

    const clientInfo = activeClients.get(sessionId);
    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(`
Error: Missing required fields
`);
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
        
        if (messages.length === 0) {
            return res.send(`
Error: Message file is empty
`);
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
        return res.send(`
Error: ${error.message}
`);
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
        return res.send(`
            
Session Not Found
Session ID ${sessionId} not found or expired.
        `);
    }

    const clientInfo = activeClients.get(sessionId);
    
    res.send(`
        
Session: ${sessionId}
WhatsApp: ${clientInfo.number}
                            ${clientInfo.isConnected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}
                        
                        Last active: ${new Date(clientInfo.lastActivity).toLocaleString()}
                    
            
            ${clientInfo.tasks && clientInfo.tasks.length > 0 ? `
                
                        Active Tasks (${clientInfo.tasks.length})
                    
                        ${clientInfo.tasks.map(task => `
                            
                                            ${task.target} (${task.targetType})
                                        
Task ID:  ${task.taskId} Status: 
                                                    ${task.isSending ? '🔄 RUNNING' : task.stopRequested ? '⏹️ STOPPED' : 'COMPLETED'}
                                                 Sent:  ${task.sentMessages} ${task.currentCycle ? '(Cycle ' + task.currentCycle + ')' : ''} Total:  ${task.totalMessages} per cycle Start:  ${task.startTime.toLocaleString()} Mode:  Continuous Loop Progress ${Math.round((task.sentMessages / task.totalMessages) * 100)}% 
                        `).join('')}
                     
            ` : `
                
No Active Tasks
This session has no active message sending tasks.
            `}
        
    `);
});

app.get("/task-logs", (req, res) => {
    const { sessionId, taskId } = req.query;
    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.send(`
Error: Invalid Session or Task ID
`);
    }

    const logs = taskLogs.get(taskId) || [];
    const clientInfo = activeClients.get(sessionId);
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    
    if (!taskInfo) {
        return res.send(`
Error: Task not found
`);
    }
    
    let logsHtml = '';
    logs.forEach(log => {
        logsHtml += '';
        logsHtml += '' + log.message + '';
        logsHtml += '' + log.details + '';
        logsHtml += '';
    });
    
    if (logs.length === 0) {
        logsHtml = 'No logs yet. Messages will start sending shortly...';
    }
    
    res.send(`
        
Task Logs
Task ID: ${taskId} 
                        Status:  ${taskInfo.isSending ? 'RUNNING' : taskInfo.stopRequested ? 'STOPPED' : 'COMPLETED'} 
                        Target:  ${taskInfo.target} (${taskInfo.targetType}) 
                        Sent:  ${taskInfo.sentMessages} of ${taskInfo.totalMessages} 
                        Start:  ${taskInfo.startTime.toLocaleString()} 
                    
                    ${taskInfo.endTime ? ' End:  ' + taskInfo.endTime.toLocaleString() + ' ' : ''}
                    
                    ${taskInfo.error ? ' Error: ' + taskInfo.error + ' ' : ''}
                    
                     
                        ${taskInfo.isSending ? 'Auto-refresh every 10 sec' : ''}
                    
Live Logs (Newest First)
                        ${logsHtml}
                    
[Return to Session Status](/session-status?sessionId=${sessionId})
    `);
});

app.post("/view-session", (req, res) => {
    const { sessionId } = req.body;
    res.redirect(`/session-status?sessionId=${sessionId}`);
});

app.post("/stop-session", async (req, res) => {
    const { sessionId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`
Error: Invalid Session ID
`);
    }

    try {
        // 🔥 UPDATED: Use completeSessionCleanup from index.js pairing system
        completeSessionCleanup(sessionId);

        res.send(`  
            
Session ${sessionId} stopped successfully
All tasks in this session have been stopped.
  
        `);

    } catch (error) {
        console.error(`Error stopping session ${sessionId}:`, error);
        res.send(`
Error stopping session
${error.message}
`);
    }
});

app.post("/stop-task", async (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`
Error: Invalid Session ID
`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
        
        if (!taskInfo) {
            return res.send(`
Error: Task not found
`);
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

        res.send();

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(`
Error stopping task
${error.message}
`);
    }
});

app.get("/get-groups", async (req, res) => {
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`
            
 No Active Session
                
Please generate a pairing code first to connect your WhatsApp account.
        `);
    }

    try {
        const { client: waClient, number: senderNumber } = activeClients.get(sessionId);
        const groups = await waClient.groupFetchAllParticipating();
        
        let groupsList = `
            
 Connected as: ${senderNumber}
                
        `;
        
        if (Object.keys(groups).length === 0) {
            groupsList += `
                
No Groups Found
You are not a member of any WhatsApp groups.
            `;
        } else {
            groupsList += ;
            
            Object.keys(groups).forEach((groupId, index) => {
                const group = groups[groupId];
                const cleanGroupId = groupId.replace('@g.us', '');
                const participantsCount = group.participants ? group.participants.length : 0;
                const creationDate = group.creation ? new Date(group.creation * 1000).toLocaleDateString() : 'Unknown';
                
                groupsList += `
                    
                                    ${index + 1}. ${group.subject || 'Unknown Group'}
                                
Group UID:
                                            ${cleanGroupId}
Participants: ${participantsCount}Created: ${creationDate}Status:Active Copy UID
                        
                `;
            });
            
            groupsList += ;
            
            groupsList += `
                
 
                        Total ${Object.keys(groups).length} groups loaded
                    
            `;
        }
        
        res.send(groupsList);

    } catch (error) {
        console.error("Error fetching groups:", error);
        res.send(`
            
Error Loading Groups
${error.message}
        `);
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
    console.log(`🚀  𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑 🔥Server Started on http://localhost:${PORT}`);
    console.log(`✅ All Systems Integrated Successfully!`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`✅ INFINITE RECONNECT enabled for valid sessions`);
    console.log(`✅ Pair code 10-minute timeout enabled`);
    console.log(`✅ WhatsApp logout detection enabled`);
});
