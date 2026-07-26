// Speech -> text for the in-app microphone button.
//
// Deliberately spoken to a plain OpenAI-compatible /v1/audio/transcriptions
// endpoint instead of a vendor SDK: Groq and OpenAI accept the identical
// multipart shape, so moving between them is two env vars rather than a
// rewrite. Claude models don't accept audio, which is why this is a second AI
// vendor at all.
//
// The audio itself is transient - it arrives in memory, goes to the vendor,
// and is dropped. It is never written to disk and never logged.

const API_KEY = process.env.TRANSCRIBE_API_KEY || ''
const ENDPOINT = process.env.TRANSCRIBE_URL || 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = process.env.TRANSCRIBE_MODEL || 'whisper-large-v3-turbo'

// Long enough for a 20 s clip on hotel wifi, short enough that a wedged vendor
// doesn't hold the parent staring at a spinner.
const TIMEOUT_MS = 30000

// No key means the feature is off, and the client hides the button entirely.
export const transcribeConfigured = () => !!API_KEY

// Whisper-class endpoints sniff the container from the filename extension and
// reject an unfamiliar one even when the bytes are fine. Browsers disagree on
// what they hand us: Safari records audio/mp4, Chrome audio/webm.
const EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mpga': 'mp3',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
}

// Returns the transcript, '' if the clip held no speech. Throws on a missing
// key, a non-2xx, or a timeout, so the caller speaks the `unavailable` line.
export async function transcribeAudio(buffer, mime) {
  if (!API_KEY) throw new Error('TRANSCRIBE_API_KEY is not set')

  // MediaRecorder reports a full codec string ("audio/webm;codecs=opus").
  const type = String(mime || '').split(';')[0].trim().toLowerCase()

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: type || 'application/octet-stream' }), `utterance.${EXT[type] || 'webm'}`)
  form.append('model', MODEL)
  form.append('response_format', 'json')
  // Deliberately no `language` parameter. Auto-detection is the entire reason
  // this feature exists: Siri transcribes in one language per device, and this
  // household code-switches mid-sentence.

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    // Truncated: this reaches the Fly log stream, and a vendor error body is
    // not somewhere family audio should be able to surface.
    const detail = await res.text().catch(() => '')
    throw new Error(`transcription failed: ${res.status} ${detail.slice(0, 200)}`)
  }

  const data = await res.json()
  return typeof data.text === 'string' ? data.text.trim() : ''
}
