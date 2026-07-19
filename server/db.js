import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos')
fs.mkdirSync(PHOTOS_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'baby.db'))
db.pragma('journal_mode = WAL')

const EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('breastfeed','formula','diaper','weight','height','photo','milestone')),
  occurred_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  notes TEXT,
  duration_min REAL,
  amount_ml REAL,
  kind TEXT,
  weight_g REAL,
  height_cm REAL,
  photo_path TEXT,
  awake_after INTEGER NOT NULL DEFAULT 0,
  analysis TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`

db.exec(`
${EVENTS_SCHEMA};
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT UNIQUE NOT NULL,
  subscription TEXT NOT NULL,
  user TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`)

// Migration: older databases lack height_cm, and the type CHECK constraint
// can't be altered in place — rebuild the table once.
const cols = db.prepare('PRAGMA table_info(events)').all()
if (!cols.some((c) => c.name === 'height_cm')) {
  db.exec(`
    BEGIN;
    ALTER TABLE events RENAME TO events_old;
    ${EVENTS_SCHEMA};
    INSERT INTO events (id, type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, photo_path, created_at)
      SELECT id, type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, photo_path, created_at FROM events_old;
    DROP TABLE events_old;
    CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);
    COMMIT;
  `)
  console.log('migrated events table: added height support')
}

// Migration: awake_after marks that the baby stayed awake in the interval
// after a feed (sleep-cycle view); plain ADD COLUMN suffices.
if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'awake_after')) {
  db.exec('ALTER TABLE events ADD COLUMN awake_after INTEGER NOT NULL DEFAULT 0')
  console.log('migrated events table: added awake_after')
}

// Migration: analysis holds the auto-generated Claude read of a diaper photo.
if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'analysis')) {
  db.exec('ALTER TABLE events ADD COLUMN analysis TEXT')
  console.log('migrated events table: added analysis')
}

// Migration: 'milestone' joined the type CHECK, which can't be altered in
// place — rebuild once. Keyed on the live table's SQL, not a column check,
// since this migration adds no column. Runs after the ADD COLUMN migrations
// above so every column named here exists in the old table.
if (!db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get().sql.includes("'milestone'")) {
  db.exec(`
    BEGIN;
    ALTER TABLE events RENAME TO events_old;
    ${EVENTS_SCHEMA};
    INSERT INTO events (id, type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, height_cm, photo_path, awake_after, analysis, created_at)
      SELECT id, type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, height_cm, photo_path, awake_after, analysis, created_at FROM events_old;
    DROP TABLE events_old;
    CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);
    COMMIT;
  `)
  console.log('migrated events table: added milestone type')
}

// Backfill: bottle feeds gained a kind (formula | breastmilk); rows logged
// before the split mean formula. Idempotent, so it just runs every startup.
db.exec("UPDATE events SET kind = 'formula' WHERE type = 'formula' AND kind IS NULL")

export function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
}

export function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}
