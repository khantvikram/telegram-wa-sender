const db = require('./database');
const { getActiveSockets } = require('./sessionManager');

let isPaused = false;
let isRunning = false;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(minSec = 8, maxSec = 15) {
    return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

async function startMatrixCampaign(contacts, bot, adminId) {
    if (isRunning) {
        return bot.telegram.sendMessage(adminId, "⚠️ Campaign pehle se chal raha hai!");
    }

    isRunning = true;
    isPaused = false;
    db.updateCampaignState({ status: 'RUNNING' });

    let state = db.getCampaignState();
    let currentIndex = state.current_index || 0;
    let templateId = state.active_template_id || 1;
    let cycleCounter = 0; // Tracks 100-msg threshold

    await bot.telegram.sendMessage(adminId, `🚀 *Matrix Campaign Started!*\nTotal Contacts: ${contacts.length}\nStarting Index: ${currentIndex}\nInitial Template: #${templateId}`, { parse_mode: 'Markdown' });

    while (currentIndex < contacts.length) {
        if (isPaused) {
            db.updateCampaignState({ status: 'PAUSED', current_index: currentIndex, active_template_id: templateId });
            await bot.telegram.sendMessage(adminId, `⏸️ Campaign paused at index ${currentIndex}.`);
            isRunning = false;
            return;
        }

        // Active sender sockets (Slots 1 to 10)
        let senders = getActiveSockets(1, 10);
        if (senders.length === 0) {
            await bot.telegram.sendMessage(adminId, "❌ Koi bhi Campaign Sender (Slots 1-10) connected nahi hai! Campaign halted.");
            isRunning = false;
            return;
        }

        // Pseudo-random start slot per cycle
        let startIndex = Math.floor(Math.random() * senders.length);
        let orderedSenders = [...senders.slice(startIndex), ...senders.slice(0, startIndex)];

        for (const item of orderedSenders) {
            if (isPaused || currentIndex >= contacts.length) break;

            const currentSlot = item.slot;
            const sock = item.sock;

            // 5 messages per slot limit
            for (let m = 0; m < 5; m++) {
                if (isPaused || currentIndex >= contacts.length) break;

                const contact = contacts[currentIndex];

                // Check STOP / Blacklist
                if (db.isBlacklisted(contact.phone)) {
                    currentIndex++;
                    continue;
                }

                // Check Template Switch (Every 100 messages)
                if (cycleCounter >= 100) {
                    templateId = (templateId % 10) + 1;
                    cycleCounter = 0;
                    await bot.telegram.sendMessage(adminId, `🔄 *100 Messages Completed!* Switched to Template #${templateId}`, { parse_mode: 'Markdown' });
                }

                let templateText = db.getTemplate(templateId) || "Hello {name}, special offer from GJ Enterprise! Reply STOP to unsubscribe.";
                let finalName = contact.name ? contact.name.trim() : "Sir/Madam";
                let messageBody = templateText.replace(/{name}/g, finalName);

                try {
                    const jid = `${contact.phone}@s.whatsapp.net`;
                    await sock.sendMessage(jid, { text: messageBody });
                } catch (err) {
                    console.error(`Slot ${currentSlot} send error to ${contact.phone}:`, err.message);
                }

                currentIndex++;
                cycleCounter++;
                db.updateCampaignState({ current_index: currentIndex, active_template_id: templateId, total_processed: currentIndex });

                // Jitter delay (8-15 sec)
                await sleep(getRandomDelay(8, 15));

                // Batch cooldown break every 20 messages
                if (currentIndex % 20 === 0) {
                    await sleep(45000); // 45 seconds pause
                }
            }
        }
    }

    isRunning = false;
    db.updateCampaignState({ status: 'IDLE', current_index: 0 });
    await bot.telegram.sendMessage(adminId, "🎉 *Campaign Complete!* Saare messages successfully process ho gaye.", { parse_mode: 'Markdown' });
}

function pauseCampaign() {
    isPaused = true;
}

function resumeCampaign(bot, adminId) {
    if (isRunning) return false;
    let contacts = db.getAllContacts();
    startMatrixCampaign(contacts, bot, adminId);
    return true;
}

module.exports = {
    startMatrixCampaign,
    pauseCampaign,
    resumeCampaign
};
