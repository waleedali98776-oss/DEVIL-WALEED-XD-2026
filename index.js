const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const chalk = require("chalk");
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
const PORT = 30118;

// Server start time for uptime calculation
const SERVER_START_TIME = Date.now();

// Enhanced memory management
const MAX_MEMORY_MB = 512;
const MEMORY_CHECK_INTERVAL = 30000;

// Admin credentials (CHANGE THIS)
const ADMIN_CREDENTIALS = {
    username: "Surya",
    password: "Surya786"
};

// Cyan separator for console logs
const CYAN_SEPARATOR = chalk.cyan('═'.repeat(70));

// Helper function for colorful console logging
function logInfo(message) {
    console.log(CYAN_SEPARATOR);
    console.log(chalk.cyan('ℹ'), chalk.white(message));
    console.log(CYAN_SEPARATOR);
}

function logSuccess(message) {
    console.log(CYAN_SEPARATOR);
    console.log(chalk.green('✓'), chalk.greenBright(message));
    console.log(CYAN_SEPARATOR);
}

function logError(message) {
    console.log(CYAN_SEPARATOR);
    console.log(chalk.red('✖'), chalk.redBright(message));
    console.log(CYAN_SEPARATOR);
}

function logWarning(message) {
    console.log(CYAN_SEPARATOR);
    console.log(chalk.yellow('⚠'), chalk.yellowBright(message));
    console.log(CYAN_SEPARATOR);
}

// Create necessary directories with enhanced error handling
if (!fs.existsSync("temp")) {
    fs.mkdirSync("temp", { recursive: true });
}
if (!fs.existsSync("tasks")) {
    fs.mkdirSync("tasks", { recursive: true });
}
if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs", { recursive: true });
}
if (!fs.existsSync("sessions_backup")) {
    fs.mkdirSync("sessions_backup", { recursive: true });
}
if (!fs.existsSync("data")) {
    fs.mkdirSync("data", { recursive: true });
}

// Initialize users.json if not exists
const USERS_FILE = path.join("data", "users.json");
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

const upload = multer({
    dest: "tasks/temp_uploads/",
    limits: {
        fileSize: 10 * 1024 * 1024,
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Serve static HTML file
app.use(express.static('public'));

// Enhanced memory management
const activeClients = new Map();
const activeTasks = new Map();
const taskLogs = new Map();
const userSessions = new Map();
const sessionRestartAttempts = new Map();
const taskRunningLocks = new Map();

// 🔥 Track manually disconnected sessions to prevent auto-reconnect
const manuallyDisconnectedSessions = new Set();

// 🔥 NEW: Track pair code sessions that never connected, for timeout purposes
const pairCodeSessions = new Map();

// Helper function to format date as "15 January 2025"
function formatDate(dateInput) {
    const date = new Date(dateInput);
    const day = date.getDate();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

// Helper function to format uptime
function formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Helper functions for user management
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logError('Error loading users: ' + error.message);
        return [];
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        logError('Error saving users: ' + error.message);
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Authentication middleware
function requireAuth(req, res, next) {
    const token = req.cookies.sessionToken;
    if (!token) {
        return res.redirect('/login');
    }

    const users = loadUsers();
    const user = users.find(u => u.sessionToken === token);

    if (!user) {
        res.clearCookie('sessionToken');
        return res.redirect('/login');
    }

    req.user = user;
    next();
}

function requireAdmin(req, res, next) {
    const adminToken = req.cookies.adminToken;
    if (!adminToken || adminToken !== 'admin_authenticated') {
        return res.redirect('/admin-login');
    }
    req.isAdmin = true;
    next();
}

// Load persistent data if exists
function loadPersistentData() {
    try {
        if (fs.existsSync('sessions_backup/activeClients.json')) {
            const data = JSON.parse(fs.readFileSync('sessions_backup/activeClients.json', 'utf8'));
            data.forEach(([key, value]) => {
                activeClients.set(key, {
                    ...value,
                    client: null,
                    isConnected: false
                });
            });
            logSuccess(`Loaded ${activeClients.size} persistent sessions`);
        }

        if (fs.existsSync('sessions_backup/userSessions.json')) {
            const data = JSON.parse(fs.readFileSync('sessions_backup/userSessions.json', 'utf8'));
            data.forEach(([key, value]) => {
                userSessions.set(key, value);
            });
        }
    } catch (error) {
        logError('Error loading persistent data: ' + error.message);
    }
}

// Save persistent data
function savePersistentData() {
    try {
        const clientsData = Array.from(activeClients.entries())
            .filter(([sessionId]) => !manuallyDisconnectedSessions.has(sessionId))
            .map(([key, value]) => {
                return [key, {
                    number: value.number,
                    authPath: value.authPath,
                    isConnected: value.isConnected,
                    tasks: value.tasks || [],
                    lastActivity: value.lastActivity,
                    userId: value.userId,
                    username: value.username,
                    createdAt: value.createdAt
                }];
            });
        fs.writeFileSync('sessions_backup/activeClients.json', JSON.stringify(clientsData));

        const sessionsData = Array.from(userSessions.entries())
            .filter(([sessionId]) => !manuallyDisconnectedSessions.has(sessionId));
        fs.writeFileSync('sessions_backup/userSessions.json', JSON.stringify(sessionsData));

        logInfo(`Persistent data saved: ${clientsData.length} clients`);
    } catch (error) {
        logError('Error saving persistent data: ' + error.message);
    }
}

// Load data on startup
loadPersistentData();

// Generate 15-digit unique session ID
function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 17);
}

// Generate short task ID
function generateShortTaskId() {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

// Enhanced memory management
function optimizeMemory() {
    if (process.memoryUsage().heapUsed > MAX_MEMORY_MB * 1024 * 1024 * 0.8) {
        logWarning('Memory usage high, running garbage collection...');
        if (global.gc) {
            global.gc();
        }

        for (let [taskId, logs] of taskLogs.entries()) {
            if (logs.length > 50) {
                logs.splice(50);
            }
        }
    }
}

// Keys cleanup system
function cleanupSessionKeys() {
    logInfo('🔑 Starting PARALLEL keys cleanup for all sessions...');

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) return;

    const KEY_PREFIXES = [
        'pre-key-',
        'session-',
        'sender-key-',
        'device-list-',
        'tctoken-',
        'lid-mapping-'
    ];

    const sessionFolders = fs.readdirSync(tempDir)
        .filter(f => fs.statSync(path.join(tempDir, f)).isDirectory());

    Promise.all(
        sessionFolders.map(async (sessionFolder) => {
            const sessionPath = path.join(tempDir, sessionFolder);

            try {
                const files = fs.readdirSync(sessionPath);
                const fileGroups = {};

                for (const file of files) {
                    if (file === 'creds.json') continue;

                    for (const prefix of KEY_PREFIXES) {
                        if (file.startsWith(prefix)) {
                            if (!fileGroups[prefix]) fileGroups[prefix] = [];
                            fileGroups[prefix].push(file);
                            break;
                        }
                    }
                }

                await Promise.all(
                    Object.entries(fileGroups).map(async ([prefix, groupFiles]) => {
                        if (groupFiles.length <= 5) return;

                        const sorted = groupFiles
                            .map(name => ({
                                name,
                                path: path.join(sessionPath, name),
                                mtime: fs.statSync(path.join(sessionPath, name)).mtime.getTime()
                            }))
                            .sort((a, b) => b.mtime - a.mtime);

                        const toDelete = sorted.slice(5);

                        for (const file of toDelete) {
                            try {
                                fs.unlinkSync(file.path);
                                logInfo(`🗑️ ${sessionFolder}/${file.name}`);
                            } catch (e) {
                                logError(`Failed to delete ${file.name}: ${e.message}`);
                            }
                        }

                        if (toDelete.length > 0) {
                            logSuccess(`✅ ${sessionFolder}: cleaned ${toDelete.length} ${prefix} files`);
                        }
                    })
                );

            } catch (err) {
                logError(`Cleanup error in ${sessionFolder}: ${err.message}`);
            }
        })
    ).then(() => {
        logSuccess('✅ PARALLEL keys cleanup completed');
    });
}

setInterval(() => {
    cleanupSessionKeys();
}, 3 * 60 * 1000);

setTimeout(() => {
    cleanupSessionKeys();
}, 30000);

// Task folder management
function createTaskFolder(taskId, taskInfo) {
    const taskFolder = path.join(__dirname, 'tasks', taskId);
    
    try {
        if (!fs.existsSync(taskFolder)) {
            fs.mkdirSync(taskFolder, { recursive: true });
        }
        
        // Save task metadata
        const metadataPath = path.join(taskFolder, 'metadata.json');
        const metadata = {
            taskId: taskInfo.taskId,
            sessionId: taskInfo.sessionId,
            target: taskInfo.target,
            targetType: taskInfo.targetType,
            prefix: taskInfo.prefix,
            delaySec: taskInfo.delaySec,
            taskType: taskInfo.taskType || 'message',
            totalMessages: taskInfo.totalMessages || 0,
            createdAt: taskInfo.createdAt,
            startTime: taskInfo.startTime,
            status: 'running',
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        
        // Save messages if available
        if (taskInfo.messages && taskInfo.messages.length > 0) {
            const messagesPath = path.join(taskFolder, 'messages.txt');
            fs.writeFileSync(messagesPath, taskInfo.messages.join('\n'));
        }
        
        // Save image path if available
        if (taskInfo.imagePath) {
            const imageMetaPath = path.join(taskFolder, 'image_info.json');
            fs.writeFileSync(imageMetaPath, JSON.stringify({ imagePath: taskInfo.imagePath }, null, 2));
        }
        
        logSuccess(`✅ Task folder created: ${taskId}`);
        return taskFolder;
    } catch (error) {
        logError(`Failed to create task folder ${taskId}: ${error.message}`);
        return null;
    }
}

function updateTaskMetadata(taskId, updates) {
    const metadataPath = path.join(__dirname, 'tasks', taskId, 'metadata.json');
    
    try {
        if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const updated = { ...metadata, ...updates, lastUpdated: new Date().toISOString() };
            fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2));
        }
    } catch (error) {
        logError(`Failed to update task metadata ${taskId}: ${error.message}`);
    }
}

