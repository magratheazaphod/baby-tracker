import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, SECRET } from './helpers.js'

let s
before(async () => {
  s = await startServer() // VOICE_TOKEN, ANTHROPIC_API_KEY, TRANSCRIBE_API_KEY all unset
})
after(() => s.stop())

test('POST /api/voice is off when VOICE_TOKEN is unset, even with a cookie or the app secret', async () => {
  const cookie = await s.login('Alex')
  for (const opts of [{}, { cookie }, { headers: { authorization: `Bearer ${SECRET}` } }]) {
    const r = await s.api('POST', '/api/voice', { ...opts, body: { text: 'log a wet diaper', user: 'Alex' } })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.deepEqual(r.json.saved, [])
    assert.match(r.json.speech, /isn't set up/)
  }
  const events = await s.api('GET', '/api/events', { cookie })
  assert.deepEqual(events.json, [], 'nothing was logged')
})

test('POST /api/voice/audio with no clip answers a speakable failure, not HTML', async () => {
  const cookie = await s.login('Alex')
  const r = await s.api('POST', '/api/voice/audio', { cookie, body: {} })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.equal(typeof r.json.speech, 'string')
})

test('with VOICE_TOKEN set: bad bearer is 401 and an unknown parent is 400, both before any parsing', async () => {
  const v = await startServer({ VOICE_TOKEN: 'shortcut-token' })
  try {
    const bad = await v.api('POST', '/api/voice', { headers: { authorization: 'Bearer wrong' }, body: { text: 'x', user: 'Alex' } })
    assert.equal(bad.status, 401)
    assert.equal(typeof bad.json.speech, 'string')
    const secret = await v.api('POST', '/api/voice', { headers: { authorization: `Bearer ${SECRET}` }, body: { text: 'x', user: 'Alex' } })
    assert.equal(secret.status, 401, 'APP_SECRET must not work as the voice token')
    const who = await v.api('POST', '/api/voice', { headers: { authorization: 'Bearer shortcut-token' }, body: { text: 'x', user: 'Nobody' } })
    assert.equal(who.status, 400)
  } finally {
    v.stop()
  }
})
