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
if (!fs.existsSync("public")) {
    fs.mkdirSync("public"); // <-- APNI DP "public/logo.png" KE NAAM SE SAVE KAREIN (sirf logo ke liye)
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // <-- sirf logo.png serve karne ke liye

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

/* ============================================================
   SIRF HTML KA KAAM — DARK RGB THEME + WALEED NAME + DP LOGO
   (Backend logic 100% original hai)
   ============================================================ */
const THEME_CSS = `
:root{--rgb:linear-gradient(90deg,#ff0000,#ffaa00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#f2f2f2;padding:20px}
.wrap{max-width:1000px;margin:auto}
header{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0 20px}
.logo{width:96px;height:96px;border-radius:50%;object-fit:cover;border:4px solid transparent;
background:linear-gradient(#15151d,#15151d) padding-box,var(--rgb) border-box;background-size:100% 100%,300% 100%;
animation:rgb 4s linear infinite;box-shadow:0 0 25px rgba(255,0,255,.25)}
h1{font-size:2rem;letter-spacing:6px;font-weight:800;background:var(--rgb);background-size:300% 100%;
-webkit-background-clip:text;background-clip:text;color:transparent;animation:rgb 4s linear infinite}
.tag{color:#9aa0b5;letter-spacing:3px;font-size:.75rem;text-transform:uppercase}
@keyframes rgb{0%{background-position:0% 50%}100%{background-position:300% 50%}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:18px 0}
.stat,.card{border:2px solid transparent;border-radius:16px;
background:linear-gradient(#15151d,#15151d) padding-box,var(--rgb) border-box;background-size:100% 100%,300% 100%;
animation:rgb 5s linear infinite;box-shadow:0 4px 18px rgba(0,0,0,.5)}
.stat{padding:14px;text-align:center}
.stat b{display:block;font-size:1.4rem}
.stat span{color:#9aa0b5;font-size:.72rem;letter-spacing:2px;text-transform:uppercase}
.card{padding:18px;margin:16px 0}
h2{font-size:.95rem;letter-spacing:3px;margin:12px 0;text-transform:uppercase;background:var(--rgb);
background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:rgb 4s linear infinite}
label{display:block;font-size:.72rem;color:#9aa0b5;margin:10px 0 4px;letter-spacing:1px;text-transform:uppercase}
p{font-size:.85rem;color:#c0c4d6;margin:6px 0}
ul{margin:8px 0 8px 20px;font-size:.85rem;color:#c0c4d6}
li{margin:4px 0}
input,select{width:100%;padding:10px 12px;border:1px solid #2a2a38;border-radius:10px;background:#1c1c26;
color:#f2f2f2;font-size:.9rem;outline:none}
input:focus,select:focus{border-color:#00ffff;box-shadow:0 0 0 3px rgba(0,255,255,.15)}
.btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
button,.btn{cursor:pointer;border:2px solid transparent;border-radius:12px;padding:10px 16px;
background:linear-gradient(#15151d,#15151d) padding-box,var(--rgb) border-box;background-size:100% 100%,300% 100%;
animation:rgb 4s linear infinite;font-weight:700;letter-spacing:1px;font-size:.78rem;text-transform:uppercase;
color:#f2f2f2;text-decoration:none;display:inline-block}
button:hover,.btn:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.6)}
.console{margin-top:12px;background:#0d0d12;border:1px solid #2a2a38;border-radius:12px;height:180px;
overflow-y:auto;padding:12px;font-family:Consolas,monospace;font-size:.8rem;color:#7ee787;white-space:pre-wrap}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:700px){.row{grid-template-columns:1fr}}
.ok{color:#00e676;font-weight:700}
.err{color:#ff5252;font-weight:700}
table{width:100%;border-collapse:collapse;margin:10px 0}
td,th{padding:8px;border-bottom:1px solid #2a2a38;font-size:.85rem;text-align:left;vertical-align:top;color:#c0c4d6}
.big{font-size:2rem;font-weight:800;letter-spacing:6px}
`;

function themePage(title, content) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="icon" href="/logo.png">
<style>${THEME_CSS}</style>
</head>
<body>
<div class="wrap">
<header>
<img src="/logo.png" class="logo" alt="Waleed Logo">
<h1>༒︎ 𝐖 𝐀 𝐋 𝐄 𝐄  𝑫༾︎</h1>
<div class="tag">ɪ ᴀᴍ  ᴅᴇᴠɪʟ ᴏ ᴍʏ ᴡᴏʀʟᴅ</div>
</header>
${content}
</div>
</body>
</html>`;
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

// ============ MAIN HOME (HTML: DARK RGB + WALEED) ============
app.get("/", (req, res) => {
    res.send(themePage("༒︎ 𝐖 𝐀 𝐋 𝐄 𝑬 𝐃 ༾︎", `
<div class="stats">
    <div class="stat"><b id="stMsgs">0</b><span>Total Msgs</span></div>
    <div class="stat"><b id="stSess">0</b><span>Sessions</span></div>
    <div class="stat"><b id="stTasks">0</b><span>Active Tasks</span></div>
    <div class="stat"><b id="stUp">0h 0m</b><span>Uptime</span></div>
</div>

<div class="card">
    <h2>System Control</h2>
    <div class="btnrow">
        <button onclick="refresh()">Refresh</button>
        <button onclick="info()">Info</button>
        <button onclick="sessions()">Sessions</button>
        <button onclick="clearLogs()">Clear Logs</button>
    </div>
    <div id="console" class="console">System ready.</div>
</div>

<div class="row">
    <div class="card">
        <h2>WhatsApp Pairing</h2>
        <form action="/code" method="GET">
            <label>Your WhatsApp Number</label>
            <input type="text" name="number" placeholder="e.g. 923001234567" required>
            <div class="btnrow"><button type="submit">Generate Pairing Code</button></div>
        </form>
    </div>

    <div class="card">
        <h2>Session Management</h2>
        <form action="/code" method="GET">
            <label>Your WhatsApp Number</label>
            <input type="text" name="number" placeholder="e.g. 923001234567" required>
            <div class="btnrow"><button type="submit">Generate Pairing Code</button></div>
        </form>
        <label>Your Session ID</label>
        <input type="text" id="mySession" placeholder="Paste your Session ID here">
        <div class="btnrow">
            <button onclick="showSession()">Show My Session</button>
            <a class="btn" href="/get-groups">Show My Groups</a>
            <button onclick="stopSession()">Stop My Session</button>
        </div>
    </div>
</div>

<div class="card">
    <h2>Send Messages</h2>
    <form action="/send-message" method="POST" enctype="multipart/form-data">
        <div class="row">
            <div>
                <label>Target Type</label>
                <select name="targetType">
                    <option value="phone">Phone Number</option>
                    <option value="group">Group ID</option>
                </select>
                <label>Target Number / Group ID</label>
                <input type="text" name="target" required>
                <label>Delay (Seconds)</label>
                <input type="number" name="delaySec" min="1" value="5" required>
            </div>
            <div>
                <label>Message File (.txt)</label>
                <input type="file" name="messageFile" accept=".txt" required>
                <label>Message Prefix (Optional)</label>
                <input type="text" name="prefix" placeholder="Optional">
            </div>
        </div>
        <div class="btnrow"><button type="submit">Start Sending Messages</button></div>
    </form>
</div>

<div class="card">
    <h2>View Session Tasks</h2>
    <label>Enter Your Session ID</label>
    <input type="text" id="taskSession" placeholder="Session ID">
    <div class="btnrow"><button onclick="showTasks()">Show My Tasks</button></div>
</div>

<script>
function log(m){var c=document.getElementById('console');c.textContent+='\\n'+m;c.scrollTop=c.scrollHeight;}
function refresh(){fetch('/api/stats').then(function(r){return r.json()}).then(function(d){
document.getElementById('stMsgs').textContent=d.totalMessagesSent;
document.getElementById('stSess').textContent=d.activeSessions;
document.getElementById('stTasks').textContent=d.activeTasks;
document.getElementById('stUp').textContent=d.uptime;
log('['+new Date().toLocaleString()+'] Stats refreshed.');});}
function info(){fetch('/api/stats').then(function(r){return r.json()}).then(function(d){
log('System: WALEED WhatsApp Panel');
log('Total Messages Sent: '+d.totalMessagesSent);
log('Total Sessions: '+d.totalSessions);
log('Total Tasks: '+d.totalTasks);
log('Successful Tasks: '+d.successfulTasks);
log('Failed Tasks: '+d.failedTasks);
log('Errors: '+d.errors);
log('Uptime: '+d.uptime);});}
function sessions(){fetch('/api/sessions').then(function(r){return r.json()}).then(function(list){
if(!list.length){log('No active sessions.');return;}
list.forEach(function(s){log('Session '+s.sessionId+' | '+s.number+' | '+(s.isConnected?'CONNECTED':'DISCONNECTED')+' | tasks: '+s.taskCount);});});}
function clearLogs(){document.getElementById('console').textContent='System ready.';}
function sid(id){var v=document.getElementById(id).value.trim();if(!v){log('Please enter your Session ID first.');}return v;}
function showSession(){var v=sid('mySession');if(v)location.href='/session-status?sessionId='+encodeURIComponent(v);}
function showTasks(){var v=sid('taskSession');if(v)location.href='/session-status?sessionId='+encodeURIComponent(v);}
function stopSession(){var v=sid('mySession');if(!v)return;
var f=document.createElement('form');f.method='POST';f.action='/stop-session';
var i=document.createElement('input');i.type='hidden';i.name='sessionId';i.value=v;
f.appendChild(i);document.body.appendChild(f);f.submit();}
refresh();
</script>
`));
});

// ============ /code — ORIGINAL LOGIC, SIRF HTML THEMED ============
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

            res.send(themePage("Pairing Code — WALEED", `
<div class="card">
    <h2>Pairing Code</h2>
    <p class="big ok">${code}</p>
    <p>Save this code to pair your device</p>
    <h2>To pair your device:</h2>
    <ul>
        <li>Open WhatsApp on your phone</li>
        <li>Go to Settings → Linked Devices → Link a Device</li>
        <li>Enter this pairing code when prompted</li>
        <li>After pairing, start sending messages</li>
    </ul>
    <h2>Your Session ID</h2>
    <p class="big">${sessionId}</p>
    <p>Save this Session ID to manage your tasks</p>
    <div class="btnrow"><a class="btn" href="/">Go Back to Home</a></div>
</div>`));
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
        res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Error</h2><p>${err.message}</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }
});

// ORIGINAL reconnect logic — UNCHANGED
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

// ============ SEND MESSAGE — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix } = req.body;
    const userIP = req.userIP;

    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">No Active Session</h2>
<p>Error: No active WhatsApp session found. Please generate a pairing code first.</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    const clientInfo = activeClients.get(sessionId);
    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Missing Fields</h2><p>Error: Missing required fields</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");

        if (messages.length === 0) {
            return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Empty File</h2><p>Error: Message file is empty</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
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

        res.send(themePage("Task Started — WALEED", `
<div class="card"><h2 class="ok">Task Started ✔</h2>
<p>Messages task started successfully!</p>
<p>Task ID: <b>${taskId}</b></p>
<p>Target: <b>${target}</b> (${targetType})</p>
<div class="btnrow"><a class="btn" href="/">Go Back to Home</a></div></div>`));

        sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber);

    } catch (error) {
        console.error(`[${sessionId}] Error:`, error);
        systemStats.errors++;
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Error</h2><p>Error: ${error.message}</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }
});

// ORIGINAL message loop — UNCHANGED
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

// ============ SESSION STATUS — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.get("/session-status", (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(themePage("Session Not Found — WALEED", `
<div class="card"><h2 class="err">Session Not Found</h2>
<p>Session ID ${sessionId} not found or expired.</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    const clientInfo = activeClients.get(sessionId);

    res.send(themePage("Session Status — WALEED", `
<div class="card">
    <h2>Session: ${sessionId}</h2>
    <p>WhatsApp: <b>${clientInfo.number}</b></p>
    <p>${clientInfo.isConnected ? '<span class="ok">🟢 CONNECTED</span>' : '<span class="err">🔴 DISCONNECTED</span>'}</p>
    <p>Last active: ${new Date(clientInfo.lastActivity).toLocaleString()}</p>
</div>
${clientInfo.tasks && clientInfo.tasks.length > 0 ? `
<div class="card">
    <h2>Active Tasks (${clientInfo.tasks.length})</h2>
    ${clientInfo.tasks.map(task => `
    <table>
        <tr><td><b>${task.target}</b> (${task.targetType})</td></tr>
        <tr><td>Task ID: <b>${task.taskId}</b></td></tr>
        <tr><td>Status: ${task.isSending ? '<span class="ok">🔄 RUNNING</span>' : task.stopRequested ? '<span class="err">⏹️ STOPPED</span>' : 'COMPLETED'}</td></tr>
        <tr><td>Sent: <b>${task.sentMessages}</b> ${task.currentCycle ? '(Cycle ' + task.currentCycle + ')' : ''} | Total: ${task.totalMessages} per cycle</td></tr>
        <tr><td>Start: ${task.startTime.toLocaleString()} | Mode: Continuous Loop</td></tr>
        <tr><td>Progress: ${Math.round((task.sentMessages / task.totalMessages) * 100)}%</td></tr>
        <tr><td><a class="btn" href="/task-logs?sessionId=${sessionId}&taskId=${task.taskId}">View Logs</a></td></tr>
    </table>`).join('')}
</div>` : `
<div class="card"><h2>No Active Tasks</h2><p>This session has no active message sending tasks.</p></div>`}
<div class="btnrow"><a class="btn" href="/">Go Back</a></div>`));
});

