const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const sessions = {}; // Active WhatsApp sockets (1 to 15)
const statusMap = {}; // Status of each slot

async function initSlot(slotNumber, bot, adminId) {
    const sessionDir = path.join(__dirname, 'auth_sessions', `slot_${slotNumber}`);
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

        if (qr) {
            try {
                const qrBuffer = await qrcode.toBuffer(qr);
                await bot.telegram.sendPhoto(adminId, { source: qrBuffer }, {
                    caption: `📱 QR Code: WhatsApp Slot #${slotNumber}\nRole: ${getRole(slotNumber)}\n(Apne WhatsApp Linked Devices se scan karein)`
                });
            } catch (err) {
                console.error(`QR send error for slot ${slotNumber}:`, err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                statusMap[slotNumber] = 'RECONNECTING';
                setTimeout(() => initSlot(slotNumber, bot, adminId), 5000);
            } else {
                statusMap[slotNumber] = 'DISCONNECTED';
                await bot.telegram.sendMessage(adminId, `⚠️ Alert: WhatsApp Slot #${slotNumber} Log out ho gaya!`);
            }
        } else if (connection === 'open') {
            statusMap[slotNumber] = 'CONNECTED';
            await bot.telegram.sendMessage(adminId, `✅ WhatsApp Slot #${slotNumber} (${getRole(slotNumber)}) successfully connect ho gaya!`);
        }
    });

    return sock;
}

function getRole(slot) {
    if (slot >= 1 && slot <= 10) return 'Campaign Sender / Requester';
    if (slot >= 11 && slot <= 14) return 'AI Sales Closer / Group Admin';
    if (slot === 15) return 'Master Commander & Scraper';
    return 'Unknown';
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

function getStatusSummary() {
    let report = "📊 *WhatsApp Fleet Status (1-15):*\n\n";
    for (let i = 1; i <= 15; i++) {
        const st = statusMap[i] || 'NOT INITIALIZED';
        const icon = st === 'CONNECTED' ? '🟢' : (st === 'CONNECTING' ? '🟡' : '🔴');
        report += `${icon} Slot #${i} [${getRole(i)}]: ${st}\n`;
    }
    return report;
}

module.exports = {
    initSlot,
    sessions,
    statusMap,
    getActiveSockets,
    getStatusSummary,
    getRole
};
  
