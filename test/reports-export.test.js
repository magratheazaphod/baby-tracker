import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, SECRET } from './helpers.js'

let s, cookie
before(async () => {
  s = await startServer()
  cookie = await s.login('Sam')
})
after(() => s.stop())

const post = (body) => s.api('POST', '/api/events', { body, cookie })

// HOME_TZ is America/Chicago in the harness. Pick a day inside the report
// window (the daily report only looks back N days from now).
function recentLocalDay(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

test('daily report groups by HOME_TZ day, not UTC day', async () => {
  const day = recentLocalDay(5) // YYYY-MM-DD in Chicago
  const next = recentLocalDay(4)
  // 23:30 Chicago (CDT = UTC-5) is 04:30 UTC the next calendar day.
  await post({ type: 'formula', amount_ml: 100, occurred_at: `${day}T23:30:00-05:00` })
  // 00:30 Chicago the following day.
  await post({ type: 'formula', amount_ml: 50, occurred_at: `${next}T00:30:00-05:00` })
  await post({ type: 'diaper', kind: 'both', occurred_at: `${day}T23:45:00-05:00` })
  await post({ type: 'breastfeed', duration_min: 20, occurred_at: `${day}T08:00:00-05:00` })

  const r = await s.api('GET', '/api/reports/daily?days=10', { cookie })
  assert.equal(r.status, 200, r.text)
  const byDate = Object.fromEntries(r.json.days.map((d) => [d.date, d]))
  assert.ok(byDate[day], `expected a row for ${day}; got ${Object.keys(byDate)}`)
  assert.equal(byDate[day].formulaMl, 100)
  assert.equal(byDate[day].formulaCount, 1)
  assert.equal(byDate[day].pee, 1)
  assert.equal(byDate[day].poop, 1)
  assert.equal(byDate[day].breastfeedCount, 1)
  assert.equal(byDate[day].breastfeedMin, 20)
  assert.equal(byDate[next].formulaMl, 50)
})

test('daily report separates breastmilk bottles from the bottle total', async () => {
  const day = recentLocalDay(2)
  await post({ type: 'formula', amount_ml: 80, kind: 'breastmilk', occurred_at: `${day}T12:00:00-05:00` })
  await post({ type: 'formula', amount_ml: 70, kind: 'formula', occurred_at: `${day}T13:00:00-05:00` })
  await post({ type: 'pump', amount_ml: 90, occurred_at: `${day}T14:00:00-05:00` })
  const r = await s.api('GET', '/api/reports/daily?days=10', { cookie })
  const d = r.json.days.find((x) => x.date === day)
  assert.equal(d.formulaMl, 150)
  assert.equal(d.formulaCount, 2)
  assert.equal(d.breastmilkMl, 80)
  assert.equal(d.breastmilkCount, 1)
  assert.equal(d.pumpedMl, 90)
  assert.equal(d.pumpCount, 1)
})

test('growth report lists every measurement type in time order', async () => {
  await post({ type: 'weight', weight_g: 3500, occurred_at: '2026-05-10T12:00:00Z' })
  await post({ type: 'weight', weight_g: 3300, occurred_at: '2026-05-03T12:00:00Z' })
  await post({ type: 'height', height_cm: 50, occurred_at: '2026-05-03T12:00:00Z' })
  await post({ type: 'head', head_cm: 35, occurred_at: '2026-05-03T12:00:00Z' })
  const r = await s.api('GET', '/api/reports/growth', { cookie })
  assert.equal(r.status, 200)
  assert.deepEqual(
    r.json.weights.map((w) => w.weight_g),
    [3300, 3500]
  )
  assert.equal(r.json.heights[0].height_cm, 50)
  assert.equal(r.json.heads[0].head_cm, 35)
})

test('sleep feeds returns feed events with awake_after only', async () => {
  await post({ type: 'breastfeed', duration_min: 5, awake_after: true })
  const r = await s.api('GET', '/api/sleep/feeds?days=1', { cookie })
  assert.equal(r.status, 200)
  assert.ok(r.json.length >= 1)
  for (const e of r.json) {
    assert.ok(['breastfeed', 'formula'].includes(e.type))
    assert.deepEqual(Object.keys(e).sort(), ['awake_after', 'duration_min', 'id', 'occurred_at', 'type'])
  }
})

test('export: anonymous 401, wrong bearer 401, cookie and bearer both stream a tarball', async () => {
  assert.equal((await s.api('GET', '/api/export')).status, 401)
  assert.equal((await s.api('GET', '/api/export', { headers: { authorization: 'Bearer wrong' } })).status, 401)

  for (const opts of [{ cookie }, { headers: { authorization: `Bearer ${SECRET}` } }]) {
    const r = await s.api('GET', '/api/export', opts)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'application/gzip')
    assert.match(r.headers.get('content-disposition'), /baby-tracker-\d{4}-\d{2}-\d{2}\.tar\.gz/)
    assert.equal(r.buf[0], 0x1f, 'gzip magic')
    assert.equal(r.buf[1], 0x8b)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-export-'))
    const file = path.join(tmp, 'x.tar.gz')
    fs.writeFileSync(file, r.buf)
    const listing = execFileSync('tar', ['tzf', file]).toString()
    assert.match(listing, /export-db\.sqlite/)
    assert.match(listing, /photos/)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('push subscribe validates and upserts', async () => {
  assert.equal((await s.api('POST', '/api/push/subscribe', { cookie, body: {} })).status, 400)
  const sub = { endpoint: 'https://push.example.invalid/abc', keys: { p256dh: 'x', auth: 'y' } }
  assert.deepEqual((await s.api('POST', '/api/push/subscribe', { cookie, body: sub })).json, { ok: true })
  assert.deepEqual((await s.api('POST', '/api/push/subscribe', { cookie, body: sub })).json, { ok: true })
})