// ============ TASK LOGS — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.get("/task-logs", (req, res) => {
    const { sessionId, taskId } = req.query;
    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Invalid Session or Task ID</h2>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    const logs = taskLogs.get(taskId) || [];
    const clientInfo = activeClients.get(sessionId);
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);

    if (!taskInfo) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Task not found</h2>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    let logsHtml = '';
    logs.forEach(log => {
        logsHtml += `<tr><td class="${log.type === 'error' ? 'err' : log.type === 'success' ? 'ok' : ''}">${log.message}<br><small>${log.details}</small></td></tr>`;
    });

    if (logs.length === 0) {
        logsHtml = '<tr><td>No logs yet. Messages will start sending shortly...</td></tr>';
    }

    res.send(themePage("Task Logs — WALEED", `
${taskInfo.isSending ? '<meta http-equiv="refresh" content="10">' : ''}
<div class="card">
    <h2>Task Logs</h2>
    <p>Task ID: <b>${taskId}</b> | Status: ${taskInfo.isSending ? '<span class="ok">RUNNING</span>' : taskInfo.stopRequested ? '<span class="err">STOPPED</span>' : 'COMPLETED'}</p>
    <p>Target: <b>${taskInfo.target}</b> (${taskInfo.targetType})</p>
    <p>Sent: <b>${taskInfo.sentMessages}</b> of ${taskInfo.totalMessages}</p>
    <p>Start: ${taskInfo.startTime.toLocaleString()}</p>
    ${taskInfo.endTime ? '<p>End: ' + taskInfo.endTime.toLocaleString() + '</p>' : ''}
    ${taskInfo.error ? '<p class="err">Error: ' + taskInfo.error + '</p>' : ''}
    <p>${taskInfo.isSending ? '<i>Auto-refresh every 10 sec</i>' : ''}</p>
</div>
<div class="card">
    <h2>Live Logs (Newest First)</h2>
    <table>${logsHtml}</table>
</div>
<div class="btnrow"><a class="btn" href="/session-status?sessionId=${sessionId}">Return to Session Status</a></div>`));
});