function deleteTaskFolder(taskId) {
    const taskFolder = path.join(__dirname, 'tasks', taskId);
    
    try {
        if (fs.existsSync(taskFolder)) {
            fs.rmSync(taskFolder, { recursive: true, force: true });
            logSuccess(`✅ Task folder deleted: ${taskId}`);
        }
    } catch (error) {
        logError(`Failed to delete task folder ${taskId}: ${error.message}`);
    }
}

// Complete permanent session cleanup
function completeSessionCleanup(sessionId) {
    logInfo(`🗑️ Starting COMPLETE PERMANENT cleanup for session: ${sessionId}`);

    manuallyDisconnectedSessions.add(sessionId);
    logSuccess(`✅ Session marked as manually disconnected: ${sessionId}`);

    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) {
        logWarning(`Session ${sessionId} not found in activeClients during cleanup`);
        return;
    }

    if (clientInfo.tasks) {
        clientInfo.tasks.forEach(task => {
            task.stopRequested = true;
            task.isSending = false;
            task.endTime = new Date();

            if (taskRunningLocks.has(task.taskId)) {
                taskRunningLocks.delete(task.taskId);
                logInfo(`🔓 Released lock for task: ${task.taskId}`);
            }

            if (taskLogs.has(task.taskId)) {
                taskLogs.delete(task.taskId);
                logSuccess(`🧹 PERMANENTLY cleared logs for task: ${task.taskId}`);
            }
            
            deleteTaskFolder(task.taskId);
        });
    }

    if (clientInfo.client) {
        try {
            clientInfo.client.end();
            logInfo(`🔴 WhatsApp client connection closed for session: ${sessionId}`);
        } catch (error) {
            logError(`Error closing client for ${sessionId}: ${error.message}`);
        }
    }

    if (sessionRestartAttempts.has(sessionId)) {
        sessionRestartAttempts.delete(sessionId);
        logInfo(`🔄 Cleared restart attempts for session: ${sessionId}`);
    }
    
    if (pairCodeSessions.has(sessionId)) {
        pairCodeSessions.delete(sessionId);
        logInfo(`🔑 Removed from pair code tracking: ${sessionId}`);
    }

    if (clientInfo.authPath && fs.existsSync(clientInfo.authPath)) {
        try {
            fs.rmSync(clientInfo.authPath, { recursive: true, force: true });
            logSuccess(`💥 PERMANENTLY DELETED auth folder from disk: ${clientInfo.authPath}`);
        } catch (error) {
            logError(`Error deleting auth folder for ${sessionId}: ${error.message}`);
        }
    }

    activeClients.delete(sessionId);
    logSuccess(`🧹 Removed session ${sessionId} from activeClients memory`);

    if (userSessions.has(sessionId)) {
        userSessions.delete(sessionId);
        logSuccess(`🧹 Removed session ${sessionId} from userSessions memory`);
    }

    savePersistentData();
    logSuccess(`💾 Persistent data saved - session removed from backup files`);

    logSuccess(`✅ ✅ ✅ COMPLETE PERMANENT cleanup finished for session: ${sessionId}`);
}

