// Behaviour of the photo upload surface: resize on save, thumbnail generation,
// attach/replace/remove on non-photo events, and file cleanup. Fixtures are
// generated with sharp at run time so no binary lives in the repo.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { startServer } from './helpers.js'

let s, cookie
before(async () => {
  s = await startServer()
  cookie = await s.login()
})
after(() => s.stop())

const photosDir = () => path.join(s.dataDir, 'photos')
const thumbsDir = () => path.join(photosDir(), 'thumbs')

function png(size) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .png()
    .toBuffer()
}

// Multipart upload through the real fetch FormData path; the JSON helper in
// helpers.js deliberately does not cover this.
async function upload(url, { file, filename = 'shot.png', type = 'image/png', fields = {}, auth = true } = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('photo', new Blob([file], { type }), filename)
  const res = await fetch(s.base + url, { method: 'POST', headers: auth ? { cookie } : {}, body: form })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

test('POST /api/photos stores a resized jpeg and creates a photo event', async () => {
  const r = await upload('/api/photos', { file: await png(2000), fields: { notes: 'first smile' } })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.type, 'photo')
  assert.equal(r.json.notes, 'first smile')
  assert.match(r.json.photo_path, /^\d+-[0-9a-f]{8}\.jpg$/)
  const stored = path.join(photosDir(), r.json.photo_path)
  assert.ok(fs.existsSync(stored), 'photo file written under DATA_DIR/photos')
  const meta = await sharp(stored).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.ok(meta.width <= 1600 && meta.height <= 1600, `resized to fit 1600, got ${meta.width}x${meta.height}`)
  assert.equal(meta.width, 1600, 'a 2000px square lands exactly on the 1600 bound')
})

test('small images are not enlarged', async () => {
  const r = await upload('/api/photos', { file: await png(300) })
  assert.equal(r.status, 200, r.text)
  const meta = await sharp(path.join(photosDir(), r.json.photo_path)).metadata()
  assert.equal(meta.width, 300)
})

test('POST /api/photos without a file or with a non-image is 400', async () => {
  assert.equal((await upload('/api/photos', {})).status, 400)
  const r = await upload('/api/photos', { file: Buffer.from('definitely not an image'), filename: 'x.png' })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'Could not process image')
})

test('oversize uploads are rejected by the multer limit', async () => {
  // 25 MiB is the configured cap; one byte over must not be accepted. There is
  // no multer error handler, so Express answers with its default 500 rather
  // than a tidy 400; the contract under test is only "not 200, nothing saved".
  const before = fs.readdirSync(photosDir()).length
  const big = Buffer.alloc(25 * 1024 * 1024 + 1, 1)
  let status
  try {
    status = (await upload('/api/photos', { file: big })).status
  } catch {
    status = 'connection-reset'
  }
  assert.notEqual(status, 200)
  assert.equal(fs.readdirSync(photosDir()).length, before, 'no file written')
})

test('thumbnails: generated on demand, cached, 404 for unknown, 401 anonymous, 400 bad name', async () => {
  const r = await upload('/api/photos', { file: await png(900) })
  const name = r.json.photo_path
  const t1 = await s.api('GET', `/photos/thumb/${name}`, { cookie })
  assert.equal(t1.status, 200, t1.text)
  assert.match(t1.headers.get('content-type'), /^image\//)
  const thumbPath = path.join(thumbsDir(), name)
  assert.ok(fs.existsSync(thumbPath), 'thumbnail cached on disk')
  const meta = await sharp(thumbPath).metadata()
  assert.ok(meta.width <= 320 && meta.height <= 320, `thumb fits 320, got ${meta.width}x${meta.height}`)
  const t2 = await s.api('GET', `/photos/thumb/${name}`, { cookie })
  assert.equal(t2.status, 200)
  assert.equal(t2.buf.length, t1.buf.length, 'second request serves the cached file')

  assert.equal((await s.api('GET', '/photos/thumb/1700000000000-deadbeef.jpg', { cookie })).status, 404)
  assert.equal((await s.api('GET', `/photos/thumb/${name}`)).status, 401)
  assert.equal((await s.api('GET', '/photos/thumb/..%2Fbaby.db', { cookie })).status, 400)
  assert.equal((await s.api('GET', '/photos/thumb/evil.jpg', { cookie })).status, 400)
})

test('the original photo is served behind auth, never anonymously', async () => {
  const r = await upload('/api/photos', { file: await png(200) })
  assert.equal((await s.api('GET', `/photos/${r.json.photo_path}`)).status, 401)
  const ok = await s.api('GET', `/photos/${r.json.photo_path}`, { cookie })
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('content-type'), /^image\/jpeg/)
})