app.post("/view-session", (req, res) => {
    const { sessionId } = req.body;
    res.redirect(`/session-status?sessionId=${sessionId}`);
});

// ============ STOP SESSION — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.post("/stop-session", async (req, res) => {
    const { sessionId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Invalid Session ID</h2>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
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

        res.send(themePage("Session Stopped — WALEED", `
<div class="card"><h2 class="ok">Session Stopped ✔</h2>
<p>Session ${sessionId} stopped successfully</p>
<p>All tasks in this session have been stopped.</p>
<div class="btnrow"><a class="btn" href="/">Go Back to Home</a></div></div>`));

    } catch (error) {
        console.error(`Error stopping session ${sessionId}:`, error);
        res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Error stopping session</h2><p>${error.message}</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }
});

// ============ STOP TASK — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.post("/stop-task", async (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Invalid Session ID</h2>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);

        if (!taskInfo) {
            return res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Task not found</h2>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
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

        res.send(themePage("Task Stopped — WALEED", `
<div class="card"><h2 class="ok">Task Stopped ✔</h2>
<p>Task ${taskId} stopped successfully.</p>
<div class="btnrow"><a class="btn" href="/session-status?sessionId=${sessionId}">Back to Session</a></div></div>`));

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Error stopping task</h2><p>${error.message}</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }
});

