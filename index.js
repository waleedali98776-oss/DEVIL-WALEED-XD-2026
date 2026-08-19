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
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Whatsapp Server ༒︎    𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑    ༒︎⁩</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
        <style>
            /* COMPACT CYBER NEON THEME - SMALLER TEXT, COMPACT BOXES */
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
            
            :root {
                --neon-cyan: #00f3ff;
                --neon-pink: #ff00ff;
                --neon-purple: #bc13fe;
                --neon-blue: #0ff0fe;
                --dark-bg: #0a0a0f;
                --darker-bg: #050508;
                --glass-bg: rgba(10, 10, 20, 0.7);
                --glass-border: rgba(0, 243, 255, 0.3);
                --neon-glow: 0 0 8px rgba(0, 243, 255, 0.4), 0 0 12px rgba(0, 243, 255, 0.2);
                --neon-glow-pink: 0 0 8px rgba(255, 0, 255, 0.4);
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Inter', 'JetBrains Mono', sans-serif;
                background: radial-gradient(ellipse at 20% 30%, #0a0a0f, #030308);
                min-height: 100vh;
                padding: 15px;
                position: relative;
                overflow-x: hidden;
                font-size: 13px;
            }
            
            body::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: 
                    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 243, 255, 0.02) 2px, rgba(0, 243, 255, 0.02) 4px),
                    repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255, 0, 255, 0.02) 2px, rgba(255, 0, 255, 0.02) 4px);
                pointer-events: none;
                z-index: 0;
            }

            .container {
                max-width: 1400px;
                margin: 0 auto;
                position: relative;
                z-index: 1;
            }
            
            .glass-card {
                background: var(--glass-bg);
                backdrop-filter: blur(12px);
                border-radius: 12px;
                border: 1px solid var(--glass-border);
                box-shadow: var(--neon-glow);
                transition: all 0.3s ease;
            }
            
            .glass-card:hover {
                border-color: var(--neon-cyan);
                box-shadow: var(--neon-glow);
                transform: translateY(-1px);
            }

            .header {
                text-align: center;
                margin-bottom: 20px;
                padding: 20px;
                background: var(--glass-bg);
                backdrop-filter: blur(12px);
                border-radius: 16px;
                border: 1px solid var(--neon-cyan);
                box-shadow: var(--neon-glow);
                position: relative;
                overflow: hidden;
            }
            
            .header::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: linear-gradient(45deg, transparent, rgba(0, 243, 255, 0.06), transparent);
                transform: rotate(45deg);
                animation: scan 4s linear infinite;
            }
            
            @keyframes scan {
                0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
                100% { transform: translateX(100%) translateY(100%) rotate(45deg); }
            }

            .logo {
                font-size: 1.8rem;
                font-weight: 700;
                background: linear-gradient(135deg, var(--neon-cyan), var(--neon-pink), var(--neon-purple));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 5px;
                text-shadow: 0 0 12px rgba(0, 243, 255, 0.4);
                letter-spacing: 2px;
                animation: glitch 3s infinite;
                position: relative;
            }
            
            @keyframes glitch {
                0%, 100% { transform: skew(0deg, 0deg); opacity: 1; }
                95% { transform: skew(0deg, 0deg); opacity: 1; }
                96% { transform: skew(3deg, 1deg); opacity: 0.8; text-shadow: -1px 0 var(--neon-pink), 1px 0 var(--neon-cyan); }
                97% { transform: skew(-2deg, -0.5deg); opacity: 0.9; }
                98% { transform: skew(0deg, 0deg); opacity: 1; }
            }

            .tagline {
                color: var(--neon-cyan);
                opacity: 0.8;
                margin-bottom: 12px;
                font-weight: 600;
                letter-spacing: 2px;
                font-size: 0.7rem;
                text-transform: uppercase;
                text-shadow: 0 0 6px var(--neon-cyan);
            }

            .system-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                gap: 12px;
                margin: 15px 0 0 0;
            }

            .stat-card {
                background: var(--glass-bg);
                padding: 10px;
                border-radius: 10px;
                text-align: center;
                border: 1px solid var(--glass-border);
                backdrop-filter: blur(12px);
                transition: all 0.2s ease;
                position: relative;
                overflow: hidden;
            }
            
            .stat-card::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 2px;
                background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink));
                transform: scaleX(0);
                transition: transform 0.2s ease;
            }
            
            .stat-card:hover::after {
                transform: scaleX(1);
            }
            
            .stat-card:hover {
                border-color: var(--neon-cyan);
                box-shadow: var(--neon-glow);
                transform: translateY(-2px);
            }

            .stat-number {
                font-size: 1.4rem;
                font-weight: 700;
                background: linear-gradient(135deg, var(--neon-cyan), var(--neon-pink));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 4px;
                font-family: 'JetBrains Mono', monospace;
            }

            .stat-label {
                font-size: 0.65rem;
                opacity: 0.8;
                color: #ccc;
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 15px;
                margin-bottom: 20px;
            }

            .card {
                background: var(--glass-bg);
                backdrop-filter: blur(12px);
                padding: 15px;
                border-radius: 12px;
                border: 1px solid var(--glass-border);
                transition: all 0.2s ease;
                position: relative;
            }

            .card:hover {
                transform: translateY(-2px);
                border-color: var(--neon-pink);
                box-shadow: var(--neon-glow-pink);
            }

            .card-header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(0, 243, 255, 0.3);
            }

            .card-icon {
                width: 32px;
                height: 32px;
                background: linear-gradient(135deg, var(--neon-cyan), var(--neon-pink));
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1rem;
                color: white;
                box-shadow: 0 0 10px rgba(0, 243, 255, 0.4);
            }

            .card-title {
                font-size: 0.9rem;
                font-weight: 600;
                color: var(--neon-cyan);
                text-shadow: 0 0 6px rgba(0, 243, 255, 0.4);
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .form-group {
                margin-bottom: 10px;
            }

            .form-label {
                display: block;
                margin-bottom: 4px;
                font-weight: 600;
                color: var(--neon-cyan);
                font-size: 0.7rem;
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .form-input, .form-select {
                width: 100%;
                padding: 8px 10px;
                background: rgba(0, 0, 0, 0.6);
                border: 1px solid var(--neon-cyan);
                border-radius: 6px;
                color: #fff;
                font-size: 0.75rem;
                font-family: 'JetBrains Mono', monospace;
                transition: all 0.2s ease;
            }

            .form-input:focus, .form-select:focus {
                outline: none;
                background: rgba(0, 0, 0, 0.8);
                border-color: var(--neon-pink);
                box-shadow: 0 0 8px rgba(255, 0, 255, 0.3);
            }

            .form-input::placeholder {
                color: rgba(255, 255, 255, 0.3);
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.7rem;
            }

            .btn {
                width: 100%;
                padding: 8px 12px;
                background: linear-gradient(135deg, var(--neon-cyan), var(--neon-pink));
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 0.75rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-top: 6px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                font-family: 'Inter', sans-serif;
                position: relative;
                overflow: hidden;
            }
            
            .btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.4s ease;
            }
            
            .btn:hover::before {
                left: 100%;
            }

            .btn:hover {
                opacity: 0.9;
                transform: scale(1.01);
                box-shadow: 0 0 12px rgba(0, 243, 255, 0.4);
            }

            .btn-secondary {
                background: linear-gradient(135deg, #6c757d, #495057);
            }

            .btn-danger {
                background: linear-gradient(135deg, #ff0055, #ff00ff);
            }

            .btn-warning {
                background: linear-gradient(135deg, #ffaa00, #ff6600);
                color: white;
            }
            
            .btn-info {
                background: linear-gradient(135deg, var(--neon-blue), #0066ff);
            }

            #pairingResult, #sessionTasksResult {
                margin-top: 10px;
                padding: 10px;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px);
                border-radius: 8px;
                border: 1px solid rgba(0, 243, 255, 0.3);
                font-size: 0.7rem;
            }

            .system-controls {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-top: 10px;
            }

            .system-panel {
                background: var(--glass-bg);
                backdrop-filter: blur(12px);
                padding: 15px;
                border-radius: 12px;
                margin-bottom: 15px;
                border: 1px solid var(--glass-border);
            }

            .panel-title {
                font-size: 0.9rem;
                color: var(--neon-cyan);
                text-shadow: 0 0 6px rgba(0, 243, 255, 0.4);
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 6px;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                font-weight: 600;
            }

            .live-data {
                background: rgba(0, 0, 0, 0.6);
                padding: 10px;
                border-radius: 8px;
                margin-top: 10px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.7rem;
                max-height: 150px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: var(--neon-cyan) rgba(0,0,0,0.2);
                color: var(--neon-cyan);
                border: 1px solid rgba(0, 243, 255, 0.3);
            }

            .live-data::-webkit-scrollbar {
                width: 4px;
            }

            .live-data::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
                border-radius: 2px;
            }

            .live-data::-webkit-scrollbar-thumb {
                background: var(--neon-cyan);
                border-radius: 2px;
            }

            .console-footer {
                background: var(--glass-bg);
                backdrop-filter: blur(12px);
                padding: 15px;
                border-radius: 12px;
                margin-top: 20px;
                border: 1px solid var(--glass-border);
            }

            .console-output {
                background: rgba(0, 0, 0, 0.8);
                padding: 10px;
                border-radius: 8px;
                max-height: 200px;
                overflow-y: auto;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.65rem;
                color: var(--neon-cyan);
                scrollbar-width: thin;
                scrollbar-color: var(--neon-cyan) rgba(0,0,0,0.2);
                border: 1px solid rgba(0, 243, 255, 0.3);
            }

            .console-output::-webkit-scrollbar {
                width: 4px;
            }

            .console-output::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
                border-radius: 2px;
            }

            .console-output::-webkit-scrollbar-thumb {
                background: var(--neon-cyan);
                border-radius: 2px;
            }

            .console-log {
                padding: 4px 8px;
                margin: 3px 0;
                border-left: 2px solid var(--neon-cyan);
                border-radius: 3px;
                font-size: 0.6rem;
            }

            .console-info {
                color: var(--neon-blue);
                border-left-color: var(--neon-blue);
                background: rgba(0, 240, 255, 0.04);
            }

            .console-success {
                color: #00ff88;
                border-left-color: #00ff88;
                background: rgba(0, 255, 136, 0.04);
            }

            .console-error {
                color: #ff0055;
                border-left-color: #ff0055;
                background: rgba(255, 0, 85, 0.04);
            }

            .console-warning {
                color: #ffaa00;
                border-left-color: #ffaa00;
                background: rgba(255, 170, 0, 0.04);
            }
            
            hr {
                border-color: rgba(0, 243, 255, 0.3);
                margin: 12px 0;
            }
            
            a {
                color: var(--neon-cyan);
                text-decoration: none;
                transition: all 0.2s ease;
                font-size: 0.7rem;
            }
            
            a:hover {
                color: var(--neon-pink);
                text-decoration: none;
                text-shadow: 0 0 6px var(--neon-pink);
            }
            
            .neon-text {
                text-shadow: 0 0 4px var(--neon-cyan), 0 0 6px var(--neon-cyan);
            }
            
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* Compact text adjustments */
            p, li, .small-text {
                font-size: 0.7rem;
                line-height: 1.4;
            }

            h2, h3, h4 {
                font-size: 0.9rem;
                margin-bottom: 8px;
            }

            .task-item {
                font-size: 0.7rem;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header glass-card">
                <div class="logo">
                    <i class="fab fa-whatsapp"></i> ༒︎    𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑    ༒︎⁩
                </div>
                <div class="tagline">ɪ ᴀᴍ ᴀ ᴅᴇᴠɪʟ ᴏꜰ ᴍʏ ᴡᴏʀʟᴅ</div>
                
                <div class="system-stats" id="systemStats">
                    <div class="stat-card">
                        <div class="stat-number" id="statMessages">0</div>
                        <div class="stat-label">Total Msgs</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statSessions">0</div>
                        <div class="stat-label">Sessions</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statTasks">0</div>
                        <div class="stat-label">Active Tasks</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="statUptime">0h 0m</div>
                        <div class="stat-label">Uptime</div>
                    </div>
                </div>
            </div>

            <!-- System Control Panel -->
            <div class="system-panel glass-card">
                <div class="panel-title">
                    <i class="fas fa-cogs"></i> SYSTEM CONTROL
                </div>
                <div class="system-controls">
                    <button class="btn btn-secondary" onclick="refreshSystemStats()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                    <button class="btn btn-warning" onclick="showSystemInfo()">
                        <i class="fas fa-info-circle"></i> Info
                    </button>
                    <button class="btn" onclick="showAllSessions()">
                        <i class="fas fa-list"></i> Sessions
                    </button>
                    <button class="btn btn-danger" onclick="clearAllLogs()">
                        <i class="fas fa-trash"></i> Clear Logs
                    </button>
                </div>
                <div class="live-data" id="systemInfo">
                    <i class="fas fa-terminal"></i> System ready.
                </div>
            </div>

            <div class="grid">
                <!-- WhatsApp Pairing -->
                <div class="card glass-card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-qrcode"></i>
                        </div>
                        <div class="card-title">WhatsApp Pairing</div>
                    </div>
                    <form id="pairingForm">
                        <div class="form-group">
                            <label class="form-label">Your WhatsApp Number</label>
                            <input type="text" class="form-input" id="numberInput" placeholder="263786333562" required>
                        </div>
                        <button type="button" class="btn" onclick="generatePairingCode()">
                            Generate Pairing Code
                        </button>
                    </form>
                    <div id="pairingResult"></div>
                </div>

                <!-- Send Messages -->
                <div class="card glass-card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-paper-plane"></i>
                        </div>
                        <div class="card-title">Send Messages</div>
                    </div>
                    <form action="/send-message" method="POST" enctype="multipart/form-data">
                        <div class="form-group">
                            <label class="form-label">Target Type</label>
                            <select class="form-select" name="targetType" required>
                                <option value="">Select Type</option>
                                <option value="number">Phone Number</option>
                                <option value="group">Group ID</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Target Number/Group ID</label>
                            <input type="text" class="form-input" name="target" placeholder="263786333562" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Message File (.txt)</label>
                            <input type="file" class="form-input" name="messageFile" accept=".txt" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Message Prefix (Optional)</label>
                            <input type="text" class="form-input" name="prefix" placeholder="Hello! ">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Delay (Seconds)</label>
                            <input type="number" class="form-input" name="delaySec" min="5" value="10" required>
                        </div>
                        <button type="submit" class="btn">Start Sending Messages</button>
                    </form>
                </div>

                <!-- Session Management -->
                <div class="card glass-card">
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-cog"></i>
                        </div>
                        <div class="card-title">Session Management</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Your WhatsApp Number</label>
                        <input type="text" class="form-input" id="numberInputForSession" placeholder="786333562" required>
                    </div>
                    <button type="button" class="btn" onclick="generatePairingCodeForSession()">
                        Generate Pairing Code
                    </button>
                    <div id="pairingResult"></div>
                    
                    <hr>

                    <div class="form-group">
                        <label class="form-label">Your Session ID</label>
                        <input type="text" class="form-input" id="sessionIdDisplay" readonly>
                    </div>
                    <button class="btn btn-secondary" onclick="showMySessionId()">Show My Session</button>
                    <button class="btn btn-info" onclick="getMyGroups()" style="margin-top: 6px;">Show My Groups</button>
                    <button class="btn btn-danger" onclick="stopMySession()" style="margin-top: 6px;">Stop My Session</button>
                </div>

                <!-- View Session Tasks -->
                <div class="card glass-card">  
                    <div class="card-header">
                        <div class="card-icon">
                            <i class="fas fa-tasks"></i>
                        </div>
                        <div class="card-title">View Session Tasks</div>
                    </div>
                    <form id="viewSessionForm" onsubmit="event.preventDefault(); viewSessionTasks();">
                        <div class="form-group">
                            <label class="form-label">Enter Your Session ID</label>
                            <input type="text" class="form-input" id="sessionIdInput" placeholder="Enter your session ID" required>
                        </div>
                        <button type="submit" class="btn">
                            Show My Tasks
                        </button>
                    </form>
                    <div id="sessionTasksResult" style="margin-top: 10px;"></div>
                </div>
            </div>

            <!-- Console Footer -->
            <div class="console-footer glass-card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h4 style="margin: 0; color: var(--neon-cyan); display: flex; align-items: center; gap: 6px; font-weight: 600; letter-spacing: 0.5px; font-size: 0.8rem;">
                        <i class="fas fa-terminal"></i> SYSTEM CONSOLE
                    </h4>
                    <div style="display: flex; gap: 6px;">
                        <button onclick="clearConsole()" style="
                            background: linear-gradient(135deg, #ff0055, #ff00ff);
                            color: white;
                            border: none;
                            padding: 4px 10px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 0.65rem;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            font-family: 'Inter', sans-serif;
                        ">
                            <i class="fas fa-trash"></i> Clear
                        </button>
                    </div>
                </div>
                <div id="consoleOutput" class="console-output"></div>
            </div>
        </div>

        <script>
            // System Functions
            async function refreshSystemStats() {
                try {
                    const response = await fetch('/api/stats');
                    const stats = await response.json();
                    
                    document.getElementById('statMessages').textContent = stats.totalMessagesSent.toLocaleString();
                    document.getElementById('statSessions').textContent = stats.activeSessions;
                    document.getElementById('statTasks').textContent = stats.activeTasks;
                    document.getElementById('statUptime').textContent = stats.uptime;
                    
                    showNotification('ᴹᴿメ𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑', 'success');
                } catch (error) {
                    showNotification('Error updating stats', 'error');
                }
            }

            async function showSystemInfo() {
                try {
                    const response = await fetch('/api/stats');
                    const stats = await response.json();
                    
                    const info = \`
┌─────────────────────────────────┐
│      SYSTEM INFORMATION         │
├─────────────────────────────────┤
│ Total Msgs: \${stats.totalMessagesSent.toLocaleString()}
│ Active Sessions: \${stats.activeSessions}
│ Running Tasks: \${stats.activeTasks}
│ Uptime: \${stats.uptime}
│ Errors: \${stats.errors}
│ Server Time: \${new Date(stats.timestamp).toLocaleString()}
└─────────────────────────────────┘
                    \`.trim();
                    
                    document.getElementById('systemInfo').innerHTML = '<i class="fas fa-info-circle"></i> ' + info.replace(/\\n/g, '<br>');
                } catch (error) {
                    document.getElementById('systemInfo').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error loading system info';
                }
            }

            async function showAllSessions() {
                try {
                    const response = await fetch('/api/sessions');
                    const sessions = await response.json();
                    
                    if (sessions.length === 0) {
                        document.getElementById('systemInfo').innerHTML = '<i class="fas fa-database"></i> No active sessions found.';
                        return;
                    }
                    
                    let sessionInfo = '<i class="fas fa-users"></i> ACTIVE SESSIONS:<br><br>';
                    sessions.forEach(session => {
                        sessionInfo += \`<strong>┌ Session:</strong> \${session.sessionId}<br>\`;
                        sessionInfo += \`<strong>├ Number:</strong> \${session.number}<br>\`;
                        sessionInfo += \`<strong>├ Status:</strong> <span style="color: \${session.isConnected ? '#00ff88' : '#ff0055'}">\${session.isConnected ? '● CONNECTED' : '○ DISCONNECTED'}</span><br>\`;
                        sessionInfo += \`<strong>├ Tasks:</strong> \${session.taskCount}<br>\`;
                        sessionInfo += \`<strong>└ Last Activity:</strong> \${new Date(session.lastActivity).toLocaleString()}<br><br>\`;
                    });
                    
                    document.getElementById('systemInfo').innerHTML = sessionInfo;
                } catch (error) {
                    document.getElementById('systemInfo').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error loading sessions';
                }
            }

            function clearAllLogs() {
                if (confirm('Clear all system logs?')) {
                    document.getElementById('systemInfo').innerHTML = '<i class="fas fa-check-circle"></i> All logs cleared.';
                    showNotification('System logs cleared', 'warning');
                }
            }

            // WhatsApp Functions
            async function generatePairingCode() {
                const number = document.getElementById('numberInput').value;
                if (!number) {
                    showNotification('Please enter your WhatsApp number', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/code?number=' + encodeURIComponent(number));
                    const result = await response.text();
                    document.getElementById('pairingResult').innerHTML = result;
                    refreshSystemStats();
                } catch (error) {
                    showNotification('Error generating pairing code', 'error');
                }
            }
            
            async function generatePairingCodeForSession() {
                const number = document.getElementById('numberInputForSession').value;
                if (!number) {
                    showNotification('Please enter your WhatsApp number', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/code?number=' + encodeURIComponent(number));
                    const result = await response.text();
                    document.getElementById('pairingResult').innerHTML = result;
                    refreshSystemStats();
                } catch (error) {
                    showNotification('Error generating pairing code', 'error');
                }
            }

            function showMySessionId() {
                const sessionId = localStorage.getItem('wa_session_id');
                if (sessionId) {
                    document.getElementById('sessionIdDisplay').value = sessionId;
                    showNotification('Session ID: ' + sessionId, 'success');
                } else {
                    showNotification('No active session found', 'warning');
                }
            }

            async function getMyGroups() {
                try {
                    const button = document.querySelector('button[onclick="getMyGroups()"]');
                    const originalText = button.innerHTML;
                    
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                    button.disabled = true;

                    const response = await fetch('/get-groups');
                    
                    if (!response.ok) {
                        throw new Error('Server error: ' + response.status);
                    }
                    
                    const result = await response.text();
                    showGroupsModal(result);
                    
                } catch (error) {
                    showNotification('Error loading groups: ' + error.message, 'error');
                } finally {
                    const button = document.querySelector('button[onclick="getMyGroups()"]');
                    button.innerHTML = 'Show My Groups';
                    button.disabled = false;
                }
            }

            async function stopMySession() {
                const sessionId = localStorage.getItem('wa_session_id');
                if (!sessionId) {
                    showNotification('No active session found', 'warning');
                    return;
                }
                
                if (confirm('Stop your session?')) {
                    try {
                        const response = await fetch('/stop-session', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: 'sessionId=' + encodeURIComponent(sessionId)
                        });
                        
                        if (response.ok) {
                            showNotification('Session stopped', 'success');
                            localStorage.removeItem('wa_session_id');
                            document.getElementById('sessionIdDisplay').value = '';
                            refreshSystemStats();
                        }
                    } catch (error) {
                        showNotification('Error stopping session', 'error');
                    }
                }
            }

            // Session Tasks Functions
            async function viewSessionTasks() {
                const sessionId = document.getElementById('sessionIdInput').value.trim();
                const button = document.querySelector('#viewSessionForm button');
                const originalText = button.innerHTML;
                
                if (!sessionId) {
                    showNotification('Please enter your Session ID', 'error');
                    return;
                }

                try {
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                    button.disabled = true;

                    const response = await fetch(\`/session-status?sessionId=\${encodeURIComponent(sessionId)}\`);
                    
                    if (!response.ok) {
                        if (response.status === 404) {
                            throw new Error('Session not found or expired');
                        }
                        throw new Error('Server error: ' + response.status);
                    }
                    
                    const result = await response.text();
                    showSessionTasksModal(result, sessionId);
                    
                } catch (error) {
                    document.getElementById('sessionTasksResult').innerHTML = \`
                        <div style="padding: 10px; background: rgba(255,0,85,0.1); border-radius: 8px; border: 1px solid #ff0055;">
                            <h4 style="color: #ff0055; margin-bottom: 6px; font-size: 0.8rem;">
                                <i class="fas fa-exclamation-triangle"></i> Error
                            </h4>
                            <p style="font-size: 0.7rem;">\${error.message}</p>
                        </div>
                    \`;
                } finally {
                    button.innerHTML = originalText;
                    button.disabled = false;
                }
            }

            function showSessionTasksModal(htmlContent, sessionId) {
                const existingModal = document.getElementById('sessionTasksModal');
                if (existingModal) {
                    existingModal.remove();
                }

                const modal = document.createElement('div');
                modal.id = 'sessionTasksModal';
                modal.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.95);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                    backdrop-filter: blur(12px);
                \`;

                modal.innerHTML = \`
                    <div style="
                        background: linear-gradient(135deg, #0a0a0f, #050508);
                        border: 1px solid #00f3ff;
                        border-radius: 12px;
                        padding: 15px;
                        max-width: 95%;
                        max-height: 95vh;
                        width: 900px;
                        overflow-y: auto;
                        color: white;
                        position: relative;
                        box-shadow: 0 0 25px rgba(0, 243, 255, 0.3);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #00f3ff;">
                            <h2 style="color: #00f3ff; margin: 0; display: flex; align-items: center; gap: 6px; font-family: 'Inter', sans-serif; font-size: 1rem;">
                                <i class="fas fa-tasks"></i>
                                Session Tasks - \${sessionId}
                            </h2>
                            <button onclick="closeSessionTasksModal()" style="
                                background: linear-gradient(135deg, #ff0055, #ff00ff);
                                color: white;
                                border: none;
                                border-radius: 50%;
                                width: 28px;
                                height: 28px;
                                font-size: 14px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">×</button>
                        </div>
                        
                        <div id="sessionTasksContent" style="max-height: 70vh; overflow-y: auto; font-size: 0.7rem;">
                            \${htmlContent}
                        </div>
                        
                        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #00f3ff; display: flex; gap: 8px; justify-content: flex-end;">
                            <button onclick="refreshSessionTasks('\${sessionId}')" style="
                                background: linear-gradient(135deg, #00f3ff, #00ff88);
                                color: black;
                                border: none;
                                padding: 6px 12px;
                                border-radius: 5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 4px;
                                font-family: 'Inter', sans-serif;
                                font-size: 0.7rem;
                            ">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                            <button onclick="closeSessionTasksModal()" style="
                                background: linear-gradient(135deg, #ff0055, #ff00ff);
                                color: white;
                                border: none;
                                padding: 6px 12px;
                                border-radius: 5px;
                                font-weight: 600;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                gap: 4px;
                                font-family: 'Inter', sans-serif;
                                font-size: 0.7rem;
                            ">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </div>
                    </div>
                \`;

                document.body.appendChild(modal);

                const hasRunningTasks = htmlContent.includes('status-running');
                if (hasRunningTasks) {
                    setTimeout(() => {
                        refreshSessionTasks(sessionId);
                    }, 10000);
                }
            }

            async function refreshSessionTasks(sessionId) {
                try {
                    const refreshButton = document.querySelector('button[onclick*="refreshSessionTasks"]');
                    const originalText = refreshButton.innerHTML;
                    
                    refreshButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                    refreshButton.disabled = true;

                    const response = await fetch(\`/session-status?sessionId=\${encodeURIComponent(sessionId)}\`);
                    
                    if (response.ok) {
                        const result = await response.text();
                        document.getElementById('sessionTasksContent').innerHTML = result;
                        showNotification('Tasks refreshed', 'success');
                        
                        const hasRunningTasks = result.includes('status-running');
                        if (hasRunningTasks) {
                            setTimeout(() => {
                                refreshSessionTasks(sessionId);
                            }, 10000);
                        }
                    }
                } catch (error) {
                    showNotification('Error refreshing tasks', 'error');
                } finally {
                    const refreshButton = document.querySelector('button[onclick*="refreshSessionTasks"]');
                    if (refreshButton) {
                        refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
                        refreshButton.disabled = false;
                    }
                }
            }

            function closeSessionTasksModal() {
                const modal = document.getElementById('sessionTasksModal');
                if (modal) {
                    modal.remove();
                }
            }

            // Groups Modal Functions
            function showGroupsModal(htmlContent) {
                const existingModal = document.getElementById('groupsModal');
                if (existingModal) {
                    existingModal.remove();
                }

                const modal = document.createElement('div');
                modal.id = 'groupsModal';
                modal.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.95);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                    backdrop-filter: blur(12px);
                \`;

                modal.innerHTML = \`
                    <div style="
                        background: linear-gradient(135deg, #0a0a0f, #050508);
                        border: 1px solid #00ff88;
                        border-radius: 12px;
                        padding: 15px;
                        max-width: 90%;
                        max-height: 90vh;
                        width: 750px;
                        overflow-y: auto;
                        color: white;
                        position: relative;
                        box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h2 style="color: #00ff88; margin: 0; display: flex; align-items: center; gap: 6px; font-family: 'Inter', sans-serif; font-size: 1rem;">
                                <i class="fas fa-users"></i>
                                Your WhatsApp Groups
                            </h2>
                            <button onclick="closeGroupsModal()" style="
                                background: linear-gradient(135deg, #ff0055, #ff00ff);
                                color: white;
                                border: none;
                                border-radius: 50%;
                                width: 28px;
                                height: 28px;
                                font-size: 14px;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            ">×</button>
                        </div>
                        
                        <div id="groupsModalContent" style="max-height: 60vh; overflow-y: auto; font-size: 0.7rem;">
                            \${htmlContent}
                        </div>
                        
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #00ff88;">
                            <button onclick="copyAllGroupUIDs()" style="
                                background: linear-gradient(135deg, #00f3ff, #00ff88);
                                color: black;
                                border: none;
                                padding: 6px 12px;
                                border-radius: 5px;
                                font-weight: 600;
                                cursor: pointer;
                                margin-right: 8px;
                                font-family: 'Inter', sans-serif;
                                font-size: 0.7rem;
                            ">
                                <i class="fas fa-copy"></i> Copy All UIDs
                            </button>
                            <button onclick="closeGroupsModal()" style="
                                background: linear-gradient(135deg, #ff0055, #ff00ff);
                                color: white;
                                border: none;
                                padding: 6px 12px;
                                border-radius: 5px;
                                font-weight: 600;
                                cursor: pointer;
                                font-family: 'Inter', sans-serif;
                                font-size: 0.7rem;
                            ">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </div>
                    </div>
                \`;

                document.body.appendChild(modal);
            }

            function closeGroupsModal() {
                const modal = document.getElementById('groupsModal');
                if (modal) {
                    modal.remove();
                }
            }

            function copyGroupUID(uid) {
                navigator.clipboard.writeText(uid).then(() => {
                    showNotification('Group UID copied: ' + uid, 'success');
                }).catch(err => {
                    showNotification('Failed to copy UID', 'error');
                });
            }

            function copyAllGroupUIDs() {
                const groupElements = document.querySelectorAll('.group-item');
                const allUIDs = Array.from(groupElements).map(element => {
                    const uidElement = element.querySelector('p strong:contains("Group ID:")')?.nextSibling;
                    return uidElement?.textContent?.trim() || '';
                }).filter(uid => uid !== '');
                
                if (allUIDs.length === 0) {
                    showNotification('No Group UIDs found to copy', 'warning');
                    return;
                }
                
                const uidsText = allUIDs.join('\\n');
                navigator.clipboard.writeText(uidsText).then(() => {
                    showNotification(\`Copied \${allUIDs.length} Group UIDs!\`, 'success');
                }).catch(err => {
                    showNotification('Failed to copy UIDs', 'error');
                });
            }

            // Utility Functions
            function showNotification(message, type = 'info') {
                const existingNotification = document.querySelector('.notification');
                if (existingNotification) {
                    existingNotification.remove();
                }

                const notification = document.createElement('div');
                notification.className = \`notification\`;
                notification.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 6px; 
                         background: linear-gradient(135deg, \${type === 'error' ? '#ff0055' : type === 'warning' ? '#ffaa00' : type === 'success' ? '#00ff88' : '#00f3ff'}, 
                         \${type === 'error' ? '#ff00ff' : type === 'warning' ? '#ff6600' : type === 'success' ? '#00cc66' : '#0066ff'});
                         color: \${type === 'success' ? 'black' : 'white'}; position: fixed; top: 15px; right: 15px; z-index: 1000; 
                         box-shadow: 0 3px 12px rgba(0,0,0,0.5); font-family: 'Inter', sans-serif; font-size: 0.7rem;">
                        <i class="fas fa-\${type === 'error' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                        <span>\${message}</span>
                    </div>
                \`;

                document.body.appendChild(notification);

                setTimeout(() => {
                    notification.remove();
                }, 4000);
            }

            function autoFillSessionId() {
                const savedSessionId = localStorage.getItem('wa_session_id');
                if (savedSessionId) {
                    document.getElementById('sessionIdInput').value = savedSessionId;
                }
            }

            // Event Listeners
            document.addEventListener('click', function(event) {
                const sessionModal = document.getElementById('sessionTasksModal');
                if (sessionModal && event.target === sessionModal) {
                    closeSessionTasksModal();
                }
                const groupsModal = document.getElementById('groupsModal');
                if (groupsModal && event.target === groupsModal) {
                    closeGroupsModal();
                }
            });

            document.addEventListener('keydown', function(event) {
                if (event.key === 'Escape') {
                    closeSessionTasksModal();
                    closeGroupsModal();
                }
            });

            // Console Log Functions
            function addConsoleLog(message, type = 'info') {
                const consoleOutput = document.getElementById('consoleOutput');
                const timestamp = new Date().toLocaleTimeString();
                const logEntry = document.createElement('div');
                logEntry.className = 'console-log console-' + type;
                logEntry.innerHTML = \`[\${timestamp}] \${message}\`;
                consoleOutput.insertBefore(logEntry, consoleOutput.firstChild);
                
                while (consoleOutput.children.length > 100) {
                    consoleOutput.removeChild(consoleOutput.lastChild);
                }
            }

            function clearConsole() {
                document.getElementById('consoleOutput').innerHTML = '';
                addConsoleLog('Console cleared', 'info');
            }

            // Initialize on load
            document.addEventListener('DOMContentLoaded', function() {
                const savedSessionId = localStorage.getItem('wa_session_id');
                if (savedSessionId) {
                    document.getElementById('sessionIdDisplay').value = savedSessionId;
                    document.getElementById('sessionIdInput').value = savedSessionId;
                }
                refreshSystemStats();
                setInterval(refreshSystemStats, 30000);
                
                addConsoleLog('═══════════════════════════', 'success');
                addConsoleLog('🔥 𝐋 𝐔 𝐂 𝐈 𝐅 𝐄 𝐑 🔥 SYSTEM', 'success');
                addConsoleLog('STATUS: ONLINE', 'success');
                addConsoleLog('═══════════════════════════', 'success');
                addConsoleLog('System ready', 'info');
            });

            // Override console methods
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;

            console.log = function(...args) {
                originalLog.apply(console, args);
                addConsoleLog(args.join(' '), 'info');
            };

            console.error = function(...args) {
                originalError.apply(console, args);
                addConsoleLog(args.join(' '), 'error');
            };

            console.warn = function(...args) {
                originalWarn.apply(console, args);
                addConsoleLog(args.join(' '), 'warning');
            };
        </script>
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
                <div style="margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.8); border-radius: 8px; border: 1px solid #00f3ff; box-shadow: 0 0 12px rgba(0,243,255,0.3);">
                    <h2 style="color: #00f3ff; font-family: 'Inter', monospace; font-size: 1rem;">Pairing Code: ${code}</h2>  
                    <p style="font-size: 0.7rem; margin-bottom: 12px;">Save this code to pair your device</p>
                    <div style="text-align: left; padding: 10px; background: rgba(0,0,0,0.6); border-radius: 8px; margin-bottom: 12px; border: 1px solid #ff00ff;">
                        <p style="font-size: 0.7rem;"><strong style="color: #ff00ff;">To pair your device:</strong></p>
                        <ol style="font-size: 0.7rem;">
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices → Link a Device</li>
                            <li>Enter this pairing code when prompted</li>
                            <li>After pairing, start sending messages</li>
                        </ol>
                    </div>
                    <p style="font-size: 0.7rem; margin-top: 12px;"><strong style="color: #00f3ff;">Your Session ID: ${sessionId}</strong></p>
                    <p style="font-size: 0.65rem;">Save this Session ID to manage your tasks</p>
                    <script>
                        localStorage.setItem('wa_session_id', '${sessionId}');
                    </script>
                    <a href="/" style="color: #00f3ff; font-size: 0.7rem;">Go Back to Home</a>  
                </div>  
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
        res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px; border: 1px solid #dc3545;"><br><a href="/" style="color: #00f3ff; font-size: 0.7rem;">Go Back</a>
                  </div>`);
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
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: No active WhatsApp session found. Please generate a pairing code first.</h2>
                        </div>`);
    }

    const clientInfo = activeClients.get(sessionId);
    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: Missing required fields</h2>
                        </div>`);
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
        
        if (messages.length === 0) {
            return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                              <h2 style="font-size: 0.9rem;">Error: Message file is empty</h2>
                            </div>`);
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
        
        res.send(`<script>
                    localStorage.setItem('wa_session_id', '${sessionId}');
                    window.location.href = '/session-status?sessionId=${sessionId}';
                  </script>`);
        
        sendMessagesLoop(sessionId, taskId, messages, waClient, target, targetType, delaySec, prefix, senderNumber);

    } catch (error) {
        console.error(`[${sessionId}] Error:`, error);
        systemStats.errors++;
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: ${error.message}</h2>
                        </div>`);
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
            <div style="padding: 20px; text-align: center; background: rgba(80,0,0,0.8); border-radius: 8px; border: 1px solid #ff0055;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ff0055; margin-bottom: 10px;"></i>
                <h3 style="color: #ff0055; margin-bottom: 8px; font-size: 0.9rem;">Session Not Found</h3>
                <p style="font-size: 0.7rem;">Session ID <strong>${sessionId}</strong> not found or expired.</p>
            </div>
        `);
    }

    const clientInfo = activeClients.get(sessionId);
    
    res.send(`
        <div style="padding: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.5); border-radius: 8px;">
                <div>
                    <h3 style="color: #00f3ff; margin: 0 0 4px 0; font-family: 'Inter', monospace; font-size: 0.85rem;">Session: ${sessionId}</h3>
                    <p style="margin: 0; color: #ddd; font-size: 0.7rem;">WhatsApp: ${clientInfo.number}</p>
                </div>
                <div style="text-align: right;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: ${clientInfo.isConnected ? '#00ff88' : '#ff0055'}; font-weight: 600; font-size: 0.7rem;">
                            ${clientInfo.isConnected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}
                        </span>
                    </div>
                    <p style="margin: 4px 0 0 0; font-size: 0.65rem; color: #aaa;">
                        Last active: ${new Date(clientInfo.lastActivity).toLocaleString()}
                    </p>
                </div>
            </div>
            
            ${clientInfo.tasks && clientInfo.tasks.length > 0 ? `
                <div style="margin-top: 12px;">
                    <h4 style="color: #00f3ff; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; font-family: 'Inter', monospace; font-size: 0.8rem;">
                        <i class="fas fa-list"></i>
                        Active Tasks (${clientInfo.tasks.length})
                    </h4>
                    <div class="task-list">
                        ${clientInfo.tasks.map(task => `
                            <div class="task-item" style="
                                background: rgba(0,0,0,0.6);
                                padding: 12px;
                                border-radius: 8px;
                                margin-bottom: 10px;
                                border-left: 3px solid ${task.isSending ? '#00ff88' : task.stopRequested ? '#ff0055' : '#ffaa00'};
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                                    <div style="flex: 1;">
                                        <h5 style="color: #00f3ff; margin: 0 0 6px 0; font-size: 0.75rem;">
                                            ${task.target} (${task.targetType})
                                        </h5>
                                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.65rem;">
                                            <div><strong>Task ID:</strong> ${task.taskId}</div>
                                            <div><strong>Status:</strong> 
                                                <span style="color: ${task.isSending ? '#00ff88' : task.stopRequested ? '#ff0055' : '#ffaa00'}; font-weight: 600;">
                                                    ${task.isSending ? '🔄 RUNNING' : task.stopRequested ? '⏹️ STOPPED' : 'COMPLETED'}
                                                </span>
                                            </div>
                                            <div><strong>Sent:</strong> ${task.sentMessages} ${task.currentCycle ? '(Cycle ' + task.currentCycle + ')' : ''}</div>
                                            <div><strong>Total:</strong> ${task.totalMessages} per cycle</div>
                                            <div><strong>Start:</strong> ${task.startTime.toLocaleString()}</div>
                                            <div><strong>Mode:</strong> Continuous Loop</div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div style="margin: 8px 0;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 0.65rem;">
                                        <span>Progress</span>
                                        <span>${Math.round((task.sentMessages / task.totalMessages) * 100)}%</span>
                                    </div>
                                    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                                        <div style="width: ${(task.sentMessages / task.totalMessages) * 100}%; height: 100%; background: linear-gradient(90deg, #00f3ff, #00ff88); border-radius: 2px;"></div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div style="text-align: center; padding: 30px 15px; color: #ffaa00;">
                    <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <h4 style="font-size: 0.8rem;">No Active Tasks</h4>
                    <p style="font-size: 0.7rem;">This session has no active message sending tasks.</p>
                </div>
            `}
        </div>
    `);
});

app.get("/task-logs", (req, res) => {
    const { sessionId, taskId } = req.query;
    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: Invalid Session or Task ID</h2>
                        </div>`);
    }

    const logs = taskLogs.get(taskId) || [];
    const clientInfo = activeClients.get(sessionId);
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    
    if (!taskInfo) {
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: Task not found</h2>
                        </div>`);
    }
    
    let logsHtml = '';
    logs.forEach(log => {
        logsHtml += '<div class="log-entry log-' + log.type + '">';
        logsHtml += '<div><strong>' + log.message + '</strong></div>';
        logsHtml += '<div>' + log.details + '</div>';
        logsHtml += '</div>';
    });
    
    if (logs.length === 0) {
        logsHtml = '<div class="log-entry log-info">No logs yet. Messages will start sending shortly...</div>';
    }
    
    res.send(`
        <html>
        <head>
            <title>Task Logs - ${taskId}</title>
            <style>
                body { 
                    background: #0a0a0f;
                    color: #e0e0e0;
                    font-family: 'Inter', 'JetBrains Mono', monospace;
                    text-align: center;
                    padding: 15px;
                    font-size: 0.7rem;
                }
                .container {
                    max-width: 900px;
                    margin: 0 auto;
                }
                .status-box {
                    background: rgba(0,0,0,0.8);
                    padding: 15px;
                    border-radius: 10px;
                    margin: 15px auto;
                    border: 1px solid #00f3ff;
                    text-align: center;
                    box-shadow: 0 0 12px rgba(0,243,255,0.3);
                }
                h1 {
                    color: #00f3ff;
                    text-shadow: 0 0 8px rgba(0,243,255,0.5);
                    font-size: 1.2rem;
                }
                .task-id {
                    font-size: 0.8rem;
                    background: rgba(0,0,0,0.7);
                    padding: 8px 12px;
                    border-radius: 6px;
                    display: inline-block;
                    margin: 10px 0;
                    border: 1px solid #ff00ff;
                    font-family: 'JetBrains Mono', monospace;
                }
                .status-item {
                    margin: 8px 0;
                    font-size: 0.7rem;
                }
                .status-value {
                    font-weight: bold;
                    color: #00ff88;
                }
                a {
                    display: inline-block;
                    margin-top: 15px;
                    padding: 8px 20px;
                    background: linear-gradient(135deg, #00f3ff, #00ff88);
                    color: black;
                    text-decoration: none;
                    font-weight: 600;
                    border-radius: 6px;
                    font-size: 0.7rem;
                    font-family: 'Inter', monospace;
                }
                .logs-container {
                    max-height: 400px;
                    overflow-y: auto;
                    background: rgba(0,0,0,0.8);
                    padding: 10px;
                    border-radius: 8px;
                    margin: 12px 0;
                    text-align: left;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 0.6rem;
                }
                .log-entry {
                    margin: 5px 0;
                    padding: 5px;
                    border-radius: 4px;
                    border-left: 2px solid #00ff88;
                }
                .log-success {
                    border-left-color: #00ff88;
                    background: rgba(0,255,136,0.1);
                }
                .log-error {
                    border-left-color: #ff0055;
                    background: rgba(255,0,85,0.1);
                }
                .log-info {
                    border-left-color: #00f3ff;
                    background: rgba(0,243,255,0.1);
                }
                .auto-refresh {
                    margin: 10px 0;
                    font-size: 0.65rem;
                }
            </style>
            <script>
                function refreshPage() {
                    location.reload();
                }
                
                ${taskInfo.isSending ? 'setTimeout(refreshPage, 10000);' : ''}
                
                window.onload = function() {
                    const logsContainer = document.querySelector('.logs-container');
                    if (logsContainer) {
                        logsContainer.scrollTop = 0;
                    }
                };
            </script>
        </head>
        <body>
            <div class="container">
                <h1>Task Logs</h1>
                
                <div class="status-box">
                    <div class="task-id">Task ID: ${taskId}</div>
                    
                    <div class="status-item">
                        Status: <span class="status-value">${taskInfo.isSending ? 'RUNNING' : taskInfo.stopRequested ? 'STOPPED' : 'COMPLETED'}</span>
                    </div>
                    
                    <div class="status-item">
                        Target: <span class="status-value">${taskInfo.target} (${taskInfo.targetType})</span>
                    </div>
                    
                    <div class="status-item">
                        Sent: <span class="status-value">${taskInfo.sentMessages} of ${taskInfo.totalMessages}</span>
                    </div>
                    
                    <div class="status-item">
                        Start: <span class="statusValue">${taskInfo.startTime.toLocaleString()}</span>
                    </div>
                    
                    ${taskInfo.endTime ? '<div class="status-item">End: <span class="status-value">' + taskInfo.endTime.toLocaleString() + '</span></div>' : ''}
                    
                    ${taskInfo.error ? '<div class="status-item" style="color:#ff0055;">Error: ' + taskInfo.error + '</div>' : ''}
                    
                    <div class="auto-refresh">
                        ${taskInfo.isSending ? 'Auto-refresh every 10 sec' : ''}
                    </div>
                </div>
                
                <div class="status-box">
                    <h2 style="font-size: 0.9rem;">Live Logs (Newest First)</h2>
                    <div class="logs-container">
                        ${logsHtml}
                    </div>
                </div>
                
                <a href="/session-status?sessionId=${sessionId}">Return to Session Status</a>
            </div>
        </body>
        </html>
    `);
});

