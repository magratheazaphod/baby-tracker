import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, SECRET, USERS, BABY } from './helpers.js'

let s
before(async () => {
  s = await startServer()
})
after(() => s.stop())

test('health needs no login and reveals nothing', async () => {
  const r = await s.api('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true })
})

test('login rejects a wrong secret', async () => {
  const r = await s.api('POST', '/api/login', { body: { secret: 'nope' } })
  assert.equal(r.status, 401)
  assert.equal(r.headers.get('set-cookie'), null)
})

test('login step one: secret alone reveals the name list, no cookie yet', async () => {
  const r = await s.api('POST', '/api/login', { body: { secret: SECRET } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { users: USERS })
  assert.equal(r.headers.get('set-cookie'), null)
})

test('login step two: unknown user is rejected', async () => {
  const r = await s.api('POST', '/api/login', { body: { secret: SECRET, user: 'Nobody' } })
  assert.equal(r.status, 400)
})

test('login step two: known user gets an HttpOnly cookie', async () => {
  const r = await s.api('POST', '/api/login', { body: { secret: SECRET, user: 'Sam' } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { user: 'Sam' })
  const cookie = r.headers.get('set-cookie')
  assert.match(cookie, /^bt_auth=/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
})

test('/api/config is {user:null} before login and personal only after', async () => {
  const anon = await s.api('GET', '/api/config')
  assert.equal(anon.status, 200)
  assert.deepEqual(anon.json, { user: null })

  const cookie = await s.login('Alex')
  const r = await s.api('GET', '/api/config', { cookie })
  assert.equal(r.json.user, 'Alex')
  assert.deepEqual(r.json.users, USERS)
  assert.equal(r.json.babyName, BABY)
  assert.equal(r.json.birthDate, '2026-05-02')
  assert.equal(r.json.babySex, 'girl')
  assert.equal(r.json.voiceInput, false, 'mic hidden when no transcription key')
  assert.ok(r.json.vapidPublicKey)
})

test('manifest is generic without a cookie, named with one', async () => {
  const anon = await s.api('GET', '/manifest.webmanifest')
  assert.equal(anon.json.name, 'Baby Tracker')
  const cookie = await s.login()
  const r = await s.api('GET', '/manifest.webmanifest', { cookie })
  assert.equal(r.json.name, BABY)
})

test('a forged cookie is not accepted', async () => {
  const forged = 'bt_auth=' + Buffer.from('Alex').toString('base64url') + '.notamac'
  const r = await s.api('GET', '/api/events', { cookie: forged })
  assert.equal(r.status, 401)
})

test('robots.txt disallows everything', async () => {
  const r = await s.api('GET', '/robots.txt')
  assert.match(r.text, /Disallow: \//)
})

const PROTECTED = [
  ['GET', '/api/events'],
  ['GET', '/api/events/latest'],
  ['GET', '/api/milestones/auto'],
  ['POST', '/api/events'],
  ['PATCH', '/api/events/1'],
  ['DELETE', '/api/events/1'],
  ['POST', '/api/photos'],
  ['POST', '/api/events/1/photo'],
  ['POST', '/api/events/1/reanalyze'],
  ['DELETE', '/api/events/1/photo'],
  ['GET', '/photos/thumb/x.jpg'],
  ['GET', '/photos/x.jpg'],
  ['GET', '/api/reports/growth'],
  ['GET', '/api/reports/daily'],
  ['GET', '/api/export'],
  ['GET', '/api/sleep/feeds'],
  ['POST', '/api/push/subscribe'],
  ['POST', '/api/push/test'],
  ['POST', '/api/voice/audio'],
]

for (const [method, url] of PROTECTED) {
  test(`${method} ${url} is 401 without a cookie`, async () => {
    const r = await s.api(method, url, method === 'GET' ? {} : { body: {} })
    assert.equal(r.status, 401)
  })
}

test('every /api route the server registers is covered by the auth-boundary list', async () => {
  const fs = await import('node:fs')
  const { ROOT } = await import('./helpers.js')
  const src = fs.readFileSync(`${ROOT}/server/index.js`, 'utf8')
  const registered = [...src.matchAll(/app\.(get|post|patch|delete)\('(\/api\/[^']+)'/g)].map((m) => m[2])
  const known = new Set([...PROTECTED.map(([, u]) => u.replace(/\/1\b/, '/:id')), '/api/health', '/api/login', '/api/config', '/api/voice'])
  const missing = registered.filter((u) => !known.has(u))
  assert.deepEqual(missing, [], 'add new /api routes to PROTECTED or the public allowlist')
})
