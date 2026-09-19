// POST /api/push/test fans a notification out to every stored subscription and
// reports how many were delivered. No real push endpoint is ever involved: the
// only subscription stored here points at a reserved `.invalid` host with junk
// keys, so web-push fails locally (bad key material / unresolvable host) and
// the route reports zero sent. If web-push ever started resolving that host
// the request would still fail fast, because `.invalid` never resolves.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from './helpers.js'

let s, cookie
before(async () => {
  s = await startServer()
  cookie = await s.login()
})
after(() => s.stop())

test('requires auth', async () => {
  assert.equal((await s.api('POST', '/api/push/test', { body: {} })).status, 401)
})

test('with no subscriptions it reports zero sent', async () => {
  const r = await s.api('POST', '/api/push/test', { cookie, body: {} })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json, { sent: 0 })
})

test('with one undeliverable subscription it still answers, reporting zero sent', { timeout: 15000 }, async () => {
  const sub = { endpoint: 'https://push.example.invalid/abc', keys: { p256dh: 'x', auth: 'y' } }
  assert.equal((await s.api('POST', '/api/push/subscribe', { cookie, body: sub })).status, 200)
  const started = Date.now()
  const r = await s.api('POST', '/api/push/test', { cookie, body: {} })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json, { sent: 0 })
  assert.ok(Date.now() - started < 10000, 'failure is reported promptly, not after a long network timeout')
  // A non-404/410 failure must not prune the subscription: transient errors
  // are not proof the device is gone.
  const again = await s.api('POST', '/api/push/test', { cookie, body: {} })
  assert.deepEqual(again.json, { sent: 0 })
})
