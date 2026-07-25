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

export const VOICE_TYPES = ['breastfeed', 'formula', 'pump', 'diaper', 'weight', 'height', 'head', 'milestone']

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
            duration_min: { type: 'number', description: 'breastfeed and pump only, minutes' },
            amount_ml: { type: 'number', description: 'formula (bottle) and pump only, millilitres' },
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

// Questions ("how long since she ate?") ride the same button and the same
// parse. The model's only job here is to pick an intent from this fixed set -
// it never states a figure, because a number invented from the transcript or
// from memory would be indistinguishable from a real one. The server computes
// every value it speaks.
const QUERY_INTENTS = ['last_feed', 'last_diaper', 'totals_today', 'latest_measurement', 'unsupported']

const ANSWER_QUESTION_TOOL = {
  name: 'answer_question',
  description:
    'Classify a QUESTION the parent asked about the baby. Use this instead of log_events whenever ' +
    'the utterance asks for information rather than recording something that happened.',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: QUERY_INTENTS,
        description:
          'last_feed: when the baby last ate. last_diaper: the most recent diaper change. ' +
          'totals_today: how much or how many so far today. latest_measurement: the latest ' +
          'weight, height or head circumference, with its percentile. ' +
          'unsupported: any other question, INCLUDING anything about sleep or naps.',
      },
      feed_type: {
        type: 'string',
        enum: ['breastfeed', 'bottle', 'any'],
        description: 'last_feed only. Use "any" unless the parent named one specifically.',
      },
      diaper_kind: {
        type: 'string',
        enum: ['pee', 'poop', 'any'],
        description: 'last_diaper only. Use "any" unless the parent asked about wet or dirty specifically.',
      },
      measurement: {
        type: 'string',
        enum: ['weight', 'height', 'head'],
        description: 'latest_measurement only.',
      },
    },
    required: ['intent'],
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
  return `You turn a parent's spoken sentence about their newborn into either structured
log entries or a classified question. Call exactly one tool, once. Never reply with prose.

- The sentence RECORDS something that happened -> log_events.
- The sentence ASKS for information -> answer_question.

${localNowLine()}

The utterance may be in English, Mandarin, or a mix of both — both languages are
first-class. The tool output is language-independent; only your parsing changes.
Common Mandarin vocabulary:
- 喂奶 / 亲喂 / 母乳 -> type breastfeed
- 瓶喂 / 奶瓶 -> type formula (配方奶 -> kind formula; 母乳瓶喂 / 挤出来的奶 -> kind breastmilk)
- 尿 / 尿了 -> diaper kind pee; 便便 / 大便 / 拉了 -> poop; 都有 / 又尿又拉 -> both
- 吸奶 / 泵奶 / 挤奶 -> type pump (amount_ml is what was expressed)
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
- type pump is a pumping session by the parent: amount_ml is required, duration
  optional. "I pumped 120 ml" -> pump; "she drank 120 ml of pumped milk" ->
  formula with kind breastmilk. Only pumping the parent did is type pump.
- Breastfeeding has NO side (left/right) field. If a side is mentioned, put it in
  notes; never invent a field.
- "Wet" -> pee, "dirty" / "poopy" -> poop, "wet and dirty" -> both.
- Multiple events in one utterance are normal ("90 ml and a wet diaper") — up to 3.
- Milestones: "log a milestone: first smile" -> type milestone with the
  description in notes (notes must be non-empty for a milestone).
- There is no photo event type via voice.
- If the utterance is not about baby care at all, or you cannot tell what was
  logged, set clarification and no events.

QUESTIONS - use answer_question, and pick the intent only; never answer from the
sentence itself, and never guess a number. The app computes every figure.
- "when did she last eat?" / "how long since she ate?" / 上次什么时候吃的 /
  多久没吃了 -> last_feed
- "when was her last diaper?" / 上次什么时候换的尿布 -> last_diaper
- "how much has she had today?" / "how many diapers today?" / 今天喝了多少 /
  今天拉了几次 -> totals_today
- "how much does she weigh?" / "what percentile is she?" / 她多重 / 体重多少 /
  百分位是多少 -> latest_measurement
- Anything else you cannot answer from that list -> unsupported. Sleep and nap
  questions ("how long has she been asleep?" / 睡了多久) are ALWAYS unsupported.

The parent said: "${text}"`
}

