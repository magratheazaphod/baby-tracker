import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer } from './helpers.js'

let s, cookie
before(async () => {
  s = await startServer()
  cookie = await s.login('Alex')
})
after(() => s.stop())

const post = (body) => s.api('POST', '/api/events', { body, cookie })

// One valid and one invalid body per type. Mirrors TYPES / validateEvent in
// server/index.js; a new event type should add a row here.
const CASES = {
  breastfeed: { ok: { duration_min: 12 }, bad: { duration_min: -1 } },
  formula: { ok: { amount_ml: 90, kind: 'breastmilk' }, bad: { amount_ml: 90, kind: 'juice' } },
  pump: { ok: { amount_ml: 60 }, bad: {} },
  diaper: { ok: { kind: 'both' }, bad: { kind: 'wet' } },
  weight: { ok: { weight_g: 4200 }, bad: { weight_g: '4200' } },
  height: { ok: { height_cm: 55.5 }, bad: { height_cm: 0 } },
  head: { ok: { head_cm: 38 }, bad: {} },
  milestone: { ok: { notes: 'First smile', kind: 'cdc:2mo-smiles' }, bad: { notes: 'x', kind: 'not-cdc' } },
  vaccination: { ok: { vaccine: 'dtap', dose_num: 1 }, bad: { vaccine: 'dtap', dose_num: 11 } },
}

for (const [type, { ok, bad }] of Object.entries(CASES)) {
  test(`${type}: valid body is stored with its fields`, async () => {
    const r = await post({ type, ...ok })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.type, type)
    assert.equal(r.json.created_by, 'Alex')
    for (const [k, v] of Object.entries(ok)) assert.equal(r.json[k], v)
  })
  test(`${type}: invalid body is rejected with 400`, async () => {
    const r = await post({ type, ...bad })
    assert.equal(r.status, 400)
    assert.ok(r.json.error)
  })
}

test('unknown type, bad timestamp, and photo-via-events are rejected', async () => {
  assert.equal((await post({ type: 'nap' })).status, 400)
  assert.equal((await post({ type: 'diaper', kind: 'pee', occurred_at: 'yesterday-ish' })).status, 400)
  const r = await post({ type: 'photo' })
  assert.equal(r.status, 400)
  assert.match(r.json.error, /\/api\/photos/)
})

test('milestone needs a description; vaccination needs a code or notes', async () => {
  assert.equal((await post({ type: 'milestone', notes: '   ' })).status, 400)
  assert.equal((await post({ type: 'vaccination' })).status, 400)
  assert.equal((await post({ type: 'vaccination', notes: 'Flu shot at the pharmacy' })).status, 200)
  assert.equal((await post({ type: 'vaccination', vaccine: 'DTaP' })).status, 400, 'codes are lower-case')
})

test('fields that belong to another type are dropped, not stored', async () => {
  const r = await post({ type: 'diaper', kind: 'pee', amount_ml: 999, weight_g: 5 })
  assert.equal(r.status, 200)
  assert.equal(r.json.amount_ml, null)
  assert.equal(r.json.weight_g, null)
})

test('bottle kind defaults to formula', async () => {
  const r = await post({ type: 'formula', amount_ml: 120 })
  assert.equal(r.json.kind, 'formula')
})

test('create, edit, delete round-trip', async () => {
  const created = await post({ type: 'breastfeed', duration_min: 10, occurred_at: '2026-07-01T10:00:00Z' })
  const id = created.json.id
  assert.equal(created.json.occurred_at, '2026-07-01T10:00:00.000Z')
  assert.equal(created.json.awake_after, 0)

  const edited = await s.api('PATCH', `/api/events/${id}`, {
    cookie,
    body: { duration_min: 15, awake_after: true, notes: 'fussy', occurred_at: '2026-07-01T11:00:00Z' },
  })
  assert.equal(edited.status, 200, edited.text)
  assert.equal(edited.json.duration_min, 15)
  assert.equal(edited.json.awake_after, 1)
  assert.equal(edited.json.notes, 'fussy')
  assert.equal(edited.json.occurred_at, '2026-07-01T11:00:00.000Z')

  const badEdit = await s.api('PATCH', `/api/events/${id}`, { cookie, body: { duration_min: -3 } })
  assert.equal(badEdit.status, 400)
  const sneaky = await s.api('PATCH', `/api/events/${id}`, { cookie, body: { type: 'diaper', created_by: 'Sam' } })
  assert.equal(sneaky.json.type, 'breastfeed', 'type is not editable')
  assert.equal(sneaky.json.created_by, 'Alex', 'author is not editable')

  const listed = await s.api('GET', '/api/events?type=breastfeed', { cookie })
  assert.ok(listed.json.some((e) => e.id === id))

  const del = await s.api('DELETE', `/api/events/${id}`, { cookie })
  assert.deepEqual(del.json, { ok: true })
  assert.equal((await s.api('DELETE', `/api/events/${id}`, { cookie })).status, 404)
  assert.equal((await s.api('PATCH', `/api/events/${id}`, { cookie, body: {} })).status, 404)
})

test('event listing: type filter validated, before + limit honoured, newest first', async () => {
  assert.equal((await s.api('GET', '/api/events?type=nap', { cookie })).status, 400)
  await post({ type: 'diaper', kind: 'pee', occurred_at: '2026-06-01T00:00:00Z' })
  await post({ type: 'diaper', kind: 'pee', occurred_at: '2026-06-02T00:00:00Z' })
  await post({ type: 'diaper', kind: 'pee', occurred_at: '2026-06-03T00:00:00Z' })
  const r = await s.api('GET', '/api/events?type=diaper&before=2026-06-02T12:00:00Z&limit=1', { cookie })
  assert.equal(r.json.length, 1)
  assert.equal(r.json[0].occurred_at, '2026-06-02T00:00:00.000Z')
})

test('latest-per-type summary', async () => {
  const r = await s.api('GET', '/api/events/latest', { cookie })
  assert.equal(r.status, 200)
  const diaper = r.json.find((x) => x.type === 'diaper' && x.kind === 'pee')
  assert.ok(diaper?.occurred_at)
})

test('auto milestones: doubled birth weight', async () => {
  await post({ type: 'weight', weight_g: 3000, occurred_at: '2026-05-02T12:00:00Z' })
  await post({ type: 'weight', weight_g: 6100, occurred_at: '2026-08-02T12:00:00Z' })
  const r = await s.api('GET', '/api/milestones/auto', { cookie })
  assert.ok(r.json.some((m) => /doubled/.test(m.label)), JSON.stringify(r.json))
})
