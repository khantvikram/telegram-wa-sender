const { Telegraf } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const xlsx = require('xlsx');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new Telegraf(BOT_TOKEN);
let waSock = null;
let pendingSchedule = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
    
    waSock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrBuffer = await qrcode.toBuffer(qr);
                await bot.telegram.sendPhoto(ADMIN_ID, { source: qrBuffer }, {
                    caption: "Naya QR Code (WhatsApp se scan karein)"
                });
            } catch (err) {
                console.error("QR send error:", err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                bot.telegram.sendMessage(ADMIN_ID, "WhatsApp Log out ho gaya hai. Dobara start karein.");
            }
        } else if (connection === 'open') {
            bot.telegram.sendMessage(ADMIN_ID, "WhatsApp successfully link ho chuka hai!");
        }
    });
}

connectToWhatsApp();

bot.start((ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;
    ctx.reply("Bot ready hai. Schedule karne ke liye command bhejein:\n\n/set 2026-10-05 10:30 | Aapka Message Yahan\n\nUske baad Excel file (.xlsx) bhej dein.");
});

bot.command('set', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;
    const input = ctx.message.text.replace('/set', '').trim();
    const parts = input.split('|');
    if (parts.length < 2) {
        return ctx.reply("Format galat hai. Aise bhejein:\n/set YYYY-MM-DD HH:MM | Message");
    }
    const timeStr = parts[0].trim();
    const message = parts[1].trim();
    pendingSchedule = { targetTime: new Date(timeStr), message: message };
    ctx.reply(`Schedule set ho gaya: ${timeStr} par. Ab Excel file bhejein jisme Column A me numbers hon.`);
});

bot.on('document', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;
    if (!pendingSchedule) {
        return ctx.reply("Pehle /set command se time aur message configure karein.");
    }

    try {
        const fileId = ctx.message.document.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        
        const workbook = xlsx.read(response.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        
        const numbers = [];
        data.forEach(row => {
            if (row && row[0]) {
                let num = row[0].toString().replace(/[^0-9]/g, '');
                if (num.length === 10) num = '91' + num;
                if (num.length >= 11) numbers.push(num);
            }
        });

        if (numbers.length === 0) {
            return ctx.reply("Excel file me koi valid number nahi mila.");
        }

        ctx.reply(`${numbers.length} numbers load ho gaye hain. Set time par delivery shuru hogi.`);

        const delayMs = pendingSchedule.targetTime.getTime() - Date.now();
        const executeDelay = delayMs > 0 ? delayMs : 1000;

        setTimeout(async () => {
            ctx.reply("Scheduled sending shuru ho rahi hai...");
            for (const num of numbers) {
                try {
                    const jid = `${num}@s.whatsapp.net`;
                    await waSock.sendMessage(jid, { text: pendingSchedule.message });
                    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 5000) + 7000));
                } catch (err) {
                    console.error("Message send fail:", num, err);
                }
            }
            ctx.reply("Saare messages successfully bhej diye gaye!");
            pendingSchedule = null;
        }, executeDelay);

    } catch (e) {
        console.error(e);
        ctx.reply("File read karne me error aaya.");
    }
});

bot.launch();
