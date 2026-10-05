const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessions = {}; 
const statusMap = {}; 
const phoneMap = {};

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getRole(slot) {
    if (slot >= 1 && slot <= 10) return 'Sender';
    if (slot >= 11 && slot <= 14) return 'AI Closer';
    if (slot === 15) return 'Master Commander';
    return 'Unknown';
}

async function initSlot(slotNumber, bot, adminId, phoneNumber = null) {
    const baseDir = path.join(__dirname, 'auth_sessions');
    const sessionDir = path.join(baseDir, `slot_${slotNumber}`);
    
    // Directory pehle hi create kar lein
    ensureDir(baseDir);
    ensureDir(sessionDir);

    const credsFile = path.join(sessionDir, 'creds.json');
    const hasCreds = fs.existsSync(credsFile);

    if (!hasCreds && (!phoneNumber || typeof phoneNumber !== 'string')) {
        statusMap[slotNumber] = 'DISCONNECTED';
        return null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    sessions[slotNumber] = sock;
    statusMap[slotNumber] = 'CONNECTING';

    if (!sock.authState.creds.registered && phoneNumber) {
        setTimeout(async () => {
            try {
                let cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                await bot.telegram.sendMessage(adminId, 
                    `🔢 *Slot #${slotNumber} Pairing Code:*\n\n` +
                    `👉 \`${formattedCode}\`\n\n` +
                    `*Steps:*\n` +
                    `1. WhatsApp kholein ➔ Three dots (⋮) / Settings ➔ Linked Devices\n` +
                    `2. *Link a Device* par tap karein\n` +
                    `3. Neeche *Link with phone number instead* chunein\n` +
                    `4. Yeh 8-digit code wahan daalein`, 
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                console.error(`Pairing code error slot ${slotNumber}:`, err);
                await bot.telegram.sendMessage(adminId, `❌ Pairing error: ${err.message}`);
            }
        }, 4000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect && hasCreds) {
                statusMap[slotNumber] = 'RECONNECTING';
                setTimeout(() => initSlot(slotNumber, bot, adminId, null), 5000);
            } else {
                statusMap[slotNumber] = 'DISCONNECTED';
                delete phoneMap[slotNumber];
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            statusMap[slotNumber] = 'CONNECTED';
            let userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Linked';
            phoneMap[slotNumber] = userPhone;

            await bot.telegram.sendMessage(adminId, `🎉 *Slot #${slotNumber} Successfully Connected!*\nNumber: *+${userPhone}*\nRole: *${getRole(slotNumber)}*`, { parse_mode: 'Markdown' });
        }
    });

    return sock;
}

async function logoutSlot(slotNumber, bot, adminId) {
    try {
        if (sessions[slotNumber]) {
            await sessions[slotNumber].logout();
            delete sessions[slotNumber];
        }
    } catch (e) {}

    const sessionDir = path.join(__dirname, 'auth_sessions', `slot_${slotNumber}`);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    statusMap[slotNumber] = 'DISCONNECTED';
    delete phoneMap[slotNumber];

    await bot.telegram.sendMessage(adminId, `🗑️ Slot #${slotNumber} clear ho gaya.`);
}

function getActiveSockets(minSlot = 1, maxSlot = 10) {
    const active = [];
    for (let i = minSlot; i <= maxSlot; i++) {
        if (sessions[i] && statusMap[i] === 'CONNECTED') {
            active.push({ slot: i, sock: sessions[i] });
        }
    }
    return active;
}

function getSlotInfo(slotNumber) {
    const status = statusMap[slotNumber] || 'DISCONNECTED';
    const phone = phoneMap[slotNumber] || null;
    return { status, phone, role: getRole(slotNumber) };
}

function autoBootSavedSessions(bot, adminId) {
    const baseDir = path.join(__dirname, 'auth_sessions');
    ensureDir(baseDir);
    for (let i = 1; i <= 15; i++) {
        const slotDir = path.join(baseDir, `slot_${i}`);
        ensureDir(slotDir);
        const credsFile = path.join(slotDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
            initSlot(i, bot, adminId, null);
        }
    }
}

module.exports = {
    initSlot,
    logoutSlot,
    autoBootSavedSessions,
    getActiveSockets,
    getSlotInfo,
    statusMap,
    phoneMap,
    getRole
};
