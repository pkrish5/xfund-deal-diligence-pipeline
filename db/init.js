const Database = require('better-sqlite3');
const db = new Database('db/deals.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS deal_mappings (
    deal_id TEXT PRIMARY KEY,
    calendar_event_id TEXT,
    asana_task_id TEXT,
    notion_deal_page_id TEXT,
    company_name TEXT,
    current_stage TEXT DEFAULT 'pitch',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

console.log('✅ Database initialized');
db.close();
