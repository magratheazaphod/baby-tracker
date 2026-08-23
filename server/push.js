import webpush from 'web-push'
import fs from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR, getMeta, setMeta } from './db.js'

const HOME_TZ = process.env.HOME_TZ || 'America/Los_Angeles'
const NUDGE_HOURS = Number(process.env.NUDGE_HOURS || 6)
const RENUDGE_MINUTES = Number(process.env.RENUDGE_MINUTES || 60)
const CHECK_INTERVAL_MS = 5 * 60 * 1000

const BIRTH_DATE = process.env.BIRTH_DATE || '' // YYYY-MM-DD, or unset
const MONTHLY_PHOTO_NUDGE = process.env.MONTHLY_PHOTO_NUDGE !== '0'
const PHOTO_NUDGE_DAYS = Number(process.env.PHOTO_NUDGE_DAYS ?? 3)
// Photo nudges are cheerful, not urgent: never before 9am, and the staleness
// one never after 9pm.
const PHOTO_NUDGE_START_HOUR = 9
const PHOTO_NUDGE_END_HOUR = 21

// Feeds and diapers are the "signs of life" that reset the nudge clock;
// weights and photos are too occasional to count.
const TRACKED_TYPES = ['breastfeed', 'formula', 'diaper']

const TYPE_LABELS = {
  breastfeed: '🤱 breastfeeding',
  formula: '🍼 formula',
  diaper: '💩 a diaper',
}

function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    }
  }
  // Dev convenience: generate once and persist alongside the database.
  const keyFile = path.join(DATA_DIR, 'vapid.json')
  if (fs.existsSync(keyFile)) return JSON.parse(fs.readFileSync(keyFile, 'utf8'))
  const keys = webpush.generateVAPIDKeys()
  fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2))
  return keys
}

export const vapidKeys = loadVapidKeys()

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
)

export async function sendToAll(payload) {
  const subs = db.prepare('SELECT id, subscription FROM push_subscriptions').all()
  const body = JSON.stringify(payload)
  let sent = 0
  for (const row of subs) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), body)
      sent++
    } catch (err) {
      // 404/410 mean the subscription is dead (app reinstalled, permission revoked).
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id)
      } else {
        console.error('push failed:', err.statusCode || err.message)
      }
    }
  }
  return sent
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOME_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export async function checkNudge(now = new Date()) {
  if (NUDGE_HOURS <= 0) return // disabled - see startNudgeTimer

  const last = db
    .prepare(
      `SELECT type, occurred_at FROM events
       WHERE type IN (${TRACKED_TYPES.map(() => '?').join(',')})
       ORDER BY occurred_at DESC LIMIT 1`
    )
    .get(...TRACKED_TYPES)
  if (!last) return

  const sinceLast = now - new Date(last.occurred_at)
  if (sinceLast < NUDGE_HOURS * 3600 * 1000) return

  const lastNudge = getMeta('last_nudge_at')
  if (lastNudge && now - new Date(lastNudge) < RENUDGE_MINUTES * 60 * 1000) return

  const sent = await sendToAll({
    title: '👶 Time for a check-in?',
    body: `No entries in ${formatDuration(sinceLast)} — last was ${TYPE_LABELS[last.type]} at ${formatLocalTime(last.occurred_at)}.`,
  })
  setMeta('last_nudge_at', now.toISOString())
  console.log(`nudge sent to ${sent} device(s); last entry ${last.type} at ${last.occurred_at}`)
}

// --- photo nudges ---
//
// Everything below asks "what day is it?" and "what time is it?", and the
// answer has to be the parents' answer, not the server's. Production runs in
// UTC, so a raw `date.getDate()` flips to tomorrow at 4-5pm local: a
// month-iversary nudge would fire on the wrong calendar day, and the quiet
// hours would slide. So every date/hour value here comes from
// Intl.DateTimeFormat in HOME_TZ (the same en-CA pattern the reports view
// uses for its day boundaries) and never from a Date's local accessors.

const tzPartsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOME_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

// {y, m, d, hour} for an instant, as seen in HOME_TZ. m is 1-based.
function tzParts(date) {
  const p = Object.fromEntries(tzPartsFmt.formatToParts(date).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) % 24 }
}

// Pure calendar arithmetic (no instant involved), so UTC is just a safe way to
// ask the calendar how long a month is. Month is 1-based.
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function birthParts() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(BIRTH_DATE)
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}

// Which day of the given month is the month-iversary, with the end-of-month
// clamp: a baby born on the 31st has its month-iversary on the 28th/29th of
// February, the 30th of April, and so on. Without the clamp those months would
// silently have no anniversary at all.
function anniversaryDay(birth, y, m) {
  return Math.min(birth.d, daysInMonth(y, m))
}

