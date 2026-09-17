// Exercises the feed-nudge decision in server/push.js in-process against a
// throwaway DATA_DIR. There are no push subscriptions, so sendToAll sends
// nothing and no network is touched; the observable outcome is the
// last_nudge_at stamp in the meta table.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tempDataDir, baseEnv } from './helpers.js'

let dataDir, push, dbm
before(async () => {
  dataDir = tempDataDir()
  Object.assign(process.env, baseEnv(dataDir), { NUDGE_HOURS: '6', RENUDGE_MINUTES: '60' })
  dbm = await import('../server/db.js')
  push = await import('../server/push.js')
})
after(() => {
  dbm.db.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const H = 3600 * 1000
function insert(type, ageMs, now, extra = {}) {
  dbm.db
    .prepare(`INSERT INTO events (type, occurred_at, created_by, kind, duration_min) VALUES (?, ?, 'Alex', ?, ?)`)
    .run(type, new Date(now - ageMs).toISOString(), extra.kind ?? null, extra.duration_min ?? null)
}
function reset() {
  dbm.db.prepare('DELETE FROM events').run()
  dbm.db.prepare('DELETE FROM meta').run()
}

test('vapid keys were generated into DATA_DIR, not the repo', () => {
  assert.ok(fs.existsSync(`${dataDir}/vapid.json`))
  assert.ok(push.vapidKeys.publicKey)
})

test('no tracked events: no nudge', async () => {
  reset()
  const now = new Date()
  insert('weight', 10 * H, now) // weights do not count as signs of life
  await push.checkNudge(now)
  assert.equal(dbm.getMeta('last_nudge_at'), null)
})

test('recent feed: no nudge', async () => {
  reset()
  const now = new Date()
  insert('breastfeed', 5 * H, now, { duration_min: 10 })
  await push.checkNudge(now)
  assert.equal(dbm.getMeta('last_nudge_at'), null)
})

test('quiet for longer than NUDGE_HOURS: nudge, then re-nudge only after RENUDGE_MINUTES', async () => {
  reset()
  const now = new Date()
  insert('diaper', 7 * H, now, { kind: 'pee' })
  await push.checkNudge(now)
  assert.equal(dbm.getMeta('last_nudge_at'), now.toISOString())

  const soon = new Date(now.getTime() + 30 * 60 * 1000)
  await push.checkNudge(soon)
  assert.equal(dbm.getMeta('last_nudge_at'), now.toISOString(), 'suppressed inside the re-nudge window')

  const later = new Date(now.getTime() + 61 * 60 * 1000)
  await push.checkNudge(later)
  assert.equal(dbm.getMeta('last_nudge_at'), later.toISOString())
})

test('a new feed after a nudge resets the clock', async () => {
  reset()
  const now = new Date()
  insert('formula', 8 * H, now, { kind: 'formula' })
  await push.checkNudge(now)
  assert.ok(dbm.getMeta('last_nudge_at'))
  insert('formula', 1 * H, now, { kind: 'formula' })
  const later = new Date(now.getTime() + 2 * H)
  await push.checkNudge(later)
  assert.equal(dbm.getMeta('last_nudge_at'), now.toISOString(), 'no second nudge')
})

test('photo nudges are disabled by config in this harness and stay silent', async () => {
  reset()
  await push.checkPhotoNudge(new Date())
  assert.equal(dbm.getMeta('photo_nudge_stale_sent'), null)
})