// Returns { events } or { clarification } or { query }. Throws on API/credential
// failure so the caller can speak the "not available right now" line.
export async function parseUtterance(text) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    tools: [LOG_EVENTS_TOOL, ANSWER_QUESTION_TOOL],
    // "any" rather than a named tool: the model picks which of the two, but is
    // still forced into one of them, so prose can never come back.
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: prompt(text) }],
  })
  const block = res.content.find((b) => b.type === 'tool_use')
  if (!block) return { clarification: null, events: [], query: null }
  const input = block.input || {}
  if (block.name === ANSWER_QUESTION_TOOL.name) {
    return {
      events: [],
      clarification: null,
      query: {
        intent: QUERY_INTENTS.includes(input.intent) ? input.intent : 'unsupported',
        feed_type: input.feed_type || 'any',
        diaper_kind: input.diaper_kind || 'any',
        measurement: input.measurement || 'weight',
      },
    }
  }
  const events = Array.isArray(input.events) ? input.events.slice(0, 3) : []
  const clarification = typeof input.clarification === 'string' ? input.clarification.trim() : ''
  if (!events.length) return { events: [], clarification: clarification || null, query: null }
  return { events: events.map(round), clarification: null, query: null }
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
  unknownDevice: { en: "I don't know whose phone this is.", zh: '不知道这是谁的手机。' },
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
  // The Shortcut's token can create events and nothing else. That create-only
  // scope is why a leaked Shortcut is survivable, so a question arriving on it
  // is refused rather than answered - questions read data.
  queriesInAppOnly: {
    en: 'I can only answer questions in the app, not from a Shortcut.',
    zh: '问题只能在应用里回答，快捷指令不行。',
  },
  cannotAnswer: { en: "I can't answer that one yet.", zh: '这个问题我还不会回答。' },
}

export const langOf = (lang) => (lang === 'zh' ? 'zh' : 'en')
export const say = (key, lang) => SPEECH[key][langOf(lang)]

// Which language to reply in, taken from the transcript's own script. The mic
// button has no language picker by design - declaring one up front is exactly
// the Siri limitation this feature exists to escape - so Han characters
// anywhere in the sentence mean answer in Chinese. A code-switched sentence
// ("120 ml 的奶") is therefore treated as Chinese, which is what the parent
// who said it expects to read back.
export const scriptLang = (text) =>
  /[\u3400-\u4dbf\u4e00-\u9fff]/.test(String(text || '')) ? 'zh' : 'en'

const JUST_NOW = { en: 'just now', zh: '刚刚' }
const LOGGED = { en: 'Logged: ', zh: '已记录：' }
const JOIN = { en: ' and ', zh: '，' }
const END = { en: '.', zh: '。' }

