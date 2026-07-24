import Anthropic from '@anthropic-ai/sdk'

// Same conventions as analyze.js: one module-level client, credentials resolve at
// request time (ANTHROPIC_API_KEY env / Fly secret, or a local `ant auth login`
// profile in dev), and failures degrade to a speakable apology rather than throwing.
const client = new Anthropic()

const HOME_TZ = process.env.HOME_TZ || 'America/Los_Angeles'

// Latency-sensitive structured extraction — the parent is standing there waiting
// for Siri to answer — so this started on claude-haiku-4-5. Haiku got the units
// right (including 斤) but botched clock arithmetic: with an evening "now",
// "this morning at seven" and 今天早上七点 came back as 7 PM, two hours ago.
// A wrong day-part is silent bad data, so this runs on Sonnet instead, with
// thinking off and low effort to keep the round trip short (analyze.js pattern).
const MODEL = 'claude-sonnet-5'

export const VOICE_TYPES = ['breastfeed', 'formula', 'diaper', 'weight', 'height', 'head', 'milestone']

// Voice adds unit-mishap risk a tap-based form doesn't have: a mis-parse could
// write weight_g: 7 from "seven pounds". These bounds run after validateEvent.
const BOUNDS = {
  amount_ml: [5, 400],
  duration_min: [1, 90],
  weight_g: [1500, 15000],
  height_cm: [40, 100],
  head_cm: [25, 60],
  minutes_ago: [0, 1440], // older entries go through the app, where times are editable
}

const LOG_EVENTS_TOOL = {
  name: 'log_events',
  description: 'Record the baby-care events described in the utterance, or ask for clarification.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        maxItems: 3,
        description: 'The events described. Omit entirely if you set clarification.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: VOICE_TYPES },
            kind: {
              type: 'string',
              enum: ['pee', 'poop', 'both', 'formula', 'breastmilk'],
              description: "diaper: pee/poop/both. formula (any bottle): formula/breastmilk.",
            },
            duration_min: { type: 'number', description: 'breastfeed only, minutes' },
            amount_ml: { type: 'number', description: 'formula (bottle) only, millilitres' },
            weight_g: { type: 'number', description: 'weight only, grams' },
            height_cm: { type: 'number', description: 'height only, centimetres' },
            head_cm: { type: 'number', description: 'head only, centimetres' },
            minutes_ago: {
              type: 'integer',
              description: 'How long ago it happened, in minutes. 0 means now.',
            },
            notes: { type: 'string', description: 'Anything extra the parent said, e.g. "she was fussy"' },
          },
          required: ['type', 'minutes_ago'],
        },
      },
      clarification: {
        type: 'string',
        description:
          'Set INSTEAD of events when the utterance is too ambiguous to log safely. ' +
          'Phrase it as a short question, written in the same language as the utterance.',
      },
    },
  },
}

function localNowLine() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: HOME_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `The current local time (${HOME_TZ}) is ${fmt.format(new Date())}.`
}

function prompt(text) {
  return `You turn a parent's spoken sentence about their newborn into structured log entries.
Call the log_events tool exactly once. Never reply with prose.

${localNowLine()}

The utterance may be in English, Mandarin, or a mix of both — both languages are
first-class. The tool output is language-independent; only your parsing changes.
Common Mandarin vocabulary:
- 喂奶 / 亲喂 / 母乳 -> type breastfeed
- 瓶喂 / 奶瓶 -> type formula (配方奶 -> kind formula; 母乳瓶喂 / 挤出来的奶 -> kind breastmilk)
- 尿 / 尿了 -> diaper kind pee; 便便 / 大便 / 拉了 -> poop; 都有 / 又尿又拉 -> both
- 体重 -> weight; 身高 / 身长 -> height; 头围 -> head; 里程碑 / 第一次… -> milestone

TIME: work out minutes_ago from the current local time above. "just now" / 刚才 / 刚刚 -> 0,
"twenty minutes ago" -> 20, 半小时前 -> 30, "this morning at seven" / 今天早上七点 -> the
minutes between 7:00 AM local today and now. If no time is mentioned, use 0.

UNITS — always convert to the canonical units in the schema:
- ounces -> ml (x29.57), pounds+ounces -> grams, inches -> cm
- 毫升 -> ml, 盎司 -> ounces -> ml, 公斤 -> x1000 grams, 斤 -> x500 grams,
  两 -> x50 grams, 厘米 / 公分 -> cm
- Chinese numerals may arrive spelled out ("一百二十毫升" = 120 ml).
斤 is a common unit for baby weight in Chinese: 六斤半 is 3250 grams, not kilograms or pounds.

BOTTLE AMOUNTS in this household are always ml or ounces, and a bare quantity
with no event type named ("she had four", "took 120", 喝了一百二) is a bottle.
When no unit is spoken, the number alone decides it:
- 15 or under -> ounces. Convert to ml and log it; do not ask.
- 30 or over -> millilitres. Log it; do not ask.
- 16 to 29 -> genuinely ambiguous. Set clarification and log nothing.

OTHER RULES:
- type formula means ANY bottle; kind says what was in it. "Bottle" with no
  contents mentioned -> kind formula. Pumped milk -> kind breastmilk.
- Breastfeeding has NO side (left/right) field. If a side is mentioned, put it in
  notes; never invent a field.
- "Wet" -> pee, "dirty" / "poopy" -> poop, "wet and dirty" -> both.
- Multiple events in one utterance are normal ("90 ml and a wet diaper") — up to 3.
- Milestones: "log a milestone: first smile" -> type milestone with the
  description in notes (notes must be non-empty for a milestone).
- There is no photo event type via voice.
- If the utterance is not about baby care at all, or you cannot tell what was
  logged, set clarification and no events.

The parent said: "${text}"`
}

