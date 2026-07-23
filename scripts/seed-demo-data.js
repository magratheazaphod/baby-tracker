// Seeds a throwaway SQLite database with entirely synthetic demo data for
// README screenshots. Nothing here touches the real DATA_DIR or .env.
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.SEED_DIR
if (!DIR) {
  console.error('SEED_DIR is required — point it at a throwaway directory, e.g.\n' +
    '  SEED_DIR=/tmp/bt-demo SEED_BIRTH=2026-05-02 SEED_NOW=2026-07-23T15:40:00-07:00 \\\n' +
    '    node scripts/seed-demo-data.js')
  process.exit(1)
}
// This script deletes the database it seeds, so refuse to aim it at a real one.
const resolved = path.resolve(DIR)
for (const real of [path.resolve(process.env.DATA_DIR || 'data'), '/data']) {
  if (resolved === real) {
    console.error(`refusing to seed ${resolved} — that is a live data directory`)
    process.exit(1)
  }
}
fs.mkdirSync(path.join(DIR, 'photos'), { recursive: true })
const dbPath = path.join(DIR, 'baby.db')
fs.rmSync(dbPath, { force: true })
fs.rmSync(dbPath + '-wal', { force: true })
fs.rmSync(dbPath + '-shm', { force: true })

const db = new Database(dbPath)
db.exec(`
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('breastfeed','formula','diaper','weight','height','head','photo','milestone')),
  occurred_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  notes TEXT,
  duration_min REAL,
  amount_ml REAL,
  kind TEXT,
  weight_g REAL,
  height_cm REAL,
  head_cm REAL,
  photo_path TEXT,
  awake_after INTEGER NOT NULL DEFAULT 0,
  analysis TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_occurred ON events(occurred_at);
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT UNIQUE NOT NULL,
  subscription TEXT NOT NULL, user TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`)

// Deterministic PRNG so re-running the seeder reproduces the same screenshots.
let s = 20260101
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const jitter = (m) => (rnd() - 0.5) * 2 * m

const USERS = ['Alex', 'Sam']
const BIRTH = new Date(process.env.SEED_BIRTH + 'T09:20:00-07:00')
const NOW = new Date(process.env.SEED_NOW)
const DAYS = Math.ceil((NOW - BIRTH) / 864e5)

const ins = db.prepare(
  `INSERT INTO events (type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, height_cm, head_cm, awake_after)
   VALUES (@type, @occurred_at, @created_by, @notes, @duration_min, @amount_ml, @kind, @weight_g, @height_cm, @head_cm, @awake_after)`
)
const add = (o) =>
  ins.run({
    notes: null, duration_min: null, amount_ml: null, kind: null,
    weight_g: null, height_cm: null, head_cm: null, awake_after: 0, ...o,
  })

const iso = (d) => new Date(d).toISOString()

db.transaction(() => {
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(NOW.getTime() - d * 864e5)
    const ageDays = Math.round((day - BIRTH) / 864e5)
    if (ageDays < 0) continue
    // Feeds cluster every ~2.5h newborn, stretching toward ~3h by 8 weeks.
    const gap = 2.4 + Math.min(ageDays, 56) / 80
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + 864e5)
    let cur = new Date(dayStart.getTime() + rnd() * 60 * 6e4)
    while (cur < dayEnd && cur <= NOW) {
      const by = pick(USERS)
      // Nurse first; supplement with a bottle on some feeds.
      add({
        type: 'breastfeed', occurred_at: iso(cur), created_by: by,
        duration_min: Math.round(14 + jitter(7)),
        awake_after: rnd() < 0.28 ? 1 : 0,
      })
      if (rnd() < 0.3) {
        const top = new Date(cur.getTime() + (12 + rnd() * 25) * 6e4)
        if (top <= NOW)
          add({
            type: 'formula', occurred_at: iso(top), created_by: by,
            amount_ml: Math.round((45 + ageDays * 0.6 + jitter(15)) / 5) * 5,
            kind: rnd() < 0.35 ? 'breastmilk' : 'formula',
          })
      }
      // A diaper around most feeds.
      if (rnd() < 0.85) {
        const dt = new Date(cur.getTime() + (5 + rnd() * 40) * 6e4)
        if (dt <= NOW)
          add({
            type: 'diaper', occurred_at: iso(dt), created_by: pick(USERS),
            kind: rnd() < 0.5 ? 'pee' : rnd() < 0.55 ? 'poop' : 'both',
          })
      }
      cur = new Date(cur.getTime() + (gap + jitter(0.5)) * 36e5)
    }

    // Weekly-ish growth measurements, on the same morning.
    if (ageDays % 7 === 2) {
      const m = new Date(dayStart.getTime() + 9.5 * 36e5)
      if (m <= NOW) {
        add({ type: 'weight', occurred_at: iso(m), created_by: 'Alex',
          weight_g: Math.round(3350 + ageDays * 29 + jitter(60)) })
        add({ type: 'height', occurred_at: iso(m), created_by: 'Alex',
          height_cm: Math.round((50 + ageDays * 0.11 + jitter(0.3)) * 10) / 10 })
        add({ type: 'head', occurred_at: iso(m), created_by: 'Alex',
          head_cm: Math.round((34.5 + ageDays * 0.055 + jitter(0.2)) * 10) / 10 })
      }
    }
  }

  const ms = [
    [40, 'First real smile — at the ceiling fan, of course'],
    [30, 'Slept a five-hour stretch. We did not.'],
    [18, 'Started tracking the cat across the room'],
    [6, 'Rolled halfway over during tummy time'],
  ]
  for (const [ago, note] of ms) {
    const t = new Date(NOW.getTime() - ago * 864e5 + 11 * 36e5)
    if (t > BIRTH && t <= NOW)
      add({ type: 'milestone', occurred_at: iso(t), created_by: pick(USERS), notes: note })
  }
})()

console.log('seeded', db.prepare('SELECT count(*) c FROM events').get().c, 'events →', dbPath)