test('attach, replace and remove a photo on a diaper event, cleaning files each time', async () => {
  const ev = await s.api('POST', '/api/events', { cookie, body: { type: 'diaper', kind: 'both' } })
  assert.equal(ev.status, 200, ev.text)
  const id = ev.json.id

  const a = await upload(`/api/events/${id}/photo`, { file: await png(400) })
  assert.equal(a.status, 200, a.text)
  assert.equal(a.json.id, id)
  const first = a.json.photo_path
  assert.ok(fs.existsSync(path.join(photosDir(), first)))
  // Warm the thumbnail so removal has something to clean up.
  assert.equal((await s.api('GET', `/photos/thumb/${first}`, { cookie })).status, 200)

  const b = await upload(`/api/events/${id}/photo`, { file: await png(400) })
  assert.equal(b.status, 200, b.text)
  const second = b.json.photo_path
  assert.notEqual(second, first)
  await settle()
  assert.ok(!fs.existsSync(path.join(photosDir(), first)), 'replaced photo removed')
  assert.ok(!fs.existsSync(path.join(thumbsDir(), first)), 'replaced thumbnail removed')
  assert.ok(fs.existsSync(path.join(photosDir(), second)))

  const d = await s.api('DELETE', `/api/events/${id}/photo`, { cookie })
  assert.equal(d.status, 200, d.text)
  assert.equal(d.json.photo_path, null)
  assert.equal(d.json.type, 'diaper', 'event itself survives')
  await settle()
  assert.ok(!fs.existsSync(path.join(photosDir(), second)), 'removed photo file gone')
})

test('attach guards: 404 unknown event, 400 photo event, 400 no file', async () => {
  assert.equal((await upload('/api/events/999999/photo', { file: await png(100) })).status, 404)
  const p = await upload('/api/photos', { file: await png(100) })
  const r = await upload(`/api/events/${p.json.id}/photo`, { file: await png(100) })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'Photo events are managed via /api/photos')
  const ev = await s.api('POST', '/api/events', { cookie, body: { type: 'diaper', kind: 'pee' } })
  assert.equal((await upload(`/api/events/${ev.json.id}/photo`, {})).status, 400)
  const del = await s.api('DELETE', `/api/events/${p.json.id}/photo`, { cookie })
  assert.equal(del.status, 400, 'photo events are deleted whole, not stripped')
})

test('deleting an event removes its photo and thumbnail files', async () => {
  const p = await upload('/api/photos', { file: await png(500) })
  const name = p.json.photo_path
  assert.equal((await s.api('GET', `/photos/thumb/${name}`, { cookie })).status, 200)
  assert.deepEqual((await s.api('DELETE', `/api/events/${p.json.id}`, { cookie })).json, { ok: true })
  await settle()
  assert.ok(!fs.existsSync(path.join(photosDir(), name)))
  assert.ok(!fs.existsSync(path.join(thumbsDir(), name)))
  assert.equal((await s.api('GET', `/photos/thumb/${name}`, { cookie })).status, 404)
})

test('reanalyze is 400 for a diaper without a photo and 404 for unknown', async () => {
  const ev = await s.api('POST', '/api/events', { cookie, body: { type: 'diaper', kind: 'poop' } })
  const r = await s.api('POST', `/api/events/${ev.json.id}/reanalyze`, { cookie, body: {} })
  assert.equal(r.status, 400)
  assert.equal((await s.api('POST', '/api/events/999999/reanalyze', { cookie, body: {} })).status, 404)
})

// removePhotoFile unlinks asynchronously with fire-and-forget callbacks, so
// give the event loop a beat before asserting on the filesystem.
const settle = () => new Promise((r) => setTimeout(r, 100))
