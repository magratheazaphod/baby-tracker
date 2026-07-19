import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, DATA_DIR, PHOTOS_DIR } from './db.js'
import { vapidKeys, sendToAll, startNudgeTimer } from './push.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const HOME_TZ = process.env.HOME_TZ || 'America/Los_Angeles'
const APP_SECRET = process.env.APP_SECRET || 'baby'
const USER_NAMES = (process.env.USER_NAMES || 'Mom,Dad').split(',').map(s => s.trim())
const COOKIE_SECRET =
  process.env.COOKIE_SECRET ||
  crypto.createHash('sha256').update(`cookie:${APP_SECRET}`).digest('hex')
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME

if (APP_SECRET === 'baby' && IS_PROD) {
  console.warn('WARNING: APP_SECRET is the default — set a real one with `fly secrets set APP_SECRET=...`')
}

const app = express()
app.use(express.json())

// --- auth: shared secret -> long-lived signed cookie identifying the parent ---

function signUser(user) {
  const encoded = Buffer.from(user, 'utf8').toString('base64url')
  const mac = crypto.createHmac('sha256', COOKIE_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${mac}`
}

function verifyCookie(value) {
  if (!value) return null
  const [encoded, mac] = value.split('.')
  if (!encoded || !mac) return null
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(encoded).digest('base64url')
  const macBuf = Buffer.from(mac)
  const expBuf = Buffer.from(expected)
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return null
  return Buffer.from(encoded, 'base64url').toString('utf8')
}

function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function currentUser(req) {
  return verifyCookie(parseCookies(req).bt_auth)
}

function secretOk(candidate) {
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest()
  const b = crypto.createHash('sha256').update(APP_SECRET).digest()
  return crypto.timingSafeEqual(a, b)
}

// Brute-force guard on login: per-IP attempt budget per window.
const loginAttempts = new Map()
function loginRateLimit(req, res, next) {
  const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  if (loginAttempts.size > 10000) loginAttempts.clear()
  let rec = loginAttempts.get(ip)
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + 15 * 60 * 1000 }
  rec.count++
  loginAttempts.set(ip, rec)
  if (rec.count > 20) return res.status(429).json({ error: 'Too many attempts — try again in a bit' })
  next()
}

// Two-step login so nothing personal is served before the secret is proven:
// {secret} alone validates and returns the name list; {secret, user} sets the cookie.
app.post('/api/login', loginRateLimit, (req, res) => {
  const { secret, user } = req.body || {}
  if (!secretOk(secret)) return res.status(401).json({ error: 'Wrong secret' })
  if (user === undefined) return res.json({ users: USER_NAMES })
  if (!USER_NAMES.includes(user)) return res.status(400).json({ error: 'Unknown user' })
  res.setHeader(
    'Set-Cookie',
    `bt_auth=${signUser(user)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${IS_PROD ? '; Secure' : ''}`
  )
  res.json({ user })
})

app.get('/api/config', (req, res) => {
  if (!currentUser(req)) return res.json({ user: null })
  res.json({
    users: USER_NAMES,
    user: currentUser(req),
    tz: HOME_TZ,
    babyName: process.env.BABY_NAME || 'Baby',
    birthDate: process.env.BIRTH_DATE || null,
    babySex: ['boy', 'girl'].includes(process.env.BABY_SEX) ? process.env.BABY_SEX : null,
    appName: process.env.APP_NAME || process.env.BABY_NAME || 'Baby Tracker',
    vapidPublicKey: vapidKeys.publicKey,
  })
})

function requireAuth(req, res, next) {
  const user = currentUser(req)
  if (!user) return res.status(401).json({ error: 'Not logged in' })
  req.user = user
  next()
}

// --- events ---

const TYPES = ['breastfeed', 'formula', 'diaper', 'weight', 'height', 'photo']
const DIAPER_KINDS = ['pee', 'poop', 'both']

// Returns null on success, an error message otherwise. Fields irrelevant to the
// type are rejected so a bad client can't write nonsense rows.
function validateEvent(type, body) {
  const num = (v) => v == null || (typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (!TYPES.includes(type)) return 'Unknown type'
  if (body.occurred_at && Number.isNaN(Date.parse(body.occurred_at))) return 'Bad timestamp'
  switch (type) {
    case 'breastfeed':
      return num(body.duration_min) ? null : 'Bad duration'
    case 'formula':
      return typeof body.amount_ml === 'number' && body.amount_ml > 0 ? null : 'Formula needs an amount in ml'
    case 'diaper':
      return DIAPER_KINDS.includes(body.kind) ? null : 'Diaper needs a kind: pee, poop, or both'
    case 'weight':
      return typeof body.weight_g === 'number' && body.weight_g > 0 ? null : 'Weight needs grams'
    case 'height':
      return typeof body.height_cm === 'number' && body.height_cm > 0 ? null : 'Height needs cm'
    case 'photo':
      return null
  }
}

const FIELDS_BY_TYPE = {
  breastfeed: ['duration_min', 'awake_after'],
  formula: ['amount_ml', 'awake_after'],
  diaper: ['kind'],
  weight: ['weight_g'],
  height: ['height_cm'],
  photo: [],
}

function insertEvent(type, body, user) {
  const row = {
    type,
    occurred_at: body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString(),
    created_by: user,
    notes: body.notes || null,
    duration_min: null,
    amount_ml: null,
    kind: null,
    weight_g: null,
    height_cm: null,
    photo_path: body.photo_path || null,
    awake_after: 0,
  }
  for (const f of FIELDS_BY_TYPE[type]) row[f] = body[f] ?? null
  row.awake_after = row.awake_after ? 1 : 0
  const info = db
    .prepare(
      `INSERT INTO events (type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, height_cm, photo_path, awake_after)
       VALUES (@type, @occurred_at, @created_by, @notes, @duration_min, @amount_ml, @kind, @weight_g, @height_cm, @photo_path, @awake_after)`
    )
    .run(row)
  return db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid)
}

app.get('/api/events', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const clauses = []
  const params = []
  if (req.query.before) {
    clauses.push('occurred_at < ?')
    params.push(req.query.before)
  }
  if (req.query.type && TYPES.includes(req.query.type)) {
    clauses.push('type = ?')
    params.push(req.query.type)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  res.json(db.prepare(`SELECT * FROM events ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...params, limit))
})

