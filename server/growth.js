// WHO percentiles, server-side, for spoken answers ("how much does she weigh?").
//
// The LMS tables live in public/growth-curves.js because the growth charts need
// them in the browser, and that file is a plain <script> global with no export.
// Keeping a second copy here would mean two tables that can silently drift, so
// the one shared file gets evaluated instead. The math below mirrors
// lmsAt/stdNormCdf/percentileFor in public/app.js - keep them in step.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'growth-curves.js'), 'utf8')
const GROWTH_LMS_BY_SEX = new Function(`${src}\nreturn GROWTH_LMS_BY_SEX`)()

const BIRTH_DATE = process.env.BIRTH_DATE || ''
const BABY_SEX = ['boy', 'girl'].includes(process.env.BABY_SEX) ? process.env.BABY_SEX : null

// Event type -> table name. 'height' is WHO's length-for-age.
const TABLE = { weight: 'weight', height: 'length', head: 'head' }

function lmsAt(table, ageMo) {
  const a = Math.max(table[0][0], Math.min(ageMo, table[table.length - 1][0]))
  let i = 0
  while (i < table.length - 2 && table[i + 1][0] <= a) i++
  const [a0, L0, M0, S0] = table[i]
  const [a1, L1, M1, S1] = table[i + 1]
  const f = a1 === a0 ? 0 : (a - a0) / (a1 - a0)
  return { L: L0 + f * (L1 - L0), M: M0 + f * (M1 - M0), S: S0 + f * (S1 - S0) }
}

function stdNormCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

// Noon local, matching how the client reads BIRTH_DATE, so an answer and the
// reports screen never disagree by a day's worth of percentile.
const ageMonthsAt = (iso) =>
  Math.max(0, (new Date(iso) - new Date(`${BIRTH_DATE}T12:00:00`)) / (86400000 * 30.4375))

// Returns 0-100, or null when percentiles aren't computable (no birth date, no
// sex configured, or a type with no growth standard).
export function percentileFor(type, value, occurredAt) {
  const tableName = TABLE[type]
  if (!tableName || !BIRTH_DATE || !BABY_SEX) return null
  const table = GROWTH_LMS_BY_SEX[BABY_SEX]?.[tableName]
  if (!table) return null
  const ageMo = ageMonthsAt(occurredAt)
  if (!Number.isFinite(ageMo)) return null
  const { L, M, S } = lmsAt(table, ageMo)
  const z = L !== 0 ? (Math.pow(value / M, L) - 1) / (L * S) : Math.log(value / M) / S
  const p = 100 * stdNormCdf(z)
  return Number.isFinite(p) ? p : null
}
