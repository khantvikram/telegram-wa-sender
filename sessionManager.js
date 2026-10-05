const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const sessions = {}; 
const statusMap = {}; 
const phoneMap = {}; // Connected WhatsApp numbers store karne ke liye

function getRole(slot) {
    if (slot >= 1 && slot <= 10) return 'Sender';
    if (slot >= 11 && slot <= 14) return 'AI Closer';
    if (slot === 15) return 'Master Commander';
    return 'Unknown';
}

async function initSlot(slotNumber, bot, adminId, forceQR = false) {
    const sessionDir = path.join(__dirname, 'auth_sessions', `slot_${slotNumber}`);
    const credsFile = path.join(sessionDir, 'creds.json');
    const hasCreds = fs.existsSync(credsFile);

    // Agar session nahi hai aur user ne QR nahi manga toh kuch mat karo
    if (!hasCreds && !forceQR) {
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
        printQRInTerminal: false
    });

    sessions[slotNumber] = sock;
    statusMap[slotNumber] = 'CONNECTING';

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Sirf user ke mangne par ek hi QR bhejo
        if (qr && forceQR) {
            try {
                const qrBuffer = await qrcode.toBuffer(qr);
                await bot.telegram.sendPhoto(adminId, { source: qrBuffer }, {
                    caption: `📱 *QR Code for Slot #${slotNumber}*\nRole: *${getRole(slotNumber)}*\n\nWhatsApp ➔ Linked Devices ➔ Scan karein.`
                });
            } catch (err) {
                console.error(`QR send error for slot ${slotNumber}:`, err.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect && hasCreds) {
                statusMap[slotNumber] = 'RECONNECTING';
                setTimeout(() => initSlot(slotNumber, bot, adminId, false), 5000);
            } else {
                statusMap[slotNumber] = 'DISCONNECTED';
                delete phoneMap[slotNumber];
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            statusMap[slotNumber] = 'CONNECTED';
            
            // Connected phone number fetch karna
            let userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Linked';
            phoneMap[slotNumber] = userPhone;

            await bot.telegram.sendMessage(adminId, `✅ *Slot #${slotNumber} Connected!*\nNumber: *+${userPhone}*\nRole: *${getRole(slotNumber)}*`, { parse_mode: 'Markdown' });
        }
    });

    return sock;
}

// Disconnect / Logout slot
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

    await bot.telegram.sendMessage(adminId, `🗑️ Slot #${slotNumber} has been logged out and cleared.`);
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

// Purane saved WhatsApps ko chupchap background me connect karna (Bina QR bheje)
function autoBootSavedSessions(bot, adminId) {
    for (let i = 1; i <= 15; i++) {
        const credsFile = path.join(__dirname, 'auth_sessions', `slot_${i}`, 'creds.json');
        if (fs.existsSync(credsFile)) {
            initSlot(i, bot, adminId, false);
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