app.post('/api/events', requireAuth, (req, res) => {
  const { type } = req.body || {}
  const error = validateEvent(type, req.body || {})
  if (error) return res.status(400).json({ error })
  if (type === 'photo') return res.status(400).json({ error: 'Photos go through /api/photos' })
  res.json(insertEvent(type, req.body, req.user))
})

app.patch('/api/events/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const merged = { ...existing, ...req.body }
  const error = validateEvent(existing.type, merged)
  if (error) return res.status(400).json({ error })
  const editable = ['occurred_at', 'notes', ...FIELDS_BY_TYPE[existing.type]]
  for (const f of editable) {
    if (f in req.body) {
      const value =
        f === 'occurred_at' ? new Date(req.body[f]).toISOString()
        : f === 'awake_after' ? (req.body[f] ? 1 : 0)
        : req.body[f] ?? null
      db.prepare(`UPDATE events SET ${f} = ? WHERE id = ?`).run(value, existing.id)
    }
  }
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(existing.id))
})

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.photo_path) {
    fs.rm(path.join(PHOTOS_DIR, path.basename(existing.photo_path)), { force: true }, () => {})
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(existing.id)
  res.json({ ok: true })
})

// --- photos ---

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

app.post('/api/photos', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' })
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`
  try {
    await sharp(req.file.buffer)
      .rotate() // respect EXIF orientation
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(path.join(PHOTOS_DIR, name))
  } catch {
    return res.status(400).json({ error: 'Could not process image' })
  }
  const body = { occurred_at: req.body.occurred_at, notes: req.body.notes, photo_path: name }
  res.json(insertEvent('photo', body, req.user))
})

app.use('/photos', requireAuth, express.static(PHOTOS_DIR, { maxAge: '365d', immutable: true }))

// --- reports ---

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOME_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const localDay = (iso) => dayFmt.format(new Date(iso))

app.get('/api/reports/daily', requireAuth, (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365)
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString()
  const rows = db
    .prepare('SELECT * FROM events WHERE occurred_at >= ? ORDER BY occurred_at ASC')
    .all(since)

  const byDay = new Map()
  const weights = []
  const heights = []
  for (const e of rows) {
    const day = localDay(e.occurred_at)
    if (!byDay.has(day)) {
      byDay.set(day, {
        date: day,
        breastfeedCount: 0,
        breastfeedMin: 0,
        formulaCount: 0,
        formulaMl: 0,
        pee: 0,
        poop: 0,
      })
    }
    const d = byDay.get(day)
    if (e.type === 'breastfeed') {
      d.breastfeedCount++
      d.breastfeedMin += e.duration_min || 0
    } else if (e.type === 'formula') {
      d.formulaCount++
      d.formulaMl += e.amount_ml || 0
    } else if (e.type === 'diaper') {
      if (e.kind === 'pee' || e.kind === 'both') d.pee++
      if (e.kind === 'poop' || e.kind === 'both') d.poop++
    } else if (e.type === 'weight') {
      weights.push({ occurred_at: e.occurred_at, date: day, weight_g: e.weight_g })
    } else if (e.type === 'height') {
      heights.push({ occurred_at: e.occurred_at, date: day, height_cm: e.height_cm })
    }
  }
  res.json({ days: [...byDay.values()], weights, heights })
})

// --- backup export ---

// Accepts the login cookie OR the shared secret as a bearer token, so a cron
// job can pull backups without a browser session.
function exportAuth(req, res, next) {
  if (currentUser(req)) return next()
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ') && secretOk(auth.slice(7))) return next()
  res.status(401).json({ error: 'Not logged in' })
}

app.get('/api/export', exportAuth, async (req, res) => {
  const tmpDb = path.join(DATA_DIR, 'export-db.sqlite')
  try {
    await db.backup(tmpDb) // consistent point-in-time copy, safe while live
  } catch (err) {
    console.error('export backup failed:', err)
    return res.status(500).json({ error: 'Backup failed' })
  }
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="baby-tracker-${new Date().toISOString().slice(0, 10)}.tar.gz"`
  )
  const tar = spawn('tar', ['czf', '-', '-C', DATA_DIR, 'export-db.sqlite', 'photos'])
  tar.stdout.pipe(res)
  tar.on('error', (err) => {
    console.error('export tar failed:', err)
    res.destroy()
  })
  tar.on('close', () => fs.rm(tmpDb, { force: true }, () => {}))
})