// Complete permanent task cleanup
function completeTaskCleanup(sessionId, taskId) {
    logInfo(`🗑️ Starting COMPLETE PERMANENT cleanup for task: ${taskId}`);

    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) {
        logWarning(`Session ${sessionId} not found for task cleanup`);
        return;
    }

    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo) {
        logWarning(`Task ${taskId} not found in session ${sessionId}`);
        return;
    }

    taskInfo.stopRequested = true;
    taskInfo.isSending = false;
    taskInfo.endTime = new Date();

    if (taskRunningLocks.has(taskId)) {
        taskRunningLocks.delete(taskId);
        logInfo(`🔓 Released lock for task: ${taskId}`);
    }

    if (taskLogs.has(taskId)) {
        taskLogs.delete(taskId);
        logSuccess(`💥 PERMANENTLY cleared all logs for task: ${taskId}`);
    }
    
    deleteTaskFolder(taskId);

    clientInfo.tasks = clientInfo.tasks.filter(t => t.taskId !== taskId);
    logSuccess(`🧹 Removed task ${taskId} from session ${sessionId} tasks array`);

    savePersistentData();
    logSuccess(`💾 Persistent data saved - task removed from backup files`);

    logSuccess(`✅ ✅ ✅ COMPLETE PERMANENT cleanup finished for task: ${taskId}`);
}

// Check and remove timeout pair code sessions
function checkPairCodeTimeouts() {
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    
    pairCodeSessions.forEach((info, sessionId) => {
        if (!info.hasConnected && (now - info.createdAt) > TIMEOUT_MS) {
            logWarning(`⏰ Pair code session ${sessionId} timeout - never connected in 10 minutes`);
            completeSessionCleanup(sessionId);
        }
    });
}

setInterval(() => {
    checkPairCodeTimeouts();
}, 2 * 60 * 1000);

// Session recovery with infinite reconnect
async function recoverSession(sessionId, clientInfo) {
    if (manuallyDisconnectedSessions.has(sessionId)) {
        logWarning(`❌ Session ${sessionId} was manually disconnected. Skipping auto-reconnect.`);
        return null;
    }

    try {
        const attempts = sessionRestartAttempts.get(sessionId) || 0;
        logInfo(`Attempting to recover session ${sessionId} (attempt ${attempts + 1})`);
        sessionRestartAttempts.set(sessionId, attempts + 1);

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
                logWarning(`❌ Session ${sessionId} is manually disconnected. Ignoring connection updates.`);
                if (waClient) {
                    try {
                        waClient.end();
                    } catch (e) { /* Ignore */ }
                }
                return;
            }

            if (connection === "open") {
                logSuccess(`Session ${sessionId} reconnected successfully!`);
                clientInfo.isConnected = true;
                clientInfo.lastActivity = Date.now();
                sessionRestartAttempts.set(sessionId, 0);
                
                if (pairCodeSessions.has(sessionId)) {
                    pairCodeSessions.get(sessionId).hasConnected = true;
                    logSuccess(`✅ Pair code session ${sessionId} successfully connected`);
                }

                if (clientInfo.tasks && clientInfo.tasks.length > 0) {
                    logInfo(`Resuming ${clientInfo.tasks.length} tasks for session ${sessionId}`);
                    clientInfo.tasks.forEach(task => {
                        if (task.isSending && !task.stopRequested) {
                            resumeTask(sessionId, task.taskId);
                        }
                    });
                }
            }
            else if (connection === "close") {
                clientInfo.isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                logWarning(`Session ${sessionId} disconnected. Status: ${statusCode}`);

                if (manuallyDisconnectedSessions.has(sessionId)) {
                    logWarning(`❌ Session ${sessionId} was manually disconnected. Not reconnecting.`);
                    return;
                }

                if (statusCode === 401) {
                    logError(`Session ${sessionId} logged out from WhatsApp. Removing session.`);
                    completeSessionCleanup(sessionId);
                    return;
                }

                const delayTime = Math.min(1000 * Math.pow(2, Math.min(attempts, 10)), 30000);
                logInfo(`Reconnecting session ${sessionId} in ${delayTime}ms...`);

                setTimeout(() => {
                    if (!manuallyDisconnectedSessions.has(sessionId)) {
                        recoverSession(sessionId, clientInfo);
                    }
                }, delayTime);
            }
            else if (connection === "connecting") {
                logInfo(`Session ${sessionId} is reconnecting...`);
            }
        });

        return waClient;
    } catch (error) {
        logError(`Failed to recover session ${sessionId}: ${error.message}`);

        if (manuallyDisconnectedSessions.has(sessionId)) {
            logWarning(`❌ Session ${sessionId} was manually disconnected. Not retrying recovery.`);
            return null;
        }

        const attempts = sessionRestartAttempts.get(sessionId) || 0;
        const delayTime = Math.min(5000 * Math.pow(2, Math.min(attempts, 10)), 60000);
        setTimeout(() => {
            if (!manuallyDisconnectedSessions.has(sessionId)) {
                recoverSession(sessionId, clientInfo);
            }
        }, delayTime);

        return null;
    }
}