// Whole months old on the given HOME_TZ calendar day. 0 until the first
// month-iversary, which is exactly why month index 0 never sends.
function monthsOld(birth, today) {
  const idx = (today.y - birth.y) * 12 + (today.m - birth.m)
  return today.d < anniversaryDay(birth, today.y, today.m) ? idx - 1 : idx
}

// Nudge on the month-iversary. State is the newest month index that has been
// handled - sent, or passed over because we noticed it late. Storing the
// passed-over ones is what keeps a restart after downtime from firing a
// "3 months old today!" push on a day that is not the anniversary.
async function checkMonthlyPhotoNudge(now) {
  if (!MONTHLY_PHOTO_NUDGE) return
  const birth = birthParts()
  if (!birth) return

  const today = tzParts(now)
  const months = monthsOld(birth, today)
  const handled = Number(getMeta('photo_nudge_monthly_sent') ?? -1)
  if (months <= handled) return

  const isAnniversary = today.d === anniversaryDay(birth, today.y, today.m)
  if (isAnniversary && months >= 1) {
    // Wait for a civilised hour rather than marking it handled at 00:05.
    if (today.hour < PHOTO_NUDGE_START_HOUR) return
    const name = process.env.BABY_NAME || 'Baby'
    const sent = await sendToAll({
      title: '🎂 Monthly photo day',
      body: `${name} is ${months} month${months === 1 ? '' : 's'} old today! Time for the monthly photo 🎂`,
      url: '/#photos',
    })
    setMeta('photo_nudge_monthly_sent', String(months))
    // Two photo nudges in one day would be nagging.
    setMeta('photo_nudge_stale_sent', now.toISOString())
    console.log(`monthly photo nudge sent to ${sent} device(s); month ${months}`)
    return
  }
  // Not the anniversary (or month 0): record the index as handled so it can
  // never fire retroactively on some later, ordinary day.
  setMeta('photo_nudge_monthly_sent', String(months))
}

// Nudge when the gallery has gone quiet. Elapsed absolute time, not calendar
// arithmetic, so a DST change cannot turn 3 days into 4 (a spring-forward day
// is 23h long; counting calendar days would over-report). The quiet-hours
// gate is still HOME_TZ wall clock, which is what "no 3am pings" means.
async function checkStalePhotoNudge(now) {
  if (!(PHOTO_NUDGE_DAYS > 0)) return

  const { hour } = tzParts(now)
  if (hour < PHOTO_NUDGE_START_HOUR || hour >= PHOTO_NUDGE_END_HOUR) return

  const lastSent = getMeta('photo_nudge_stale_sent')
  if (lastSent && now - new Date(lastSent) < 24 * 3600 * 1000) return

  const last = db
    .prepare("SELECT occurred_at FROM events WHERE type = 'photo' ORDER BY occurred_at DESC LIMIT 1")
    .get()
  // With no photos at all, the clock starts at the birth date (noon UTC is
  // close enough at day resolution) so a new instance gets nudged once the
  // gallery has been empty that long. With no birth date either there is no
  // clock to start, so stay quiet rather than nag on day one.
  const since = last ? new Date(last.occurred_at) : BIRTH_DATE ? new Date(`${BIRTH_DATE}T12:00:00Z`) : null
  if (!since || Number.isNaN(since.getTime())) return

  const days = Math.floor((now - since) / 86400000)
  if (days < PHOTO_NUDGE_DAYS) return

  const sent = await sendToAll({
    title: '📷 Photo check',
    body: `It's been ${days} days since the last photo 📷`,
    url: '/#photos',
  })
  setMeta('photo_nudge_stale_sent', now.toISOString())
  console.log(`stale photo nudge sent to ${sent} device(s); ${days} days since last photo`)
}

// Monthly first: when it fires it also stamps the staleness clock, so the two
// never land on the same day.
export async function checkPhotoNudge(now = new Date()) {
  try {
    await checkMonthlyPhotoNudge(now)
  } catch (err) {
    console.error('monthly photo nudge failed:', err)
  }
  await checkStalePhotoNudge(now)
}

// The interval always starts so other periodic checks can share this loop;
// each check gates on its own config, so NUDGE_HOURS<=0 disables just the
// feed nudge without stopping the timer.
export function startNudgeTimer() {
  setInterval(() => {
    checkNudge().catch(err => console.error('nudge check failed:', err))
    checkPhotoNudge().catch(err => console.error('photo nudge check failed:', err))
  }, CHECK_INTERVAL_MS)
  if (NUDGE_HOURS <= 0) console.log('feed nudge disabled (NUDGE_HOURS <= 0)')
  else console.log(`nudge timer running: threshold ${NUDGE_HOURS}h, re-nudge every ${RENUDGE_MINUTES}m`)
  if (MONTHLY_PHOTO_NUDGE && birthParts()) console.log('monthly photo nudge enabled')
  if (PHOTO_NUDGE_DAYS > 0) console.log(`stale photo nudge enabled: ${PHOTO_NUDGE_DAYS} day(s)`)
}