// Returns { events } or { clarification }. Throws on API/credential failure so
// the caller can speak the "not available right now" line.
export async function parseUtterance(text) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    tools: [LOG_EVENTS_TOOL],
    tool_choice: { type: 'tool', name: 'log_events' },
    messages: [{ role: 'user', content: prompt(text) }],
  })
  const block = res.content.find((b) => b.type === 'tool_use')
  if (!block) return { clarification: null, events: [] }
  const input = block.input || {}
  const events = Array.isArray(input.events) ? input.events.slice(0, 3) : []
  const clarification = typeof input.clarification === 'string' ? input.clarification.trim() : ''
  if (!events.length) return { events: [], clarification: clarification || null }
  return { events: events.map(round), clarification: null }
}

// Unit conversion leaves noise the parent never said — "four ounces" comes back
// as 118.28 ml, "twenty inches" as 50.8 cm. Round to what the app's own forms
// accept, so a voice-logged row looks like a typed one.
const PRECISION = { amount_ml: 0, duration_min: 0, weight_g: 0, height_cm: 1, head_cm: 1 }
function round(event) {
  const out = { ...event }
  for (const [field, digits] of Object.entries(PRECISION)) {
    if (typeof out[field] === 'number' && Number.isFinite(out[field])) {
      out[field] = Number(out[field].toFixed(digits))
    }
  }
  return out
}