// Enhanced task resumption system
async function resumeTask(sessionId, taskId) {
    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) return;

    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo || !taskInfo.isSending || taskInfo.stopRequested) return;

    if (taskRunningLocks.get(taskId)) {
        logWarning(`Task ${taskId} is already running, skipping duplicate resume`);
        return;
    }

    logInfo(`Resuming task ${taskId} for session ${sessionId}`);

    const logs = taskLogs.get(taskId) || [];
    logs.unshift({
        type: "info",
        message: `<i class="fas fa-sync-alt"></i> [${new Date().toLocaleString()}] Task resumed automatically`,
        details: `Connection restored, continuing from message ${taskInfo.sentMessages + 1}`,
        timestamp: new Date()
    });
    taskLogs.set(taskId, logs);

    while (!clientInfo.isConnected && taskInfo.isSending && !taskInfo.stopRequested) {
        await delay(5000);
        logInfo(`Waiting for connection to resume task ${taskId}...`);
    }

    if (clientInfo.isConnected && taskInfo.isSending && !taskInfo.stopRequested && !taskRunningLocks.get(taskId)) {
        if (taskInfo.taskType === 'image') {
            sendImagesLoop(sessionId, taskId);
        } else {
            sendMessagesLoop(sessionId, taskId);
        }
    }
}

// Periodic maintenance tasks
setInterval(() => {
    const now = Date.now();

    for (let [sessionId, clientInfo] of activeClients.entries()) {
        if (manuallyDisconnectedSessions.has(sessionId)) {
            continue;
        }

        if (clientInfo.lastActivity && (now - clientInfo.lastActivity > 48 * 60 * 60 * 1000)) {
            logInfo(`Cleaning up inactive session: ${sessionId}`);
            completeSessionCleanup(sessionId);
        }
    }

    for (let [sessionId, clientInfo] of activeClients.entries()) {
        if (manuallyDisconnectedSessions.has(sessionId)) {
            continue;
        }

        if (!clientInfo.isConnected && clientInfo.client) {
            const hasActiveTasks = clientInfo.tasks && clientInfo.tasks.some(t => t.isSending);
            if (hasActiveTasks) {
                logInfo(`Auto-recovering disconnected session with active tasks: ${sessionId}`);
                recoverSession(sessionId, clientInfo);
            }
        }
    }

    savePersistentData();
    optimizeMemory();
}, 5 * 60 * 1000);

setInterval(() => {
    savePersistentData();
}, 2 * 60 * 1000);

// Keep-alive endpoint
app.get("/health", (req, res) => {
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - SERVER_START_TIME;
    const stats = {
        status: "<i class='fas fa-check-circle'></i> RUNNING",
        uptime: formatUptime(uptime),
        memory: {
            used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + "MB",
            total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + "MB"
        },
        sessions: activeClients.size,
        tasks: Array.from(activeClients.values()).reduce((sum, client) => sum + (client.tasks ? client.tasks.length : 0), 0),
        activeTasks: Array.from(activeClients.values()).reduce((sum, client) =>
            sum + (client.tasks ? client.tasks.filter(t => t.isSending).length : 0), 0),
        timestamp: new Date().toISOString()
    };

    res.json(stats);
});

// API endpoint for AJAX polling of live session status
app.get("/api/live-status", requireAuth, (req, res) => {
    const { sessionId } = req.query;
    const user = req.user;

    if (!sessionId || !activeClients.has(sessionId)) {
        return res.json({ error: "Invalid session" });
    }

    const clientInfo = activeClients.get(sessionId);

    if (clientInfo.userId !== user.userId) {
        return res.json({ error: "Access denied" });
    }

    // 🔥 NEW: Calculate running tasks count
    const runningTasksCount = clientInfo.tasks ? clientInfo.tasks.filter(t => t.isSending).length : 0;

    const tasksStatus = clientInfo.tasks ? clientInfo.tasks.map(task => ({
        taskId: task.taskId,
        target: task.target,
        targetType: task.targetType,
        taskType: task.taskType || 'message',
        isSending: task.isSending,
        sentMessages: task.sentMessages,
        totalMessages: task.totalMessages,
        currentIndex: task.currentMessageIndex || 0,
        createdAt: task.createdAt,
        createdAtFormatted: task.createdAt ? formatDate(task.createdAt) : null
    })) : [];

    res.json({
        isConnected: clientInfo.isConnected,
        number: clientInfo.number,
        tasks: tasksStatus,
        runningTasksCount: runningTasksCount,
        lastActivity: clientInfo.lastActivity,
        createdAt: clientInfo.createdAt,
        createdAtFormatted: clientInfo.createdAt ? formatDate(clientInfo.createdAt) : null
    });
});

// API endpoint for live task logs
app.get("/api/live-logs", requireAuth, (req, res) => {
    const { sessionId, taskId } = req.query;
    const user = req.user;

    if (!sessionId || !activeClients.has(sessionId) || !taskLogs.has(taskId)) {
        return res.json({ error: "Invalid session or task" });
    }

    const clientInfo = activeClients.get(sessionId);

    if (clientInfo.userId !== user.userId) {
        return res.json({ error: "Access denied" });
    }

    const logs = taskLogs.get(taskId) || [];
    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);

    res.json({
        logs: logs.slice(0, 50),
        taskInfo: taskInfo ? {
            isSending: taskInfo.isSending,
            sentMessages: taskInfo.sentMessages,
            totalMessages: taskInfo.totalMessages,
            taskType: taskInfo.taskType || 'message',
            createdAt: taskInfo.createdAt,
            createdAtFormatted: taskInfo.createdAt ? formatDate(taskInfo.createdAt) : null
        } : null
    });
});

// API: Get user's phone numbers and their associated sessions
app.get("/api/get-numbers", requireAuth, (req, res) => {
    const user = req.user;

    const numbers = new Map();

    activeClients.forEach((clientInfo, sessionId) => {
        if (clientInfo.userId === user.userId) {
            if (!numbers.has(clientInfo.number)) {
                numbers.set(clientInfo.number, []);
            }
            
            // 🔥 NEW: Calculate running tasks for this session
            const runningTasksCount = clientInfo.tasks ? clientInfo.tasks.filter(t => t.isSending).length : 0;
            
            numbers.get(clientInfo.number).push({
                sessionId: sessionId,
                isConnected: clientInfo.isConnected,
                runningTasksCount: runningTasksCount,
                createdAt: clientInfo.createdAt,
                createdAtFormatted: clientInfo.createdAt ? formatDate(clientInfo.createdAt) : null
            });
        }
    });

    const result = Array.from(numbers.entries()).map(([number, sessions]) => ({
        number: number,
        sessions: sessions
    }));

    res.json(result);
});

