import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { db, PHOTOS_DIR } from './db.js'

// Credentials resolve at request time (ANTHROPIC_API_KEY env / Fly secret, or a
// local `ant auth login` profile in dev). If none are configured the request
// fails and the event simply keeps analysis = NULL.
const client = new Anthropic()

function babyAgeLine() {
  const birth = process.env.BIRTH_DATE
  if (!birth || Number.isNaN(Date.parse(birth))) return ''
  const days = Math.floor((Date.now() - Date.parse(birth)) / 86400000)
  if (days < 0 || days > 400) return ''
  return `The baby is ${days} day${days === 1 ? '' : 's'} old. `
}

function prompt(kind, priors, notes) {
  const label = { pee: 'pee', poop: 'poop', both: 'pee and poop' }[kind] || kind
  const intro =
    `This photo shows the contents of a newborn's diaper, logged by the parents as "${label}". ` +
    babyAgeLine()
  // After the first couple of write-ups the full description reads samey —
  // show the model its own recent notes so repeats collapse to one line.
  const body =
    priors.length >= 2
      ? `Your recent notes on this baby's previous diapers:\n${priors.map((a) => `- ${a}`).join('\n')}\n` +
        'If this one is more of the same, reply with ONE short, warm sentence confirming all is well — ' +
        'vary the phrasing rather than repeating the descriptions above. Only describe color/texture/' +
        'amount in detail if something is genuinely different or distinctive this time. '
      : 'In 2-3 short sentences, describe the classic diaper qualities: color, texture/consistency, ' +
        'and rough amount, and say whether this looks typical and healthy for a baby of this age. '
  // The parents can add a note (a smell, a worry, something the photo can't
  // convey). Whatever else the reply does, it must speak to that note — even
  // when everything else is routine and the reply would otherwise be one line.
  const note =
    notes && notes.trim()
      ? `The parents added this note when they logged it: "${notes.trim()}". Address it directly and ` +
        'specifically in your reply: relate it to what you can (or cannot) see in the photo, and say ' +
        'plainly whether it is normal, something to keep an eye on, or worth raising with a ' +
        'pediatrician. Do this even if the diaper itself looks routine. '
      : ''
  return (
    intro +
    body +
    note +
    'If anything in the photo is a recognized reason to check with a pediatrician (for example red, ' +
    'black, or white/chalky stool), say so calmly and clearly. You are talking directly to the ' +
    "parents; be warm and factual. You are not diagnosing - don't add disclaimers beyond that. " +
    'If the photo does not actually show diaper contents, briefly say what you see instead.'
  )
}

// Fire-and-forget: analyze a diaper photo and store the result on the event.
// Never throws - a failure just leaves analysis NULL.
export function queueDiaperAnalysis(event) {
  analyze(event).catch((err) => console.error(`diaper analysis failed for event ${event.id}:`, err.message))
}

async function analyze(event) {
  const data = await fs.readFile(path.join(PHOTOS_DIR, path.basename(event.photo_path)), 'base64')
  const priors = db
    .prepare(
      `SELECT analysis FROM events WHERE type = 'diaper' AND analysis IS NOT NULL AND id != ?
       ORDER BY occurred_at DESC LIMIT 3`
    )
    .all(event.id)
    .map((r) => r.analysis)
  const res = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    // Reading a diaper photo is a simple visual check, not a reasoning task —
    // Sonnet at low effort with thinking off keeps it cheap. (Thinking is on by
    // default on Sonnet 5 when omitted, so disable it explicitly.)
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: prompt(event.kind, priors, event.notes) },
        ],
      },
    ],
  })
  if (res.stop_reason === 'refusal') return
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) return
  // Guard against the photo having been replaced or removed while we worked.
  db.prepare('UPDATE events SET analysis = ? WHERE id = ? AND photo_path = ?').run(text, event.id, event.photo_path)
}