app.post("/view-session", (req, res) => {
    const { sessionId } = req.body;
    res.redirect(`/session-status?sessionId=${sessionId}`);
});

app.post("/stop-session", async (req, res) => {
    const { sessionId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: Invalid Session ID</h2>
                        </div>`);
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
            <div style="padding: 12px; background: rgba(0,40,0,0.8); border-radius: 8px; border: 1px solid #00ff88;">
                <h2 style="color: #00ff88; font-size: 0.9rem;">Session ${sessionId} stopped successfully</h2>
                <p style="font-size: 0.7rem;">All tasks in this session have been stopped.</p>
            </div>  
        `);

    } catch (error) {
        console.error(`Error stopping session ${sessionId}:`, error);
        res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                    <h2 style="font-size: 0.9rem;">Error stopping session</h2>
                    <p style="font-size: 0.7rem;">${error.message}</p>
                  </div>`);
    }
});

app.post("/stop-task", async (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!activeClients.has(sessionId)) {
        return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                          <h2 style="font-size: 0.9rem;">Error: Invalid Session ID</h2>
                        </div>`);
    }

    try {
        const clientInfo = activeClients.get(sessionId);
        const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
        
        if (!taskInfo) {
            return res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                              <h2 style="font-size: 0.9rem;">Error: Task not found</h2>
                            </div>`);
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

        res.send(`<script>window.location.href = '/session-status?sessionId=${sessionId}';</script>`);

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(`<div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px;">
                    <h2 style="font-size: 0.9rem;">Error stopping task</h2>
                    <p style="font-size: 0.7rem;">${error.message}</p>
                  </div>`);
    }
});

app.get("/get-groups", async (req, res) => {
    const userIP = req.userIP;
    
    const sessionId = userSessions.get(userIP);
    if (!sessionId || !activeClients.has(sessionId)) {
        return res.send(`
            <div style="padding: 12px; background: rgba(80,0,0,0.8); border-radius: 8px; border: 1px solid #ff0055; text-align: center;">
                <h3 style="color: #ff0055; margin-bottom: 8px; font-size: 0.85rem;">
                    <i class="fas fa-exclamation-triangle"></i> No Active Session
                </h3>
                <p style="font-size: 0.7rem;">Please generate a pairing code first to connect your WhatsApp account.</p>
            </div>
        `);
    }

    try {
        const { client: waClient, number: senderNumber } = activeClients.get(sessionId);
        const groups = await waClient.groupFetchAllParticipating();
        
        let groupsList = `
            <div style="margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.5); border-radius: 8px;">
                <h3 style="color: #00f3ff; margin: 0; display: flex; align-items: center; gap: 6px; font-family: 'Inter', monospace; font-size: 0.8rem;">
                    <i class="fas fa-user"></i> Connected as: ${senderNumber}
                </h3>
            </div>
        `;
        
        if (Object.keys(groups).length === 0) {
            groupsList += `
                <div style="text-align: center; padding: 30px 15px; color: #ffaa00;">
                    <i class="fas fa-users-slash" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <h3 style="font-size: 0.85rem;">No Groups Found</h3>
                    <p style="font-size: 0.7rem;">You are not a member of any WhatsApp groups.</p>
                </div>
            `;
        } else {
            groupsList += `<div class="group-list">`;
            
            Object.keys(groups).forEach((groupId, index) => {
                const group = groups[groupId];
                const cleanGroupId = groupId.replace('@g.us', '');
                const participantsCount = group.participants ? group.participants.length : 0;
                const creationDate = group.creation ? new Date(group.creation * 1000).toLocaleDateString() : 'Unknown';
                
                groupsList += `
                    <div class="group-item" style="
                        background: rgba(0,0,0,0.6);
                        padding: 10px;
                        border-radius: 8px;
                        margin-bottom: 10px;
                        border-left: 3px solid #00ff88;
                        transition: all 0.2s ease;
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                            <div style="flex: 1;">
                                <h4 style="color: #00f3ff; margin: 0 0 6px 0; font-size: 0.75rem;">
                                    ${index + 1}. ${group.subject || 'Unknown Group'}
                                </h4>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.65rem;">
                                    <div>
                                        <strong>Group UID:</strong> 
                                        <code style="background: rgba(0,0,0,0.5); padding: 2px 5px; border-radius: 3px; margin-left: 4px; color: #00ff88; font-size: 0.6rem;">
                                            ${cleanGroupId}
                                        </code>
                                    </div>
                                    <div><strong>Participants:</strong> ${participantsCount}</div>
                                    <div><strong>Created:</strong> ${creationDate}</div>
                                    <div><strong>Status:</strong> <span style="color: #00ff88;">Active</span></div>
                                </div>
                            </div>
                        </div>
                        <button onclick="copyGroupUID('${cleanGroupId}')" style="
                            background: linear-gradient(135deg, #00f3ff, #00ff88);
                            color: black;
                            border: none;
                            padding: 4px 10px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 0.65rem;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            font-family: 'Inter', sans-serif;
                        ">
                            <i class="fas fa-copy"></i> Copy UID
                        </button>
                    </div>
                `;
            });
            
            groupsList += `</div>`;
            
            groupsList += `
                <div style="margin-top: 12px; padding: 8px; background: rgba(0,255,136,0.1); border-radius: 6px; text-align: center;">
                    <p style="margin: 0; color: #00ff88; font-weight: 600; font-family: 'Inter', monospace; font-size: 0.65rem;">
                        <i class="fas fa-check-circle"></i> 
                        Total ${Object.keys(groups).length} groups loaded
                    </p>
                </div>
            `;
        }
        
        res.send(groupsList);

    } catch (error) {
        console.error("Error fetching groups:", error);
        res.send(`
            <div style="padding: 20px; text-align: center; background: rgba(80,0,0,0.8); border-radius: 8px; border: 1px solid #ff0055;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ff0055; margin-bottom: 10px;"></i>
                <h3 style="color: #ff0055; margin-bottom: 8px; font-size: 0.85rem;">Error Loading Groups</h3>
                <p style="font-size: 0.7rem;">${error.message}</p>
            </div>
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
});
