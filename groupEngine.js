const { getActiveSockets } = require('./sessionManager');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runGroupSeeding(groupJid, targetLimit = 800, contactsList, bot, adminId) {
    let adders = getActiveSockets(1, 10);
    let admins = getActiveSockets(11, 14);

    if (adders.length === 0 || admins.length === 0) {
        return bot.telegram.sendMessage(adminId, "❌ Group seeding ke liye Campaign Requesters (1-10) aur Admins (11-14) dono active hone chahiye!");
    }

    let contactIdx = 0;
    let adminIdx = 0;

    await bot.telegram.sendMessage(adminId, `👥 *Safe Group Seeding Started!*\nGroup: ${groupJid}\nTarget Cap: ${targetLimit}`);

    while (contactIdx < contactsList.length) {
        for (const adder of adders) {
            if (contactIdx >= contactsList.length) break;

            // Randomized batch between 20 and 40
            let batchSize = Math.floor(Math.random() * (40 - 20 + 1) + 20);
            let currentBatch = contactsList.slice(contactIdx, contactIdx + batchSize);
            let jids = currentBatch.map(c => `${c.phone}@s.whatsapp.net`);

            try {
                // Adder sends join requests
                await adder.sock.groupParticipantsUpdate(groupJid, jids, 'add');
                await bot.telegram.sendMessage(adminId, `📥 Slot #${adder.slot} ne ${jids.length} requests submit ki.`);

                // Wait 10 seconds for requests to hit WhatsApp servers
                await sleep(10000);

                // Rotating Admin Approver (11 to 14)
                let activeAdmin = admins[adminIdx % admins.length];
                adminIdx++;

                // Fetch pending requests & approve
                try {
                    const pendingList = await activeAdmin.sock.groupRequestParticipantsList(groupJid);
                    if (pendingList && pendingList.length > 0) {
                        const toApprove = pendingList.map(p => p.jid);
                        await activeAdmin.sock.groupRequestParticipantsUpdate(groupJid, toApprove, 'approve');
                        await bot.telegram.sendMessage(adminId, `🛡️ Admin Slot #${activeAdmin.slot} ne ${toApprove.length} members approve kar diye.`);
                    }
                } catch (appErr) {
                    console.error("Admin approval notice:", appErr.message);
                }

                contactIdx += batchSize;
                await sleep(15000); // 15 sec lock-step wait before next adder triggers
            } catch (err) {
                console.error(`Group add error via Slot ${adder.slot}:`, err.message);
            }
        }
    }

    await bot.telegram.sendMessage(adminId, "✅ Group seeding batch finished!");
}

module.exports = { runGroupSeeding };
