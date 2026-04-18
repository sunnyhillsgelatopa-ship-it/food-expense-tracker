const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
const BACKUP_PATH = path.join(__dirname, '..', 'data', 'app.db.backup');
let db = null;
let saveTimer = null;

async function initDatabase() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('Database loaded from disk');
  } else {
    db = new SQL.Database();
    console.log('New database created');
  }

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Claims table
  db.run(`
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submitter_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'MYR',
      food_description TEXT NOT NULL,
      restaurant TEXT,
      category TEXT DEFAULT 'meal',
      receipt_photo TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      payment_method TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      paid_at DATETIME,
      FOREIGN KEY (submitter_id) REFERENCES users(id),
      FOREIGN KEY (target_id) REFERENCES users(id)
    )
  `);

  // Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Activity log table
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Add category column if missing (for upgrades)
  try { db.run('ALTER TABLE claims ADD COLUMN category TEXT DEFAULT "meal"'); } catch(e) {}

  // Create indexes
  try { db.run('CREATE INDEX idx_claims_submitter ON claims(submitter_id)'); } catch(e) {}
  try { db.run('CREATE INDEX idx_claims_target ON claims(target_id)'); } catch(e) {}
  try { db.run('CREATE INDEX idx_claims_status ON claims(status)'); } catch(e) {}
  try { db.run('CREATE INDEX idx_notifications_user ON notifications(user_id)'); } catch(e) {}
  try { db.run('CREATE INDEX idx_activity_log_user ON activity_log(user_id)'); } catch(e) {}

  saveDb();

  // Auto-backup every 5 minutes
  setInterval(() => {
    backupDb();
  }, 5 * 60 * 1000);

  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

// Debounced save - prevents too many disk writes
function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDb(), 200);
}

function backupDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(BACKUP_PATH, buffer);
    console.log('Database backup created at', new Date().toISOString());
  } catch (err) {
    console.error('Error creating backup:', err);
  }
}

function getDb() {
  return db;
}

// Helper: run a query and return rows as objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: get one row
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run insert/update and return info
function runSql(sql, params = []) {
  db.run(sql, params);
  const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
  const changesResult = db.exec('SELECT changes() as cnt');
  const lastId = lastIdResult[0]?.values[0]?.[0] || 0;
  const changes = changesResult[0]?.values[0]?.[0] || 0;
  debouncedSave();
  return { lastInsertRowid: lastId, changes };
}

module.exports = { initDatabase, getDb, saveDb, backupDb, queryAll, queryOne, runSql };
