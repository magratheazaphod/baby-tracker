// DEMO_MODE instances fill themselves with synthetic data at boot, so a public
// demo never needs a real data directory. Covers: first boot seeds every
// event family incl. photos on disk; a second boot keeps the data; DEMO_RESEED
// wipes and regenerates to the same count; DEMO_MODE off never seeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { startServer, tempDataDir, baseEnv, ROOT } from './helpers.js'

// startServer() always makes a fresh DATA_DIR; the reboot cases need to reuse
// one, so this boots the same way against a given directory.
async function bootOn(dataDir, extraEnv) {
  const env = { ...baseEnv(dataDir), PORT: '0', ...extraEnv }
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d
      const m = out.match(/listening on :(\d+)/)
      if (m) resolve(Number(m[1]))
    })
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${err}`)))
    setTimeout(() => reject(new Error('no start: ' + err)), 20000).unref()
  })
  const stop = () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM') })
  // Give the banner a moment to flush.
  await new Promise((r) => setTimeout(r, 200))
  return { port, stop, out: () => out }
}

// The listing endpoint caps at 500 rows, so the dataset is read straight
// from SQLite once the server has stopped (WAL is checkpointed on close).
function counts(dir) {
  const db = new Database(path.join(dir, 'baby.db'), { readonly: true })
  const events = db.prepare('SELECT type, kind, vaccine, dose_num, photo_path FROM events').all()
  db.close()
  const by = {}
  for (const e of events) by[e.type] = (by[e.type] || 0) + 1
  return { total: events.length, by, events }
}

async function login(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: 'test-secret', user: 'Alex' }),
  })
  return r.headers.get('set-cookie').split(';')[0]
}

test('DEMO_MODE seeds a full synthetic dataset on first boot, keeps it, and re-seeds on DEMO_RESEED', async () => {
  const dir = tempDataDir()
  try {
    const a = await bootOn(dir, { DEMO_MODE: '1' })
    const cookie = await login(a.port)
    const listed = await fetch(`http://127.0.0.1:${a.port}/api/events?limit=50`, { headers: { cookie } }).then((r) => r.json())
    assert.ok(Array.isArray(listed) && listed.length === 50, 'seeded data is readable through the API')
    assert.match(a.out(), /seed\s+generated \d+ synthetic events/)
    // Reads work and writes are still blocked in the seeded instance.
    const blocked = await fetch(`http://127.0.0.1:${a.port}/api/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ type: 'diaper', kind: 'pee' }),
    })
    assert.equal(blocked.status, 403)
    await a.stop()
    const first = counts(dir)
    assert.ok(first.total > 500, `expected a real dataset, got ${first.total}`)
    for (const t of ['breastfeed', 'diaper', 'weight', 'height', 'head', 'milestone', 'vaccination', 'photo']) {
      assert.ok(first.by[t] > 0, `no ${t} events`)
    }
    assert.ok(first.events.some((e) => e.type === 'milestone' && String(e.kind || '').startsWith('cdc:')), 'no CDC milestones')
    assert.ok(first.events.some((e) => e.type === 'vaccination' && e.vaccine === 'hepb' && e.dose_num === 1), 'no HepB dose 1')
    const photos = first.events.filter((e) => e.type === 'photo')
    assert.equal(photos.length, 8)
    for (const p of photos) assert.ok(fs.existsSync(path.join(dir, 'photos', p.photo_path)), `missing ${p.photo_path}`)

    const b = await bootOn(dir, { DEMO_MODE: '1' })
    assert.match(b.out(), /seed\s+existing data kept/)
    await b.stop()
    assert.equal(counts(dir).total, first.total, 'second boot must not duplicate')

    const c = await bootOn(dir, { DEMO_MODE: '1', DEMO_RESEED: '1' })
    assert.match(c.out(), /seed\s+generated/)
    await c.stop()
    assert.equal(counts(dir).total, first.total, 'reseed is deterministic for the same day')
    const onDisk = fs.readdirSync(path.join(dir, 'photos')).filter((f) => f.endsWith('.jpg'))
    assert.equal(onDisk.length, 8, 'old placeholder photos must be wiped before re-seeding')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('DEMO_MODE off never seeds, even with DEMO_RESEED set', async () => {
  const s = await startServer({ DEMO_RESEED: '1' })
  try {
    const cookie = await s.login()
    const r = await s.api('GET', '/api/events', { cookie })
    const list = Array.isArray(r.json) ? r.json : r.json.events
    assert.equal(list.length, 0)
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'photos')).filter((f) => f.endsWith('.jpg')).length, 0)
  } finally {
    await s.stop()
  }
})

test('DEMO_MODE without BIRTH_DATE refuses to start', async () => {
  const dir = tempDataDir()
  const env = { ...baseEnv(dir), PORT: '0', DEMO_MODE: '1' }
  delete env.BIRTH_DATE
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  const code = await new Promise((r) => child.on('exit', r))
  fs.rmSync(dir, { recursive: true, force: true })
  assert.equal(code, 1)
  assert.match(err, /BIRTH_DATE/)
})