// Admin API: Get all active WhatsApp sessions
app.get("/api/admin/all-sessions", requireAdmin, (req, res) => {
    const allSessions = [];

    activeClients.forEach((clientInfo, sessionId) => {
        allSessions.push({
            sessionId: sessionId,
            number: clientInfo.number,
            isConnected: clientInfo.isConnected,
            userId: clientInfo.userId,
            username: clientInfo.username,
            tasksCount: clientInfo.tasks ? clientInfo.tasks.length : 0,
            activeTasksCount: clientInfo.tasks ? clientInfo.tasks.filter(t => t.isSending).length : 0,
            lastActivity: clientInfo.lastActivity,
            createdAt: clientInfo.createdAt,
            createdAtFormatted: clientInfo.createdAt ? formatDate(clientInfo.createdAt) : null,
            sessionOwner: clientInfo.username
        });
    });

    res.json(allSessions);
});

// Admin API: Get detailed information about a specific session
app.get("/api/admin/session-details", requireAdmin, (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId || !activeClients.has(sessionId)) {
        return res.json({ error: "Invalid session" });
    }

    const clientInfo = activeClients.get(sessionId);
    const tasksStatus = clientInfo.tasks ? clientInfo.tasks.map(task => ({
        taskId: task.taskId,
        target: task.target,
        targetType: task.targetType,
        taskType: task.taskType || 'message',
        isSending: task.isSending,
        sentMessages: task.sentMessages,
        totalMessages: task.totalMessages,
        currentIndex: task.currentMessageIndex || 0,
        startTime: task.startTime,
        endTime: task.endTime,
        createdAt: task.createdAt,
        createdAtFormatted: task.createdAt ? formatDate(task.createdAt) : null,
        taskOwner: clientInfo.username
    })) : [];

    res.json({
        sessionId: sessionId,
        isConnected: clientInfo.isConnected,
        number: clientInfo.number,
        userId: clientInfo.userId,
        username: clientInfo.username,
        tasks: tasksStatus,
        lastActivity: clientInfo.lastActivity,
        createdAt: clientInfo.createdAt,
        createdAtFormatted: clientInfo.createdAt ? formatDate(clientInfo.createdAt) : null,
        sessionOwner: clientInfo.username
    });
});

// Admin API: Get logs for a specific task
app.get("/api/admin/task-logs", requireAdmin, (req, res) => {
    const { taskId } = req.query;

    if (!taskId || !taskLogs.has(taskId)) {
        return res.json({ error: "Invalid task" });
    }

    const logs = taskLogs.get(taskId) || [];

    res.json({
        logs: logs.slice(0, 100)
    });
});

// Admin API: Delete a session permanently
app.post("/api/admin/delete-session", requireAdmin, (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId || !activeClients.has(sessionId)) {
        return res.json({ success: false, error: "Invalid session" });
    }

    completeSessionCleanup(sessionId);

    res.json({ success: true, message: "✅ Session PERMANENTLY deleted" });
});

// Admin API: Delete a task permanently
app.post("/api/admin/delete-task", requireAdmin, (req, res) => {
    const { sessionId, taskId } = req.body;

    if (!sessionId || !activeClients.has(sessionId)) {
        return res.json({ success: false, error: "Invalid session" });
    }

    completeTaskCleanup(sessionId, taskId);

    res.json({ success: true, message: "✅ Task PERMANENTLY deleted" });
});

// Serve HTML routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/admin-login", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/dashboard", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/admin-dashboard", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/session-status", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/task-logs", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle user login
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();

    const user = users.find(u => u.username === username && u.password === hashPassword(password));

    if (!user) {
        return res.json({ success: false, error: "Invalid username or password" });
    }

    const sessionToken = generateSessionToken();
    user.sessionToken = sessionToken;
    user.lastLogin = new Date().toISOString();
    saveUsers(users);

    res.cookie('sessionToken', sessionToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, redirect: '/dashboard' });
});

// Handle user signup
app.post("/signup", (req, res) => {
    const { username, email, password } = req.body;
    const users = loadUsers();

    if (users.find(u => u.username === username)) {
        return res.json({ success: false, error: "Username already exists" });
    }

    const newUser = {
        userId: generateUserId(),
        username,
        email,
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
        sessionToken: generateSessionToken()
    };

    users.push(newUser);
    saveUsers(users);

    res.cookie('sessionToken', newUser.sessionToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, redirect: '/dashboard' });
});

// Handle admin login
app.post("/admin-login", (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        res.cookie('adminToken', 'admin_authenticated', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, redirect: '/admin-dashboard' });
    } else {
        res.json({ success: false, error: "Invalid admin credentials" });
    }
});

// Handle logout
app.get("/logout", (req, res) => {
    res.clearCookie('sessionToken');
    res.clearCookie('adminToken');
    res.redirect('/login');
});

// Generate pairing code
app.post("/generate-pairing-code", requireAuth, async (req, res) => {
    const { number: num } = req.body;
    const user = req.user;

    if (!num) {
        return res.json({ success: false, error: "Phone number is required" });
    }

    try {
        const sessionId = generateSessionId();
        const sessionPath = path.join("temp", sessionId);

        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

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
                userId: user.userId,
                username: user.username,
                createdAt: new Date().toISOString()
            });
            
            pairCodeSessions.set(sessionId, {
                createdAt: Date.now(),
                hasConnected: false
            });
            logInfo(`🔑 Pair code session tracked: ${sessionId} - will timeout in 10 minutes if not connected`);

            res.json({
                success: true,
                code: code,
                sessionId: sessionId,
                number: num
            });
        }

        waClient.ev.on("creds.update", saveCreds);
        waClient.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect } = s;

            if (manuallyDisconnectedSessions.has(sessionId)) {
                logWarning(`❌ Session ${sessionId} is manually disconnected. Ignoring connection updates.`);
                return;
            }

            if (connection === "open") {
                logSuccess(`WhatsApp Connected for ${num}! Session ID: ${sessionId}`);
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = true;
                    clientInfo.lastActivity = Date.now();
                    sessionRestartAttempts.set(sessionId, 0);
                    
                    if (pairCodeSessions.has(sessionId)) {
                        pairCodeSessions.get(sessionId).hasConnected = true;
                        logSuccess(`✅ Pair code session ${sessionId} successfully connected`);
                    }
                }
            } else if (connection === "close") {
                const clientInfo = activeClients.get(sessionId);
                if (clientInfo) {
                    clientInfo.isConnected = false;
                    logWarning(`Connection closed for Session ID: ${sessionId}`);

                    if (manuallyDisconnectedSessions.has(sessionId)) {
                        logWarning(`❌ Session ${sessionId} was manually disconnected. Not reconnecting.`);
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    if (statusCode === 401) {
                        logError(`Session ${sessionId} logged out from WhatsApp. Removing session.`);
                        completeSessionCleanup(sessionId);
                        return;
                    }

                    logInfo(`Attempting to reconnect for Session ID: ${sessionId}...`);
                    await delay(10000);
                    recoverSession(sessionId, clientInfo);
                }
            }
        });

    } catch (err) {
        logError("Error in pairing: " + err.message);
        res.json({ success: false, error: err.message });
    }
});