// --- sleep ---

app.get('/api/sleep/feeds', requireAuth, (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90)
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString()
  res.json(
    db
      .prepare(
        `SELECT id, type, occurred_at, duration_min, awake_after FROM events
         WHERE type IN ('breastfeed','formula') AND occurred_at >= ? ORDER BY occurred_at ASC`
      )
      .all(since)
  )
})

// --- push ---

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body
  if (!sub?.endpoint) return res.status(400).json({ error: 'Bad subscription' })
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, subscription, user) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, user = excluded.user`
  ).run(sub.endpoint, JSON.stringify(sub), req.user)
  res.json({ ok: true })
})

app.post('/api/push/test', requireAuth, async (req, res) => {
  const sent = await sendToAll({ title: '👶 Test nudge', body: `Push notifications are working, ${req.user}!` })
  res.json({ sent })
})

// --- static ---

// Manifest is rendered dynamically so BABY_NAME (private, env-only) can label
// the home-screen app without ever being committed to the repo.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n')
})

app.get('/manifest.webmanifest', (req, res) => {
  // Real name only for logged-in fetches (the manifest link uses use-credentials);
  // anonymous crawlers see a generic label.
  const name = currentUser(req)
    ? process.env.APP_NAME || process.env.BABY_NAME || 'Baby Tracker'
    : 'Baby Tracker'
  res.type('application/manifest+json').json({
    name,
    short_name: name,
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9fc',
    theme_color: '#6d28d9',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
})

app.use(express.static(path.join(__dirname, '..', 'public')))

app.listen(PORT, () => console.log(`baby-tracker listening on :${PORT} (tz ${HOME_TZ})`))
startNudgeTimer()