// Returns null if every value is plausible, otherwise the name of the first
// field that isn't — the caller refuses the whole utterance.
export function outOfBounds(event) {
  for (const [field, [lo, hi]] of Object.entries(BOUNDS)) {
    const v = event[field]
    if (v == null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return field
  }
  return null
}

// --- speech ---
//
// Every speakable string lives here, in both languages, selected by the
// request's `lang`. Confirmations are deterministic server code, never model
// output — the parent has to be able to trust them verbatim.

export const SPEECH = {
  notSetUp: { en: "Voice logging isn't set up.", zh: '语音记录还没有设置。' },
  unauthorized: { en: "Sorry, that wasn't authorized.", zh: '抱歉，没有权限。' },
  unknownUser: { en: "I don't know who's logging that.", zh: '不知道是谁在记录。' },
  unavailable: { en: "Voice logging isn't available right now.", zh: '语音记录暂时不可用。' },
  tooManyRequests: { en: 'Too many requests — try again in a bit.', zh: '请求太频繁了，请稍后再试。' },
  empty: { en: "I didn't hear anything.", zh: '没有听到内容。' },
  tooLong: { en: 'That was a bit long — try a shorter sentence.', zh: '说得有点长，请说短一点。' },
  notUnderstood: {
    en: "Sorry, I didn't catch that — try again with the amount and event type.",
    zh: '抱歉，没听清，请说清楚事件类型和数量。',
  },
  couldNotSave: { en: "I couldn't save that — try again.", zh: '没能记录，请再说一次。' },
  amount_ml: {
    en: "That amount didn't sound right — try again in millilitres or ounces.",
    zh: '这个奶量听起来不对，请用毫升或盎司再说一次。',
  },
  duration_min: {
    en: "That feeding time didn't sound right — try again in minutes.",
    zh: '这个喂奶时长听起来不对，请用分钟再说一次。',
  },
  weight_g: {
    en: "That weight didn't sound right — try again with pounds or grams.",
    zh: '这个体重听起来不对，请用斤或克再说一次。',
  },
  height_cm: {
    en: "That length didn't sound right — try again in inches or centimetres.",
    zh: '这个身高听起来不对，请用厘米或英寸再说一次。',
  },
  head_cm: {
    en: "That head measurement didn't sound right — try again in inches or centimetres.",
    zh: '这个头围听起来不对，请用厘米或英寸再说一次。',
  },
  minutes_ago: {
    en: 'That was too far back to log by voice — add it in the app instead.',
    zh: '时间太久以前了，请在应用里补记。',
  },
}

export const langOf = (lang) => (lang === 'zh' ? 'zh' : 'en')
export const say = (key, lang) => SPEECH[key][langOf(lang)]

const JUST_NOW = { en: 'just now', zh: '刚刚' }
const LOGGED = { en: 'Logged: ', zh: '已记录：' }
const JOIN = { en: ' and ', zh: '，' }
const END = { en: '.', zh: '。' }

// Spoken noun per type, used by the near-duplicate warning.
const TYPE_NOUN = {
  breastfeed: { en: 'breastfeed', zh: '亲喂' },
  formula: { en: 'bottle', zh: '瓶喂' },
  diaper: { en: 'diaper', zh: '尿布' },
  weight: { en: 'weight', zh: '体重' },
  height: { en: 'height', zh: '身高' },
  head: { en: 'head measurement', zh: '头围' },
  milestone: { en: 'milestone', zh: '里程碑' },
}

const DIAPER_DESC = {
  pee: { en: 'wet diaper', zh: '尿布（尿）' },
  poop: { en: 'dirty diaper', zh: '尿布（便）' },
  both: { en: 'wet and dirty diaper', zh: '尿布（尿和便）' },
}

const ZH_PERIODS = [
  [5, '凌晨'],
  [9, '早上'],
  [12, '上午'],
  [13, '中午'],
  [18, '下午'],
  [24, '晚上'],
]

function clockTime(date, lang) {
  if (langOf(lang) === 'zh') {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: HOME_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(date)
      .split(':')
    const h24 = Number(parts[0])
    const period = ZH_PERIODS.find(([end]) => h24 < end)[1]
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${period} ${h12}:${parts[1]}`
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOME_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

function describeEvent(event, lang) {
  const l = langOf(lang)
  switch (event.type) {
    case 'breastfeed':
      return l === 'zh' ? `亲喂 ${event.duration_min} 分钟` : `breastfeed, ${event.duration_min} min`
    case 'formula': {
      const milk = event.kind === 'breastmilk'
      if (l === 'zh') return `瓶喂${milk ? '母乳' : ''} ${event.amount_ml} 毫升`
      return `bottle${milk ? ' of breastmilk' : ''}, ${event.amount_ml} ml`
    }
    case 'diaper':
      return DIAPER_DESC[event.kind][l]
    case 'weight':
      return l === 'zh' ? `体重 ${event.weight_g} 克` : `weight, ${event.weight_g} g`
    case 'height':
      return l === 'zh' ? `身高 ${event.height_cm} 厘米` : `height, ${event.height_cm} cm`
    case 'head':
      return l === 'zh' ? `头围 ${event.head_cm} 厘米` : `head circumference, ${event.head_cm} cm`
    case 'milestone':
      return l === 'zh' ? `里程碑：${event.notes}` : `milestone: ${event.notes}`
  }
}

// events: the parsed events, each paired with the Date it was logged at.
export function confirmation(saved, lang) {
  const l = langOf(lang)
  const parts = saved.map(({ event, at, minutesAgo }) => {
    const when = minutesAgo <= 2 ? JUST_NOW[l] : clockTime(at, lang)
    return l === 'zh' ? `${describeEvent(event, lang)}，${when}` : `${describeEvent(event, lang)}, ${when}`
  })
  return `${LOGGED[l]}${parts.join(JOIN[l])}${END[l]}`
}

// Voice bypasses the app's last-logged-time buttons, and a lost response tempts
// a retry after the insert already happened. Warn, never block — clusters like
// pee-then-poop are legitimate, and so is both parents logging the same feed.
export function duplicateWarning(type, minutes, lang) {
  const l = langOf(lang)
  const noun = TYPE_NOUN[type][l]
  return l === 'zh'
    ? `注意：${minutes} 分钟前也记过一次${noun}。`
    : ` Note, a ${noun} was also logged ${minutes} minute${minutes === 1 ? '' : 's'} ago.`
}