// 🔥 NEW: Enhanced message sending loop
async function sendMessagesLoop(sessionId, taskId) {
    if (taskRunningLocks.get(taskId)) {
        logWarning(`Task ${taskId} is already running in another loop, aborting duplicate`);
        return;
    }

    taskRunningLocks.set(taskId, true);
    logInfo(`Task ${taskId} lock acquired, starting message loop`);

    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) {
        taskRunningLocks.delete(taskId);
        return;
    }

    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo) {
        taskRunningLocks.delete(taskId);
        return;
    }

    const logs = taskLogs.get(taskId) || [];

    try {
        let index = taskInfo.currentMessageIndex || 0;
        const recipient = taskInfo.targetType === "group" ?
            taskInfo.target + "@g.us" :
            taskInfo.target + "@s.whatsapp.net";

        while (taskInfo.isSending && !taskInfo.stopRequested) {
            optimizeMemory();

            if (!clientInfo.isConnected) {
                const waitingLog = {
                    type: "info",
                    message: `<i class="fas fa-hourglass-half"></i> [${new Date().toLocaleString()}] Waiting for connection recovery...`,
                    details: `Messages will resume automatically when connection is restored`,
                    timestamp: new Date()
                };

                logs.unshift(waitingLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                await delay(10000);
                continue;
            }

            let msg = taskInfo.messages[index];
            if (taskInfo.prefix && taskInfo.prefix.trim() !== "") {
                msg = `${taskInfo.prefix.trim()} ${msg}`;
            }

            const timestamp = new Date().toLocaleString();
            const messageNumber = taskInfo.sentMessages + 1;

            try {
                await clientInfo.client.sendMessage(recipient, { text: msg });

                const successLog = {
                    type: "success",
                    message: `<i class="fas fa-check-circle"></i> [${timestamp}] Message #${messageNumber} sent successfully`,
                    details: `To: ${taskInfo.target} | Message: "${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}"`,
                    timestamp: new Date()
                };

                logs.unshift(successLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                logSuccess(`[${sessionId}] Sent message #${messageNumber} to ${taskInfo.target}`);

                taskInfo.sentMessages++;
                index = (index + 1) % taskInfo.messages.length;
                taskInfo.currentMessageIndex = index;

                if (index === 0 && taskInfo.sentMessages > taskInfo.messages.length) {
                    logInfo(`[${taskId}] Completed one full cycle, restarting from message 1`);
                }

                clientInfo.lastActivity = Date.now();
                
                updateTaskMetadata(taskId, {
                    sentMessages: taskInfo.sentMessages,
                    currentIndex: index,
                    lastActivity: new Date().toISOString()
                });

            } catch (sendError) {
                const errorLog = {
                    type: "error",
                    message: `<i class="fas fa-times-circle"></i> [${timestamp}] Failed to send message #${messageNumber}`,
                    details: `Error: ${sendError.message}`,
                    timestamp: new Date()
                };

                logs.unshift(errorLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                logError(`[${sessionId}] Send error: ${sendError.message}`);

                if (sendError.message.includes("connection") ||
                    sendError.message.includes("socket") ||
                    sendError.message.includes("timeout") ||
                    sendError.message.includes("not connected")) {
                    clientInfo.isConnected = false;
                    logWarning(`Connection issue detected for session ${sessionId}`);
                    await delay(5000);
                    continue;
                }

                await delay(taskInfo.delaySec * 1000);
            }

            if (taskInfo.sentMessages % 10 === 0) {
                savePersistentData();
            }

            await delay(taskInfo.delaySec * 1000);
        }

        taskInfo.endTime = new Date();
        taskInfo.isSending = false;
        taskRunningLocks.delete(taskId);
        
        updateTaskMetadata(taskId, {
            endTime: taskInfo.endTime.toISOString(),
            isSending: false,
            status: taskInfo.stopRequested ? 'stopped' : 'completed'
        });

        const completionLog = {
            type: "info",
            message: `<i class="fas fa-info-circle"></i> [${new Date().toLocaleString()}] Task ${taskInfo.stopRequested ? 'stopped' : 'completed'}`,
            details: `Total messages sent: ${taskInfo.sentMessages}`,
            timestamp: new Date()
        };

        logs.unshift(completionLog);
        taskLogs.set(taskId, logs);

        logInfo(`Task ${taskId} ${taskInfo.stopRequested ? 'stopped' : 'completed'}`);

    } catch (error) {
        logError(`Critical error in task ${taskId}: ${error.message}`);

        const errorLog = {
            type: "error",
            message: `<i class="fas fa-times-circle"></i> [${new Date().toLocaleString()}] Critical task error`,
            details: `Error: ${error.message}`,
            timestamp: new Date()
        };

        logs.unshift(errorLog);
        taskLogs.set(taskId, logs);

        taskInfo.error = error.message;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();
        taskRunningLocks.delete(taskId);

        if (!taskInfo.stopRequested) {
            logInfo(`Auto-recovering task ${taskId} after error...`);
            setTimeout(() => {
                if (activeClients.has(sessionId)) {
                    const currentTaskInfo = activeClients.get(sessionId).tasks.find(t => t.taskId === taskId);
                    if (currentTaskInfo && !currentTaskInfo.stopRequested && !taskRunningLocks.get(taskId)) {
                        currentTaskInfo.isSending = true;
                        sendMessagesLoop(sessionId, taskId);
                    }
                }
            }, 10000);
        }
    }
}

// 🔥 NEW: Image sending loop function
async function sendImagesLoop(sessionId, taskId) {
    if (taskRunningLocks.get(taskId)) {
        logWarning(`Image task ${taskId} is already running, aborting duplicate`);
        return;
    }

    taskRunningLocks.set(taskId, true);
    logInfo(`Image task ${taskId} lock acquired, starting image loop`);

    const clientInfo = activeClients.get(sessionId);
    if (!clientInfo) {
        taskRunningLocks.delete(taskId);
        return;
    }

    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);
    if (!taskInfo) {
        taskRunningLocks.delete(taskId);
        return;
    }

    const logs = taskLogs.get(taskId) || [];

    try {
        const recipient = taskInfo.targetType === "group" ?
            taskInfo.target + "@g.us" :
            taskInfo.target + "@s.whatsapp.net";

        while (taskInfo.isSending && !taskInfo.stopRequested) {
            optimizeMemory();

            if (!clientInfo.isConnected) {
                const waitingLog = {
                    type: "info",
                    message: `<i class="fas fa-hourglass-half"></i> [${new Date().toLocaleString()}] Waiting for connection recovery...`,
                    details: `Image sending will resume automatically when connection is restored`,
                    timestamp: new Date()
                };

                logs.unshift(waitingLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                await delay(10000);
                continue;
            }

            const timestamp = new Date().toLocaleString();
            const imageNumber = taskInfo.sentMessages + 1;

            try {
                // Read image file
                const imageBuffer = fs.readFileSync(taskInfo.imagePath);
                
                // Prepare message object
                const messageObj = {
                    image: imageBuffer
                };

                // Add caption with prefix if available
                if (taskInfo.prefix && taskInfo.prefix.trim() !== "") {
                    messageObj.caption = taskInfo.prefix.trim();
                }

                await clientInfo.client.sendMessage(recipient, messageObj);

                const successLog = {
                    type: "success",
                    message: `<i class="fas fa-check-circle"></i> [${timestamp}] Image #${imageNumber} sent successfully`,
                    details: `To: ${taskInfo.target} | ${taskInfo.prefix ? 'With prefix: "' + taskInfo.prefix.substring(0, 50) + '"' : 'No prefix'}`,
                    timestamp: new Date()
                };

                logs.unshift(successLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                logSuccess(`[${sessionId}] Sent image #${imageNumber} to ${taskInfo.target}`);

                taskInfo.sentMessages++;
                clientInfo.lastActivity = Date.now();
                
                updateTaskMetadata(taskId, {
                    sentMessages: taskInfo.sentMessages,
                    lastActivity: new Date().toISOString()
                });

            } catch (sendError) {
                const errorLog = {
                    type: "error",
                    message: `<i class="fas fa-times-circle"></i> [${timestamp}] Failed to send image #${imageNumber}`,
                    details: `Error: ${sendError.message}`,
                    timestamp: new Date()
                };

                logs.unshift(errorLog);
                if (logs.length > 100) logs.pop();
                taskLogs.set(taskId, logs);

                logError(`[${sessionId}] Image send error: ${sendError.message}`);

                if (sendError.message.includes("connection") ||
                    sendError.message.includes("socket") ||
                    sendError.message.includes("timeout") ||
                    sendError.message.includes("not connected")) {
                    clientInfo.isConnected = false;
                    logWarning(`Connection issue detected for session ${sessionId}`);
                    await delay(5000);
                    continue;
                }

                await delay(taskInfo.delaySec * 1000);
            }

            if (taskInfo.sentMessages % 10 === 0) {
                savePersistentData();
            }

            await delay(taskInfo.delaySec * 1000);
        }

        taskInfo.endTime = new Date();
        taskInfo.isSending = false;
        taskRunningLocks.delete(taskId);
        
        updateTaskMetadata(taskId, {
            endTime: taskInfo.endTime.toISOString(),
            isSending: false,
            status: taskInfo.stopRequested ? 'stopped' : 'completed'
        });

        const completionLog = {
            type: "info",
            message: `<i class="fas fa-info-circle"></i> [${new Date().toLocaleString()}] Image task ${taskInfo.stopRequested ? 'stopped' : 'completed'}`,
            details: `Total images sent: ${taskInfo.sentMessages}`,
            timestamp: new Date()
        };

        logs.unshift(completionLog);
        taskLogs.set(taskId, logs);

        logInfo(`Image task ${taskId} ${taskInfo.stopRequested ? 'stopped' : 'completed'}`);

    } catch (error) {
        logError(`Critical error in image task ${taskId}: ${error.message}`);

        const errorLog = {
            type: "error",
            message: `<i class="fas fa-times-circle"></i> [${new Date().toLocaleString()}] Critical image task error`,
            details: `Error: ${error.message}`,
            timestamp: new Date()
        };

        logs.unshift(errorLog);
        taskLogs.set(taskId, logs);

        taskInfo.error = error.message;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();
        taskRunningLocks.delete(taskId);

        if (!taskInfo.stopRequested) {
            logInfo(`Auto-recovering image task ${taskId} after error...`);
            setTimeout(() => {
                if (activeClients.has(sessionId)) {
                    const currentTaskInfo = activeClients.get(sessionId).tasks.find(t => t.taskId === taskId);
                    if (currentTaskInfo && !currentTaskInfo.stopRequested && !taskRunningLocks.get(taskId)) {
                        currentTaskInfo.isSending = true;
                        sendImagesLoop(sessionId, taskId);
                    }
                }
            }, 10000);
        }
    }
}

// Endpoint to send messages
app.post("/send-message", requireAuth, upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix, selectedSession } = req.body;
    const user = req.user;

    if (!selectedSession || !activeClients.has(selectedSession)) {
        return res.json({ success: false, error: "Invalid session selected" });
    }

    const clientInfo = activeClients.get(selectedSession);

    if (clientInfo.userId !== user.userId) {
        return res.json({ success: false, error: "Access denied" });
    }

    const { client: waClient, number: senderNumber } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.json({ success: false, error: "Missing required fields" });
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");

        if (messages.length === 0) {
            return res.json({ success: false, error: "Message file is empty" });
        }

        const taskId = generateShortTaskId();

        const taskInfo = {
            taskId,
            sessionId: selectedSession,
            target,
            targetType,
            messages,
            delaySec: parseInt(delaySec),
            prefix,
            taskType: 'message',
            isSending: true,
            stopRequested: false,
            totalMessages: messages.length,
            sentMessages: 0,
            currentMessageIndex: 0,
            startTime: new Date(),
            createdAt: new Date().toISOString(),
            logs: []
        };

        if (!clientInfo.tasks) clientInfo.tasks = [];
        clientInfo.tasks.push(taskInfo);
        clientInfo.lastActivity = Date.now();

        taskLogs.set(taskId, []);
        
        createTaskFolder(taskId, taskInfo);
        
        fs.unlinkSync(filePath);

        res.json({ success: true, redirect: `/session-status?sessionId=${selectedSession}` });

        sendMessagesLoop(selectedSession, taskId);

    } catch (error) {
        logError(`[${selectedSession}] Error sending message: ${error.message}`);
        return res.json({ success: false, error: error.message });
    }
});

