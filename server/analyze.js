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

function prompt(kind) {
  const label = { pee: 'pee', poop: 'poop', both: 'pee and poop' }[kind] || kind
  return (
    `This photo shows the contents of a newborn's diaper, logged by the parents as "${label}". ` +
    babyAgeLine() +
    'In 2-3 short sentences, describe the classic diaper qualities: color, texture/consistency, ' +
    'and rough amount, and say whether this looks typical and healthy for a baby of this age. ' +
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
  const res = await client.beta.messages.create({
    model: 'claude-fable-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: prompt(event.kind) },
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
