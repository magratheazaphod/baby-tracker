// Seeds a throwaway SQLite database with entirely synthetic demo data for
// README screenshots. Thin CLI over server/demo-seed.js, which is also what
// a DEMO_MODE instance runs at boot. Nothing here touches the real DATA_DIR
// or .env.
//
//   SEED_DIR=/tmp/bt-demo SEED_BIRTH=2026-05-02 SEED_NOW=2026-07-23T15:40:00-07:00 \
//     node scripts/seed-demo-data.js
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.SEED_DIR
if (!DIR) {
  console.error('SEED_DIR is required - point it at a throwaway directory, e.g.\n' +
    '  SEED_DIR=/tmp/bt-demo SEED_BIRTH=2026-05-02 SEED_NOW=2026-07-23T15:40:00-07:00 \\\n' +
    '    node scripts/seed-demo-data.js')
  process.exit(1)
}
if (!process.env.SEED_BIRTH || !process.env.SEED_NOW) {
  console.error('SEED_BIRTH (YYYY-MM-DD) and SEED_NOW (ISO datetime) are required')
  process.exit(1)
}
// This script deletes the database it seeds, so refuse to aim it at a real one.
const resolved = path.resolve(DIR)
for (const real of [path.resolve(process.env.DATA_DIR || 'data'), '/data']) {
  if (resolved === real) {
    console.error(`refusing to seed ${resolved} - that is a live data directory`)
    process.exit(1)
  }
}
fs.mkdirSync(path.join(DIR, 'photos'), { recursive: true })
const dbPath = path.join(DIR, 'baby.db')
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) fs.rmSync(f, { force: true })

// server/db.js opens DATA_DIR at import and applies the real schema and
// migrations, so the seeded rows always match what the server expects.
// The guard above already ran against the caller's DATA_DIR, so it is safe to
// point the server module at the scratch directory now.
process.env.DATA_DIR = resolved
const { db, PHOTOS_DIR } = await import('../server/db.js')
const { seedDemo } = await import('../server/demo-seed.js')

const n = await seedDemo({ db, photosDir: PHOTOS_DIR, birth: process.env.SEED_BIRTH, now: process.env.SEED_NOW })
db.close()
console.log('seeded', n, 'events ->', dbPath)