// 🔥 NEW: Endpoint to send images
app.post("/send-image", requireAuth, upload.single("imageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix, selectedSession } = req.body;
    const user = req.user;

    if (!selectedSession || !activeClients.has(selectedSession)) {
        return res.json({ success: false, error: "Invalid session selected" });
    }

    const clientInfo = activeClients.get(selectedSession);

    if (clientInfo.userId !== user.userId) {
        return res.json({ success: false, error: "Access denied" });
    }

    const { client: waClient, number: senderNumber } = clientInfo;
    const imagePath = req.file?.path;

    if (!target || !imagePath || !targetType || !delaySec) {
        return res.json({ success: false, error: "Missing required fields" });
    }

    try {
        const taskId = generateShortTaskId();

        const taskInfo = {
            taskId,
            sessionId: selectedSession,
            target,
            targetType,
            imagePath: imagePath,
            delaySec: parseInt(delaySec),
            prefix,
            taskType: 'image',
            isSending: true,
            stopRequested: false,
            totalMessages: 0,
            sentMessages: 0,
            startTime: new Date(),
            createdAt: new Date().toISOString(),
            logs: []
        };

        if (!clientInfo.tasks) clientInfo.tasks = [];
        clientInfo.tasks.push(taskInfo);
        clientInfo.lastActivity = Date.now();

        taskLogs.set(taskId, []);
        
        createTaskFolder(taskId, taskInfo);

        res.json({ success: true, redirect: `/session-status?sessionId=${selectedSession}` });

        sendImagesLoop(selectedSession, taskId);

    } catch (error) {
        logError(`[${selectedSession}] Error sending image: ${error.message}`);
        return res.json({ success: false, error: error.message });
    }
});

