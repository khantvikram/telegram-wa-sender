const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const xlsx = require('xlsx');
const axios = require('axios');

const db = require('./database');
const { initSlot, getStatusSummary, sessions } = require('./sessionManager');
const { startMatrixCampaign, pauseCampaign, resumeCampaign } = require('./matrixEngine');
const { runGroupSeeding } = require('./groupEngine');

// Render keep-alive dummy web server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Enterprise WA Engine Live & Active!\n');
}).listen(PORT, () => console.log(`Keep-alive server on port ${PORT}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID;

// Auto-boot WhatsApp slots (1 to 15)
for (let i = 1; i <= 15; i++) {
    initSlot(i, bot, ADMIN_ID);
}

// Master Dashboard UI Keyboards
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('📱 Manage WhatsApp (1-15)', 'menu_slots'), Markup.button.callback('📊 Fleet Live Status', 'menu_status')],
    [Markup.button.callback('🚀 New Matrix Campaign', 'menu_campaign'), Markup.button.callback('📂 Audience Vault (CRM)', 'menu_vault')],
    [Markup.button.callback('⏸️️ Pause Campaign', 'btn_pause'), Markup.button.callback('▶️ Resume Campaign', 'btn_resume')],
    [Markup.button.callback('📝 10-Template Manager', 'menu_templates'), Markup.button.callback('🛡️ Anti-Ban Controls', 'menu_antiban')],
    [Markup.button.callback('👥 Safe Group Growth', 'menu_group'), Markup.button.callback('📋 Delivery Report', 'menu_report')]
]);

bot.start((ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID.toString()) return;
    ctx.reply("🔥 *ENTERPRISE WA MARKETING SUITE*\nSelect an option below to control your fleet:", {
        parse_mode: 'Markdown',
        ...mainMenu
    });
});

// Dashboard Actions
bot.action('menu_status', (ctx) => {
    ctx.reply(getStatusSummary(), { parse_mode: 'Markdown' });
});

bot.action('menu_slots', (ctx) => {
    let buttons = [];
    for (let i = 1; i <= 15; i += 3) {
        buttons.push([
            Markup.button.callback(`Slot #${i} QR`, `slot_qr_${i}`),
            Markup.button.callback(`Slot #${i+1} QR`, `slot_qr_${i+1}`),
            Markup.button.callback(`Slot #${i+2} QR`, `slot_qr_${i+2}`)
        ]);
    }
    buttons.push([Markup.button.callback('🔙 Back to Dashboard', 'menu_back')]);
    ctx.reply("📱 Select slot to view or scan QR:", Markup.inlineKeyboard(buttons));
});

bot.action(/slot_qr_(\d+)/, (ctx) => {
    const slotId = parseInt(ctx.match[1]);
    initSlot(slotId, bot, ADMIN_ID);
    ctx.reply(`Slot #${slotId} initialization triggered. QR code photo aane par WhatsApp se scan karein.`);
});

bot.action('btn_pause', (ctx) => {
    pauseCampaign();
    ctx.reply("⏸️ Pause signal sent to Matrix Campaign.");
});

bot.action('btn_resume', (ctx) => {
    resumeCampaign(bot, ADMIN_ID);
    ctx.reply("▶️ Resuming campaign from last saved index.");
});

bot.action('menu_back', (ctx) => {
    ctx.reply("🔥 Main Dashboard:", mainMenu);
});

// Excel / Document Contact Ingestion
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
                    db.saveContact(num, name, 'Excel Import');
                    loaded++;
                }
            }
        });

        ctx.reply(`✅ *${loaded} Contacts Loaded into Vault!*\nAb aap seedha *New Matrix Campaign* start kar sakte hain.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
        ctx.reply("File parse karne me error aaya.");
    }
});

// Text commands (Template setup & Matrix start)
bot.command('set_template', (ctx) => {
    const parts = ctx.message.text.split(' ');
    const id = parseInt(parts[1]);
    const text = parts.slice(2).join(' ');
    if (id >= 1 && id <= 10 && text) {
        db.saveTemplate(id, text);
        ctx.reply(`✅ Template #${id} successfully saved!`);
    } else {
        ctx.reply("Usage: /set_template <1-10> <Message Text with {name}>");
    }
});

bot.command('start_campaign', (ctx) => {
    let contacts = db.getAllContacts();
    if (contacts.length === 0) return ctx.reply("Vault me koi valid contacts nahi hain! Pehle Excel upload karein.");
    startMatrixCampaign(contacts, bot, ADMIN_ID);
});

bot.launch();
