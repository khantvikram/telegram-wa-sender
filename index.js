const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const xlsx = require('xlsx');
const axios = require('axios');

const db = require('./database');
const { initSlot, logoutSlot, autoBootSavedSessions, getSlotInfo } = require('./sessionManager');
const { startMatrixCampaign, pauseCampaign, resumeCampaign } = require('./matrixEngine');
const { runGroupSeeding } = require('./groupEngine');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Enterprise WA Engine Active & Running!\n');
}).listen(PORT, () => console.log(`Keep-alive server on port ${PORT}`));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new Telegraf(BOT_TOKEN);
let awaitingPhoneSlot = null; // Track kaunse slot ke liye phone number maanga hai

autoBootSavedSessions(bot, ADMIN_ID);

function getMainMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📱 Manage WhatsApp Slots (1-15)', 'menu_slots')],
        [Markup.button.callback('🚀 New Matrix Campaign', 'menu_campaign'), Markup.button.callback('📂 Audience Vault', 'menu_vault')],
        [Markup.button.callback('⏸️ Pause Campaign', 'btn_pause'), Markup.button.callback('▶️ Resume Campaign', 'btn_resume')],
        [Markup.button.callback('📝 10-Template Manager', 'menu_templates'), Markup.button.callback('👥 Safe Group Growth', 'menu_group')],
        [Markup.button.callback('📋 Delivery & Fleet Report', 'menu_report')]
    ]);
}

bot.start((ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;
    awaitingPhoneSlot = null;
    ctx.reply("🔥 *ENTERPRISE WA MARKETING DASHBOARD*\n\nNeeche diye gaye buttons se control karein:", {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
});

function generateSlotsKeyboard() {
    const buttons = [];
    for (let i = 1; i <= 15; i++) {
        const info = getSlotInfo(i);
        let btnText = "";
        
        if (info.status === 'CONNECTED' && info.phone) {
            btnText = `🟢 #${i}: +${info.phone} (${info.role})`;
        } else if (info.status === 'CONNECTING') {
            btnText = `🟡 #${i}: Connecting...`;
        } else {
            btnText = `🔴 #${i}: Free / Empty (${info.role})`;
        }

        buttons.push([Markup.button.callback(btnText, `manage_slot_${i}`)]);
    }
    buttons.push([Markup.button.callback('🔙 Back to Main Menu', 'menu_back')]);
    return Markup.inlineKeyboard(buttons);
}

bot.action('menu_slots', (ctx) => {
    awaitingPhoneSlot = null;
    ctx.reply("📱 *WhatsApp Slots Manager (1-15)*\n\nJis slot ko connect karna hai uspar tap karein:", {
        parse_mode: 'Markdown',
        ...generateSlotsKeyboard()
    });
});

bot.action(/manage_slot_(\d+)/, (ctx) => {
    const slotId = parseInt(ctx.match[1]);
    const info = getSlotInfo(slotId);

    let msg = `⚙️ *Slot #${slotId} Setup:*\n`;
    msg += `Role: *${info.role}*\n`;
    msg += `Status: *${info.status}*\n`;
    if (info.phone) msg += `Phone Number: *+${info.phone}*\n`;

    const buttons = [];
    if (info.status === 'CONNECTED') {
        buttons.push([Markup.button.callback(`❌ Disconnect / Logout Slot #${slotId}`, `logout_slot_${slotId}`)]);
    } else {
        buttons.push([Markup.button.callback(`🔢 Connect via Pairing Code (No QR)`, `pair_slot_${slotId}`)]);
    }
    buttons.push([Markup.button.callback('🔙 Back to Slots', 'menu_slots')]);

    ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/pair_slot_(\d+)/, (ctx) => {
    const slotId = parseInt(ctx.match[1]);
    awaitingPhoneSlot = slotId;
    ctx.reply(`📱 *Slot #${slotId} ke liye WhatsApp Number bhejein:*\n\nCountry code ke sath likhein (Jaise: \`919876543210\`)`, { parse_mode: 'Markdown' });
});

bot.action(/logout_slot_(\d+)/, async (ctx) => {
    const slotId = parseInt(ctx.match[1]);
    await logoutSlot(slotId, bot, ADMIN_ID);
    ctx.reply(`Slot #${slotId} disconnect kar diya gaya hai.`);
});

bot.action('menu_report', (ctx) => {
    let report = "📊 *Live Fleet Report (1-15):*\n\n";
    for (let i = 1; i <= 15; i++) {
        const info = getSlotInfo(i);
        const icon = info.status === 'CONNECTED' ? '🟢' : '🔴';
        const phone = info.phone ? `(+${info.phone})` : '(No Device)';
        report += `${icon} *Slot #${i}* [${info.role}]: ${info.status} ${phone}\n`;
    }
    ctx.reply(report, { parse_mode: 'Markdown' });
});

bot.action('btn_pause', (ctx) => {
    pauseCampaign();
    ctx.reply("⏸️ Matrix Campaign paused!");
});

bot.action('btn_resume', (ctx) => {
    resumeCampaign(bot, ADMIN_ID);
    ctx.reply("▶️ Resuming Matrix Campaign...");
});

bot.action('menu_back', (ctx) => {
    awaitingPhoneSlot = null;
    ctx.reply("🔥 Main Dashboard:", getMainMenu());
});

// Normal message / Phone number input handler
bot.on('text', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;

    if (awaitingPhoneSlot) {
        let inputNum = ctx.message.text.trim().replace(/[^0-9]/g, '');
        if (inputNum.length === 10) inputNum = '91' + inputNum;

        if (inputNum.length >= 11) {
            const slotTarget = awaitingPhoneSlot;
            awaitingPhoneSlot = null;
            ctx.reply(`⏳ Slot #${slotTarget} ke liye Pairing Code request kiya ja raha hai... Number: +${inputNum}`);
            initSlot(slotTarget, bot, ADMIN_ID, inputNum);
        } else {
            ctx.reply("❌ Phone number galat lag raha hai. Kripya 10 ya 12 digit ka valid number bhejein (Jaise: 9198XXXXXXXX).");
        }
    }
});

// Excel Document handler
bot.on('document', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;

    try {
        const fileId = ctx.message.document.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

        const workbook = xlsx.read(response.data, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

        let loaded = 0;
        data.forEach(row => {
            if (row && row[0]) {
                let num = row[0].toString().replace(/[^0-9]/g, '');
                if (num.length === 10) num = '91' + num;
                let name = row[1] ? row[1].toString() : null;
                if (num.length >= 11) {
                    db.saveContact(num, name, 'Excel Upload');
                    loaded++;
                }
            }
        });

        ctx.reply(`✅ *${loaded} Contacts Imported into Vault!*\nAb aap /start_campaign command se message bhej sakte hain.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
        ctx.reply("❌ File padhne me error aaya.");
    }
});

bot.command('set_template', (ctx) => {
    const parts = ctx.message.text.split(' ');
    const id = parseInt(parts[1]);
    const text = parts.slice(2).join(' ');
    if (id >= 1 && id <= 10 && text) {
        db.saveTemplate(id, text);
        ctx.reply(`✅ Template #${id} successfully saved!`);
    } else {
        ctx.reply("Usage: /set_template <1-10> <Aapka Message {name} ke sath>");
    }
});

bot.command('start_campaign', (ctx) => {
    let contacts = db.getAllContacts();
    if (contacts.length === 0) return ctx.reply("Vault khali hai! Pehle Excel file upload karein.");
    startMatrixCampaign(contacts, bot, ADMIN_ID);
});

bot.launch();
