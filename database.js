const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'enterprise.db'));

// Database tables initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT,
    category TEXT DEFAULT 'General',
    is_blacklisted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY,
    template_text TEXT
  );

  CREATE TABLE IF NOT EXISTS campaign_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT DEFAULT 'IDLE',
    current_index INTEGER DEFAULT 0,
    active_template_id INTEGER DEFAULT 1,
    last_slot_used INTEGER DEFAULT 1,
    total_processed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groups_target (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT UNIQUE,
    target_limit INTEGER DEFAULT 800,
    current_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE'
  );

  INSERT OR IGNORE INTO campaign_state (id, status, current_index, active_template_id, last_slot_used, total_processed)
  VALUES (1, 'IDLE', 0, 1, 1, 0);
`);

module.exports = {
  saveContact: (phone, name, category = 'General') => {
    const stmt = db.prepare(`
      INSERT INTO contacts (phone, name, category) 
      VALUES (?, ?, ?) 
      ON CONFLICT(phone) DO UPDATE SET name = excluded.name, category = excluded.category
    `);
    return stmt.run(phone, name, category);
  },

  blacklistContact: (phone) => {
    return db.prepare(`UPDATE contacts SET is_blacklisted = 1 WHERE phone = ?`).run(phone);
  },

  isBlacklisted: (phone) => {
    const row = db.prepare(`SELECT is_blacklisted FROM contacts WHERE phone = ?`).get(phone);
    return row ? row.is_blacklisted === 1 : false;
  },

  getAllContacts: () => {
    return db.prepare(`SELECT phone, name FROM contacts WHERE is_blacklisted = 0`).all();
  },

  saveTemplate: (id, text) => {
    const stmt = db.prepare(`
      INSERT INTO templates (id, template_text)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET template_text = excluded.template_text
    `);
    return stmt.run(id, text);
  },

  getTemplate: (id) => {
    const row = db.prepare(`SELECT template_text FROM templates WHERE id = ?`).get(id);
    return row ? row.template_text : null;
  },

  updateCampaignState: (updates) => {
    const keys = Object.keys(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    return db.prepare(`UPDATE campaign_state SET ${setClause} WHERE id = 1`).run(...values);
  },

  getCampaignState: () => {
    return db.prepare(`SELECT * FROM campaign_state WHERE id = 1`).get();
  }
};
