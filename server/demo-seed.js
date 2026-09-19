// Synthetic demo data: about N months of plausible feeds, diapers, growth
// measurements, CDC milestones, ACIP vaccinations and placeholder photos,
// written straight into an open better-sqlite3 handle that already carries
// the server's real schema. Used by the DEMO_MODE boot hook and by
// scripts/seed-demo-data.js. Everything is generated from a seeded PRNG, so
// the same birth date and "now" always produce the same data.
//
// Nothing here reads .env, DATA_DIR or any real database: the caller passes
// the handle and the photo directory explicitly.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The checklists live in public/ as plain <script> globals, so they get
// evaluated the same way server/growth.js reads the WHO tables: one copy,
// no drift.
function loadGlobal(file, name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8')
  return new Function(`${src}\nreturn ${name}`)()
}

const USERS = ['Alex', 'Sam']
const MS = 864e5

// Placeholder photo: a two-stop gradient with a big soft circle and a
// "demo N" caption, rendered through the same resize/jpeg path a real upload
// takes. Sharp accepts SVG input, so no image fixtures live in the repo.
const HUES = [
  [124, 58, 237], [236, 72, 153], [16, 185, 129], [245, 158, 11],
  [59, 130, 246], [239, 68, 68], [20, 184, 166], [168, 85, 247],
]
async function renderPlaceholder(i, file) {
  const [r, g, b] = HUES[i % HUES.length]
  const dark = (c) => Math.round(c * 0.5)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(${r},${g},${b})"/>
    <stop offset="1" stop-color="rgb(${dark(r)},${dark(g)},${dark(b)})"/>
  </linearGradient></defs>
  <rect width="1200" height="1600" fill="url(#g)"/>
  <circle cx="600" cy="700" r="260" fill="rgba(255,255,255,0.25)"/>
  <text x="600" y="1350" font-family="Helvetica, Arial, sans-serif" font-size="120" fill="rgba(255,255,255,0.8)" text-anchor="middle">demo ${i + 1}</text>
</svg>`
  await sharp(Buffer.from(svg))
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(file)
}

/**
 * Fill `db` with synthetic data.
 * @param {object} o
 * @param {import('better-sqlite3').Database} o.db  open handle with the server schema
 * @param {string} o.photosDir  where placeholder JPEGs go (created if missing)
 * @param {string} o.birth  YYYY-MM-DD
 * @param {Date|string} o.now  the moment the data runs up to
 * @returns {Promise<number>} number of events written
 */
export async function seedDemo({ db, photosDir, birth, now }) {
  // Deterministic PRNG so re-running reproduces the same screenshots.
  let s = 20260101
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const jitter = (m) => (rnd() - 0.5) * 2 * m

  const BIRTH = new Date(birth + 'T09:20:00-07:00')
  const NOW = new Date(now)
  if (Number.isNaN(BIRTH.getTime()) || Number.isNaN(NOW.getTime())) throw new Error('seedDemo: bad birth or now')
  const DAYS = Math.ceil((NOW - BIRTH) / MS)
  const ageMonths = (NOW - BIRTH) / (MS * 30.4375)
  const iso = (d) => new Date(d).toISOString()

  fs.mkdirSync(photosDir, { recursive: true })

  const ins = db.prepare(
    `INSERT INTO events (type, occurred_at, created_by, notes, duration_min, amount_ml, kind, weight_g, height_cm, head_cm, photo_path, vaccine, dose_num, awake_after)
     VALUES (@type, @occurred_at, @created_by, @notes, @duration_min, @amount_ml, @kind, @weight_g, @height_cm, @head_cm, @photo_path, @vaccine, @dose_num, @awake_after)`
  )
  const add = (o) =>
    ins.run({
      notes: null, duration_min: null, amount_ml: null, kind: null, weight_g: null,
      height_cm: null, head_cm: null, photo_path: null, vaccine: null, dose_num: null,
      awake_after: 0, ...o,
    })

  // Photos are rendered outside the transaction (async), then inserted with it.
  const photoPlan = []
  const nPhotos = 8
  for (let i = 0; i < nPhotos; i++) {
    // Spread across the whole life so far; the first one on day 1 and one
    // near each month-iversary so the gallery gets its monthly-shot badges.
    let t
    if (i === 0) t = new Date(BIRTH.getTime() + 1 * MS + 10 * 36e5)
    else {
      const frac = i / nPhotos
      t = new Date(BIRTH.getTime() + frac * (NOW - BIRTH) + jitter(2) * MS)
    }
    if (t > NOW) t = new Date(NOW.getTime() - i * 36e5)
    if (t < BIRTH) t = new Date(BIRTH.getTime() + 36e5)
    const name = `${t.getTime()}-demo${String(i).padStart(2, '0')}.jpg`
    await renderPlaceholder(i, path.join(photosDir, name))
    photoPlan.push({ t, name })
  }

  const VACCINES = loadGlobal('vaccine-schedule.js', 'VACCINE_SCHEDULE')
  const MILESTONES = loadGlobal('milestone-checklist.js', 'MILESTONE_CHECKLIST')

  const write = db.transaction(() => {
    for (let d = DAYS; d >= 0; d--) {
      const day = new Date(NOW.getTime() - d * MS)
      const ageDays = Math.round((day - BIRTH) / MS)
      if (ageDays < 0) continue
      // Feeds cluster every ~2.5h newborn, stretching toward ~3h by 8 weeks.
      const gap = 2.4 + Math.min(ageDays, 56) / 80
      const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart.getTime() + MS)
      let cur = new Date(dayStart.getTime() + rnd() * 60 * 6e4)
      while (cur < dayEnd && cur <= NOW) {
        const by = pick(USERS)
        // Nurse first; supplement with a bottle on some feeds.
        add({
          type: 'breastfeed', occurred_at: iso(cur), created_by: by,
          duration_min: Math.round(14 + jitter(7)),
          awake_after: rnd() < 0.28 ? 1 : 0,
        })
        if (rnd() < 0.3) {
          const top = new Date(cur.getTime() + (12 + rnd() * 25) * 6e4)
          if (top <= NOW)
            add({
              type: 'formula', occurred_at: iso(top), created_by: by,
              amount_ml: Math.round((45 + ageDays * 0.6 + jitter(15)) / 5) * 5,
              kind: rnd() < 0.35 ? 'breastmilk' : 'formula',
            })
        }
        // A diaper around most feeds.
        if (rnd() < 0.85) {
          const dt = new Date(cur.getTime() + (5 + rnd() * 40) * 6e4)
          if (dt <= NOW)
            add({
              type: 'diaper', occurred_at: iso(dt), created_by: pick(USERS),
              kind: rnd() < 0.5 ? 'pee' : rnd() < 0.55 ? 'poop' : 'both',
            })
        }
        cur = new Date(cur.getTime() + (gap + jitter(0.5)) * 36e5)
      }

      // Weekly-ish growth measurements, on the same morning.
      if (ageDays % 7 === 2) {
        const m = new Date(dayStart.getTime() + 9.5 * 36e5)
        if (m <= NOW) {
          add({ type: 'weight', occurred_at: iso(m), created_by: 'Alex',
            weight_g: Math.round(3350 + ageDays * 29 + jitter(60)) })
          add({ type: 'height', occurred_at: iso(m), created_by: 'Alex',
            height_cm: Math.round((50 + ageDays * 0.11 + jitter(0.3)) * 10) / 10 })
          add({ type: 'head', occurred_at: iso(m), created_by: 'Alex',
            head_cm: Math.round((34.5 + ageDays * 0.055 + jitter(0.2)) * 10) / 10 })
        }
      }
    }

    // Free-form milestones, the kind a parent types in.
    const ms = [
      [40, 'First real smile - at the ceiling fan, of course'],
      [30, 'Slept a five-hour stretch. We did not.'],
      [18, 'Started tracking the cat across the room'],
      [6, 'Rolled halfway over during tummy time'],
    ]
    for (const [ago, note] of ms) {
      const t = new Date(NOW.getTime() - ago * MS + 11 * 36e5)
      if (t > BIRTH && t <= NOW)
        add({ type: 'milestone', occurred_at: iso(t), created_by: pick(USERS), notes: note })
    }

    // CDC checklist: every item of a completed bracket, checked off across
    // the weeks after that age; the current bracket about a third done.
    const brackets = [...new Set(MILESTONES.map((m) => m.bracket))].sort((a, b) => a - b)
    for (const br of brackets) {
      const items = MILESTONES.filter((m) => m.bracket === br)
      const complete = ageMonths >= br + 1.5
      const current = !complete && ageMonths >= br
      if (!complete && !current) continue
      const take = complete ? items : items.slice(0, Math.max(1, Math.round(items.length / 3)))
      take.forEach((m, i) => {
        const t = new Date(BIRTH.getTime() + (br * 30.4375 + 3 + i * 3 + jitter(1)) * MS + 12 * 36e5)
        if (t <= NOW)
          add({ type: 'milestone', occurred_at: iso(t), created_by: pick(USERS), kind: `cdc:${m.id}`, notes: m.text })
      })
    }

    // ACIP schedule: every routine dose whose recommended visit has passed,
    // given at that visit.
    for (const v of VACCINES) {
      if (v.repeatable || v.seasonal) continue
      const at = v.window.recommended
      if (ageMonths < at + 0.15) continue
      const t = new Date(BIRTH.getTime() + at * 30.4375 * MS + 10 * 36e5)
      if (t > NOW) continue
      add({ type: 'vaccination', occurred_at: iso(t), created_by: 'Alex', vaccine: v.vaccine, dose_num: v.dose_num, notes: v.fullName })
    }

    for (const p of photoPlan) {
      add({ type: 'photo', occurred_at: iso(p.t), created_by: pick(USERS), photo_path: p.name })
    }
  })
  write()

  return db.prepare('SELECT count(*) c FROM events').get().c
}

/** Remove every event, photo and thumbnail so seedDemo can start clean. */
export function wipeForReseed({ db, photosDir }) {
  db.exec('DELETE FROM events; DELETE FROM push_subscriptions; DELETE FROM meta;')
  for (const dir of [photosDir, path.join(photosDir, 'thumbs')]) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      if (fs.statSync(p).isFile()) fs.rmSync(p, { force: true })
    }
  }
}
