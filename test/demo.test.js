// DEMO_MODE=1: a public-secret, read-only instance. Login and reads work;
// every write, upload, push and the export download are refused with 403.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, SECRET } from './helpers.js'

let s, cookie
before(async () => {
  s = await startServer({ DEMO_MODE: '1' })
  cookie = await s.login()
})
after(() => s.stop())

test('pre-auth /api/config is still exactly {user:null}', async () => {
  const r = await s.api('GET', '/api/config')
  assert.deepEqual(r.json, { user: null })
})

test('post-auth /api/config advertises demo mode', async () => {
  const r = await s.api('GET', '/api/config', { cookie })
  assert.equal(r.status, 200)
  assert.equal(r.json.demo, true)
})

test('reads still work', async () => {
  for (const url of ['/api/events', '/api/reports/daily?days=3', '/api/reports/growth', '/api/sleep/feeds']) {
    const r = await s.api('GET', url, { cookie })
    assert.equal(r.status, 200, `${url}: ${r.text}`)
  }
})

const BLOCKED = [
  ['POST', '/api/events', { type: 'diaper', kind: 'pee' }],
  ['PATCH', '/api/events/1', { kind: 'poop' }],
  ['DELETE', '/api/events/1'],
  ['POST', '/api/photos', {}],
  ['POST', '/api/events/1/photo', {}],
  ['POST', '/api/events/1/reanalyze', {}],
  ['DELETE', '/api/events/1/photo'],
  ['POST', '/api/push/subscribe', { endpoint: 'https://push.invalid/x', keys: { p256dh: 'a', auth: 'b' } }],
  ['POST', '/api/push/test', {}],
  ['POST', '/api/voice/audio', {}],
]
for (const [method, url, body] of BLOCKED) {
  test(`${method} ${url} is 403 Read-only demo`, async () => {
    const r = await s.api(method, url, { cookie, body })
    assert.equal(r.status, 403, r.text)
    assert.equal(r.json.error, 'Read-only demo')
  })
}

test('GET /api/export is 403 even with a valid bearer or cookie', async () => {
  const bearer = await s.api('GET', '/api/export', { headers: { authorization: `Bearer ${SECRET}` } })
  assert.equal(bearer.status, 403)
  const cook = await s.api('GET', '/api/export', { cookie })
  assert.equal(cook.status, 403)
})

test('/api/health and login are not blocked', async () => {
  assert.equal((await s.api('GET', '/api/health')).status, 200)
  const r = await s.api('POST', '/api/login', { body: { secret: SECRET, user: 'Alex' } })
  assert.equal(r.status, 200)
})