// Spoken noun per type, used by the near-duplicate warning.
const TYPE_NOUN = {
  breastfeed: { en: 'breastfeed', zh: '亲喂' },
  formula: { en: 'bottle', zh: '瓶喂' },
  pump: { en: 'pumping session', zh: '吸奶' },
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
      // Duration is optional, and answers replay rows logged months ago.
      if (!event.duration_min) return l === 'zh' ? '亲喂' : 'breastfeed'
      return l === 'zh' ? `亲喂 ${event.duration_min} 分钟` : `breastfeed, ${event.duration_min} min`
    case 'formula': {
      const milk = event.kind === 'breastmilk'
      if (l === 'zh') return `瓶喂${milk ? '母乳' : ''} ${event.amount_ml} 毫升`
      return `bottle${milk ? ' of breastmilk' : ''}, ${event.amount_ml} ml`
    }
    case 'pump': {
      const dur = event.duration_min ? (l === 'zh' ? ` ${event.duration_min} 分钟` : `, ${event.duration_min} min`) : ''
      return l === 'zh' ? `吸奶 ${event.amount_ml} 毫升${dur}` : `pumped ${event.amount_ml} ml${dur}`
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

// --- answers ---
//
// The mirror of confirmation(): the caller hands over rows and figures it read
// out of the database, and this turns them into one short sentence. Same rule
// applies - every number here came from a query, never from the model.

function agoPhrase(minutes, lang) {
  const l = langOf(lang)
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return l === 'zh' ? '刚刚' : 'just now'
  if (m < 60) return l === 'zh' ? `${m} 分钟前` : `${m} minute${m === 1 ? '' : 's'} ago`
  // Past two days a running hour count stops meaning anything to a tired parent.
  if (m >= 48 * 60) {
    const d = Math.round(m / 1440)
    return l === 'zh' ? `${d} 天前` : `${d} days ago`
  }
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (l === 'zh') return rem ? `${h} 小时 ${rem} 分钟前` : `${h} 小时前`
  const hr = `${h} hour${h === 1 ? '' : 's'}`
  return rem ? `${hr} ${rem} minute${rem === 1 ? '' : 's'} ago` : `${hr} ago`
}

// Matches fmtWeight/fmtHeight in public/app.js, so an answer and the reports
// screen never state the same measurement two different ways. Chinese gets 斤,
// the unit this household actually uses for a baby's weight.
function measurementPhrase(type, event, l) {
  if (type === 'weight') {
    const g = event.weight_g
    if (l === 'zh') return `${(g / 1000).toFixed(2)} 公斤（${(g / 500).toFixed(1)} 斤）`
    const totalOz = g / 28.3495
    const lb = Math.floor(totalOz / 16)
    const oz = Math.round((totalOz % 16) * 10) / 10
    return `${(g / 1000).toFixed(2)} kg (${lb} lb ${oz} oz)`
  }
  const cm = type === 'height' ? event.height_cm : event.head_cm
  return l === 'zh' ? `${cm.toFixed(1)} 厘米` : `${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(1)} in)`
}

function percentilePhrase(p, l) {
  if (p == null) return ''
  if (p < 1) return l === 'zh' ? '低于第 1 百分位' : 'below the 1st percentile'
  if (p > 99) return l === 'zh' ? '高于第 99 百分位' : 'above the 99th percentile'
  const n = Math.round(p)
  if (l === 'zh') return `第 ${n} 百分位`
  const teen = n % 100 >= 11 && n % 100 <= 13
  const last = n % 10
  const suffix = teen ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'
  return `${n}${suffix} percentile`
}

const MEASUREMENT_NOUN = {
  weight: { en: 'weight', zh: '体重' },
  height: { en: 'height', zh: '身高' },
  head: { en: 'head circumference', zh: '头围' },
}

const NOTHING_YET = {
  last_feed: { en: 'No feed logged yet.', zh: '还没有喂奶记录。' },
  last_diaper: { en: 'No diaper logged yet.', zh: '还没有尿布记录。' },
  totals_today: { en: 'Nothing logged today yet.', zh: '今天还没有记录。' },
}

// result is whatever the caller's query produced; see answerQuery in
// server/index.js for each intent's shape.
export function answer(result, lang) {
  const l = langOf(lang)
  switch (result.intent) {
    case 'last_feed': {
      if (!result.event) return NOTHING_YET.last_feed[l]
      const what = describeEvent(result.event, l)
      const when = agoPhrase(result.minutesAgo, l)
      return l === 'zh' ? `上次喂奶：${what}，${when}。` : `Last feed: ${what}, ${when}.`
    }
    case 'last_diaper': {
      if (!result.event) return NOTHING_YET.last_diaper[l]
      const what = DIAPER_DESC[result.event.kind]?.[l] || TYPE_NOUN.diaper[l]
      const when = agoPhrase(result.minutesAgo, l)
      return l === 'zh' ? `上次换尿布：${what}，${when}。` : `Last diaper: ${what}, ${when}.`
    }
    case 'totals_today': {
      const t = result.totals
      const parts = []
      if (l === 'zh') {
        if (t.breastfeedCount) {
          parts.push(`亲喂 ${t.breastfeedCount} 次${t.breastfeedMin ? ` 共 ${t.breastfeedMin} 分钟` : ''}`)
        }
        if (t.bottleCount) parts.push(`瓶喂 ${t.bottleCount} 次 共 ${t.bottleMl} 毫升`)
        if (t.pumpCount) parts.push(`吸奶 ${t.pumpCount} 次 共 ${t.pumpedMl} 毫升`)
        if (t.pee || t.poop) parts.push(`尿 ${t.pee} 次，便 ${t.poop} 次`)
        return parts.length ? `今天到现在：${parts.join('，')}。` : NOTHING_YET.totals_today.zh
      }
      if (t.breastfeedCount) {
        const min = t.breastfeedMin ? ` for ${t.breastfeedMin} min` : ''
        parts.push(`${t.breastfeedCount} breastfeed${t.breastfeedCount === 1 ? '' : 's'}${min}`)
      }
      if (t.bottleCount) {
        parts.push(`${t.bottleCount} bottle${t.bottleCount === 1 ? '' : 's'} totalling ${t.bottleMl} ml`)
      }
      if (t.pumpCount) {
        parts.push(`${t.pumpCount} pumping session${t.pumpCount === 1 ? '' : 's'} for ${t.pumpedMl} ml`)
      }
      if (t.pee || t.poop) parts.push(`${t.pee} wet and ${t.poop} dirty`)
      return parts.length ? `Today so far: ${parts.join(', ')}.` : NOTHING_YET.totals_today.en
    }
    case 'latest_measurement': {
      const noun = MEASUREMENT_NOUN[result.measurement][l]
      if (!result.event) {
        return l === 'zh' ? `还没有${noun}记录。` : `No ${noun} logged yet.`
      }
      const value = measurementPhrase(result.measurement, result.event, l)
      const pct = percentilePhrase(result.percentile, l)
      const when = agoPhrase(result.minutesAgo, l)
      if (l === 'zh') return `最近一次${noun}：${value}${pct ? `，${pct}` : ''}，${when}。`
      return `Latest ${noun}: ${value}${pct ? `, ${pct}` : ''}, measured ${when}.`
    }
    default:
      return say('cannotAnswer', l)
  }
}