// ============ GET GROUPS — ORIGINAL LOGIC, SIRF HTML THEMED ============
app.get("/get-groups", async (req, res) => {
    const userIP = req.userIP;

    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(themePage("No Active Session — WALEED", `
<div class="card"><h2 class="err">No Active Session</h2>
<p>Please generate a pairing code first to connect your WhatsApp account.</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
    }

    try {
        const { client: waClient, number: senderNumber } = activeClients.get(sessionId);
        const groups = await waClient.groupFetchAllParticipating();

        let groupsList = `
<div class="card"><h2>Connected as: ${senderNumber}</h2></div>`;

        if (Object.keys(groups).length === 0) {
            groupsList += `
<div class="card"><h2>No Groups Found</h2><p>You are not a member of any WhatsApp groups.</p></div>`;
        } else {
            groupsList += `<div class="card"><h2>Your Groups</h2>`;

            Object.keys(groups).forEach((groupId, index) => {
                const group = groups[groupId];
                const cleanGroupId = groupId.replace('@g.us', '');
                const participantsCount = group.participants ? group.participants.length : 0;
                const creationDate = group.creation ? new Date(group.creation * 1000).toLocaleDateString() : 'Unknown';

                groupsList += `
<table>
    <tr><td><b>${index + 1}. ${group.subject || 'Unknown Group'}</b></td></tr>
    <tr><td>Group UID: <b>${cleanGroupId}</b></td></tr>
    <tr><td>Participants: ${participantsCount} | Created: ${creationDate} | Status: <span class="ok">Active</span></td></tr>
    <tr><td><button onclick="copyUid('${cleanGroupId}')">Copy UID</button></td></tr>
</table>`;
            });

            groupsList += `</div>
<div class="card"><p>Total ${Object.keys(groups).length} groups loaded</p></div>`;
        }

        groupsList += `
<div class="btnrow"><a class="btn" href="/">Go Back</a></div>
<script>function copyUid(t){navigator.clipboard.writeText(t);alert('Group UID copied: '+t);}</script>`;

        res.send(themePage("My Groups — WALEED", groupsList));

    } catch (error) {
        console.error("Error fetching groups:", error);
        res.send(themePage("Error — WALEED", `
<div class="card"><h2 class="err">Error Loading Groups</h2><p>${error.message}</p>
<div class="btnrow"><a class="btn" href="/">Go Back</a></div></div>`));
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
    console.log(`🚀  𝑾 𝐀 𝐋 𝐄 𝐄 𝑫  🔥 Server Started on http://localhost:${PORT}`);
    console.log(`✅ All Systems Integrated Successfully!`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
});