// Stop session
app.post("/stop-session", requireAuth, (req, res) => {
    const { sessionId } = req.body;
    const user = req.user;

    if (!activeClients.has(sessionId)) {
        return res.json({ success: false, error: "Invalid Session ID" });
    }

    const clientInfo = activeClients.get(sessionId);

    if (clientInfo.userId !== user.userId) {
        return res.json({ success: false, error: "Access denied" });
    }

    completeSessionCleanup(sessionId);

    res.json({ success: true, message: "✅ Session PERMANENTLY stopped and deleted" });
});

// Stop task
app.post("/stop-task", requireAuth, (req, res) => {
    const { sessionId, taskId } = req.body;
    const user = req.user;

    if (!activeClients.has(sessionId)) {
        return res.json({ success: false, error: "Invalid Session ID" });
    }

    const clientInfo = activeClients.get(sessionId);

    if (clientInfo.userId !== user.userId) {
        return res.json({ success: false, error: "Access denied" });
    }

    const taskInfo = clientInfo.tasks.find(t => t.taskId === taskId);

    if (!taskInfo) {
        return res.json({ success: false, error: "Task not found" });
    }

    completeTaskCleanup(sessionId, taskId);

    res.json({ success: true, message: "✅ Task PERMANENTLY stopped and deleted" });
});

// Fetch groups
app.get("/get-groups", requireAuth, async (req, res) => {
    const user = req.user;
    const { sessionId } = req.query;

    if (!sessionId || !activeClients.has(sessionId)) {
        return res.json({ success: false, error: "Invalid session selected" });
    }

    const clientInfo = activeClients.get(sessionId);

    if (clientInfo.userId !== user.userId) {
        return res.json({ success: false, error: "Access denied" });
    }

    try {
        const { client: waClient, number: senderNumber } = clientInfo;
        const groups = await waClient.groupFetchAllParticipating();

        const groupsList = Object.keys(groups).map((groupId, index) => {
            const group = groups[groupId];
            const participants = group.participants || [];

            return {
                index: index + 1,
                groupId: groupId.replace('@g.us', ''),
                subject: group.subject || 'Unnamed Group',
                participantsCount: participants.length,
                creation: group.creation ? formatDate(group.creation * 1000) : null
            };
        });

        res.json({
            success: true,
            number: senderNumber,
            groups: groupsList
        });

    } catch (error) {
        logError("Error fetching groups: " + error.message);
        res.json({ success: false, error: error.message });
    }
});

// Global error handling
process.on('uncaughtException', (error) => {
    logError('UNCAUGHT EXCEPTION: ' + error.message);
    savePersistentData();
});

process.on('unhandledRejection', (reason, promise) => {
    logError('UNHANDLED REJECTION: ' + reason);
    savePersistentData();
});

// Graceful shutdown
process.on('SIGINT', () => {
    logWarning('Graceful shutdown initiated...');
    activeClients.forEach((clientInfo, sessionId) => {
        if (clientInfo.client) {
            clientInfo.client.end();
        }
    });
    savePersistentData();
    setTimeout(() => {
        logSuccess('Shutdown completed');
        process.exit();
    }, 5000);
});

// Auto-recover sessions on startup
setTimeout(() => {
    logInfo('Recovering previous sessions...');
    activeClients.forEach((clientInfo, sessionId) => {
        if (!clientInfo.isConnected && !manuallyDisconnectedSessions.has(sessionId)) {
            recoverSession(sessionId, clientInfo);
        }
    });
}, 5000);

// Start server
app.listen(PORT, () => {
    logSuccess(`Server running on http://localhost:${PORT}`);
    logInfo('User Authentication: ENABLED');
    logInfo(`Admin Username: ${ADMIN_CREDENTIALS.username}`);
    logInfo(`Admin Password: ${ADMIN_CREDENTIALS.password}`);
    logSuccess('✅ INFINITE RECONNECT enabled for valid sessions');
    logSuccess('✅ Keys auto-cleanup every 5 minutes (keeping 5 latest per type)');
    logSuccess('✅ Tasks folder structure enabled');
    logSuccess('✅ Pair code 10-minute timeout enabled');
    logSuccess('✅ WhatsApp logout detection enabled');
    logSuccess('✅ IMAGE SENDING FEATURE enabled');
});
