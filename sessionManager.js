const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessions = {}; 
const statusMap = {}; 
const phoneMap = {};

function getRole(slot) {
    if (slot >= 1 && slot <= 10) return 'Sender';
    if (slot >= 11 && slot <= 14) return 'AI Closer';
    if (slot === 15) return 'Master Commander';
    return 'Unknown';
}

async function initSlot(slotNumber, bot, adminId, phoneNumber = null) {
    const sessionDir = path.join(__dirname, 'auth_sessions', `slot_${slotNumber}`);
    const credsFile = path.join(sessionDir, 'creds.json');
    const hasCreds = fs.existsSync(credsFile);

    // Agar session nahi hai aur valid phone number nahi mila toh return
    if (!hasCreds && (!phoneNumber || typeof phoneNumber !== 'string')) {
        statusMap[slotNumber] = 'DISCONNECTED';
        return null;
    }

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false
    });

    sessions[slotNumber] = sock;
    statusMap[slotNumber] = 'CONNECTING';

    // Agar session nahi hai aur phone number diya hai tabhi Pairing Code generate karein
    if (!sock.authState.creds.registered && typeof phoneNumber === 'string') {
        setTimeout(async () => {
            try {
                let cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(cleanNumber);
                await bot.telegram.sendMessage(adminId, 
                    `🔢 *Slot #${slotNumber} Pairing Code:*\n\n` +
                    `👉 \`${code}\`\n\n` +
                    `*(Code par tap karke copy karein)*\n\n` +
                    `*Link Kaise Karein:*\n` +
                    `1. WhatsApp kholein ➔ Three dots (⋮) ya Settings.\n` +
                    `2. *Linked Devices* par tap karein.\n` +
                    `3. *Link with phone number instead* par tap karein.\n` +
                    `4. Yeh 8-digit code wahan paste kar dein!`, 
                    { parse_mode: 'Markdown' }
                );
            } catch (err) {
                console.error(`Pairing code error slot ${slotNumber}:`, err.message);
                await bot.telegram.sendMessage(adminId, `❌ Pairing code error: ${err.message}`);
            }
        }, 3000);
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

            await bot.telegram.sendMessage(adminId, `🎉 *WhatsApp Slot #${slotNumber} Successfully Linked!*\nNumber: *+${userPhone}*\nRole: *${getRole(slotNumber)}*`, { parse_mode: 'Markdown' });
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

    await bot.telegram.sendMessage(adminId, `🗑️ Slot #${slotNumber} disconnected.`);
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
    for (let i = 1; i <= 15; i++) {
        const credsFile = path.join(__dirname, 'auth_sessions', `slot_${i}`, 'creds.json');
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
            
