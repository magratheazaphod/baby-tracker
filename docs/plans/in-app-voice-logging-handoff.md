# Handoff — in-app microphone logging

**For the next assistant.** This is a *design* handoff: nothing below is built
yet. The server-side voice pipeline it builds on **is** built and live (see
`docs/plans/siri-voice-logging-handoff.md`). Read
`.claude/skills/baby-tracker/SKILL.md` first (privacy — public repo). Real
values (app URL, parent names, tokens) live in `.env` and `fly secrets`, never
in committed files including this one.

Work on a branch and open a PR; `main` is what's deployed to the live instance
both parents depend on.

---

## Why this exists

Voice logging works today through a Siri Shortcut. A night of real testing
found the Shortcut path is the weak half, and one finding is disqualifying:

> **Siri-invoked Shortcuts transcribe in the device's Siri language and ignore
> the Dictate Text action's Language setting.** The setting only applies when
> the Shortcut is run from the Shortcuts app, home screen, or a widget.

So Mandarin dictation cannot work through "Hey Siri" on an English-Siri phone.
Confirmed empirically: the identical Shortcut works when run by tapping ▶ and
fails through Siri, returning English clarification questions because the model
received English transcription of Mandarin speech. The household speaks six
languages; Siri handles one at a time, per device.

Secondary Siri problems, all real but survivable: the dictation prompt is loud
and **cannot be quieted programmatically** (no API for Siri's TTS volume); each
phone needs its own Shortcut copy; distribution is AirDrop.

An in-app mic button fixes all of it except hands-free operation. Keep the
Shortcut for hands-free; this is for everything else.

---

## What already exists (do not rebuild)

| Piece | Where |
|---|---|
| Utterance → events parser, bounds, confirmations, `SPEECH` table | `server/voice.js` |
| `POST /api/voice` — auth, rate limit, validate, back-date, dup-warn, insert | `server/index.js` |
| **Cookie auth already accepted** on `/api/voice` (`currentUser(req)` checked before the bearer fallback) | `server/index.js` |
| Multer memory-storage upload pattern | `server/index.js` (photo route) |
| `apiUpload()` — XHR upload with progress, handles 401 | `public/app.js` |
| `quickDiaper()` — save instantly, toast with a tap action | `public/app.js` |
| `toast(msg, onTap)`, `openSheet(type, {existing})`, `refreshAll()` | `public/app.js` |
| Access log for `/api/*` (method, path, status, ms) | `server/index.js` |

The parser needs no changes. It already handles mixed-language text — dictation
was always the weak link, not parsing.

---

## Decisions already made (and why)

**Server-side transcription, not the browser's Web Speech API.**
Whisper-class models auto-detect language and tolerate code-switching
mid-sentence. Web Speech takes a single `lang` per call, which reproduces
exactly the Siri limitation this feature exists to escape, and its support
inside an iOS home-screen PWA is unreliable. Cost of the decision: a second AI
vendor (Claude models don't accept audio).

**Save immediately, toast to undo — no confirm step.** Matches `quickDiaper`
and the repo's ≤2-taps-at-3am rule. The sheet's existing delete button is the
undo path.

**Vendor behind an OpenAI-compatible env shim, not a hardcoded SDK.** Groq and
OpenAI both expose `/v1/audio/transcriptions` with the same multipart shape, so
switching vendors is two env vars, not a code change.

**Audio is never persisted.** Transient in memory, sent to the vendor,
discarded. Do not reuse `PHOTOS_DIR` or any disk path. This is family audio in
a house with a newborn.

---

## Build plan

### 1. `server/transcribe.js` (new)

`transcribeAudio(buffer, mime)` → transcript string. Multipart POST to an
OpenAI-compatible endpoint. Env:

- `TRANSCRIBE_API_KEY` — unset disables the feature entirely
- `TRANSCRIBE_URL` — default `https://api.groq.com/openai/v1/audio/transcriptions`
- `TRANSCRIBE_MODEL` — default `whisper-large-v3-turbo`

**Send no `language` parameter** — auto-detection is the whole point. Throw on
non-2xx so the caller speaks the existing `unavailable` line.

### 2. Refactor `server/index.js`

Extract everything in `POST /api/voice` from `parseUtterance` onward —
clarification, `validateEvent` + `outOfBounds`, back-dating, duplicate
warnings, `confirmation`, insert — into:

```js
async function logUtterance(text, who, lang) // -> { ok, saved, speech }
```

Both routes call it. No parsing or validation logic gets duplicated.

### 3. `POST /api/voice/audio` (new)

- `requireAuth` **only** — this is the in-app path, so the login cookie
  identifies the parent. No `VOICE_TOKEN`, no `DEVICE_USERS` lookup.
- Multer memory storage, ~10 MB limit.
- Transcribe → `logUtterance(text, req.user, lang)`, where `lang` is derived
  from the transcript's own script (Han characters → `zh`), not a client field.
- Reuse `voiceRateLimit`, but **raise the ceiling or key it per user**: 30/15min
  assumed one Shortcut per IP, and both parents share home wifi.

### 4. `/api/config`

Add `voiceInput: !!TRANSCRIBE_API_KEY` so the client hides the button when
unconfigured. Config is post-auth already (anonymous gets `{user:null}`), so
this leaks nothing.

### 5. Client

**`public/index.html`** — full-width mic button at the top of the log grid in
`#view-log`, above Breastfeeding. The grid is 6 columns (`.span2` / `.span3`).

**`public/app.js`** — `recordUtterance()` beside `quickDiaper`:

- Tap → `getUserMedia({audio:true})` → `MediaRecorder`. **Feature-detect the
  mime**: Safari yields `audio/mp4`, Chrome `audio/webm`. Pass through whatever
  was produced as the upload content type.
- Recording state: stop control, elapsed counter, pulse. **Auto-stop at 20 s**
  so a pocket tap can't record forever.
- Tap again → stop → upload via `apiUpload`.
- Success, one event: `toast('🍼 Bottle 120 ml saved · tap to edit', () =>
  openSheet(type, {existing}))`. Multiple events: toast the count, tap opens the
  timeline. Then `refreshAll()`.
- Failure: `toast(speech)` — the server's failure strings are already short
  human sentences and read correctly on screen. No new copy needed.
- Denied mic permission: toast a line pointing at Settings, don't fail silently.

**`public/style.css`** — button + recording state via existing `--c-*` vars,
following `.log-btn:active`. Keep light and dark in sync.

**`public/sw.js`** — the fetch handler `cache.put`s every response; guard it to
`GET`. Pre-existing, but this adds another POST path.

### 6. Docs and config

- `.env.example`: the three `TRANSCRIBE_*` vars, noting unset = off.
- `docs/siri-voice-logging.md`: document both paths and which to reach for —
  Siri for hands-free, button for everything else. **Include the Siri-language
  finding above** so nobody rediscovers it the hard way.
- `docs/plans/in-app-voice-logging.md`: the decision record (this doc's
  "Decisions" section, expanded), plus known limitations and open questions.
- Privacy grep before every commit, real `.env` values as patterns, zero hits.
- Commit body should state that audio is transient — never persisted, never
  logged, sent only to the transcription vendor.

---

## 7. Spoken questions ("how long since she ate?")

Same button, same pipeline — the utterance is either a log or a question, and
the parser decides which.

**Scoping decision (settled): in-app only.** Queries are answered when the
request is cookie-authenticated (`currentUser(req)`), i.e. from the mic button
by a logged-in parent. A `VOICE_TOKEN`-authenticated request that parses to a
question gets a fixed speakable refusal — add a `queriesInAppOnly` key to the
`SPEECH` table in `server/voice.js`, en + zh. **Do not widen the Shortcut token
to read data**: its create-only scope is the reason a leaked Shortcut is
survivable, and that guarantee is documented as load-bearing.

**The model picks an intent; the server computes the number.** Never let the
model state a figure from the transcript or from memory — it classifies only.
Extend the tool schema in `server/voice.js` with a query tool over a fixed
intent set:

- `last_feed` (optionally `breastfeed` / `bottle`), `last_diaper` (optional kind)
- `totals_today` — formula ml, feed count, diaper counts
- `latest_measurement` — weight / height / head, with the WHO percentile
- `time_since_sleep` — if the sleep answer proves awkward, defer it; the
  inference currently lives in `public/app.js`, not on the server, and porting
  it is a bigger job than the rest of this section combined.

**Answers reuse existing queries**: `/api/events/latest` for last-of-each-type,
the `reports/daily` aggregation for day totals (it already groups by `HOME_TZ`
day boundaries — do not re-derive day math), and `growth-curves.js` LMS values
for percentiles.

**Formatting** mirrors `confirmation()` in `server/voice.js`: add an `answer()`
that renders each intent's result as one short sentence in `en` or `zh`, chosen
by the transcript's script the same way logging does.

Response shape is unchanged: `{ ok, saved: [], speech }`. `saved` stays empty —
a question saves nothing — so the client's existing toast path works with no
branching beyond "don't offer a tap-to-edit when nothing was saved."

Verification for this section: ask each intent in both languages, confirm the
number matches what the app's own screens show, and confirm a question sent
with the Shortcut token is refused rather than answered.

---

## Known limitations to write down, not solve

- No offline support: recording without a network loses the utterance.
- 20 s cap is a guess; revisit if real sentences get truncated.
- Mandarin numeral accuracy through Whisper is **unmeasured** — measure it.
- Rate limit may need to become per-user rather than per-IP.
- Not hands-free. That's the Shortcut's job and this doesn't replace it.

---

## Verification (feature isn't done until all pass)

1. `curl -F` a recorded sample to `/api/voice/audio` with a logged-in cookie
   jar; confirm the row lands with the right `created_by`.
2. **A Mandarin clip round-trips.** This is the case the feature exists for.
3. A code-switched sentence ("120 ml 的奶") — what Siri could not do at all.
4. Browser: local server + Chrome MCP, driving `recordUtterance` via
   `javascript_tool` (coordinate clicks are unreliable at scaled DPI). Check
   toast text, that the tap opens the right event, that Recent repaints.
5. Failure paths: unset `TRANSCRIBE_API_KEY` (button hidden), silent clip
   (→ "I didn't hear anything"), denied mic permission.
6. On-device after deploy, **from the home-screen PWA** and not just Safari —
   that's where iOS media APIs differ. Both parents; confirm attribution.
7. Prod: `/api/health` → `{"ok":true}`, anonymous `/api/config` →
   `{"user":null}`, access log shows the new route.

Record what was actually run — which languages, which devices, which failure
paths — in the PR, so the next iteration knows what's covered rather than
assuming.

---

## Cost

~$0.0002/min transcription (Groq) on top of ~$0.003 per parse. A dozen logs a
day is a few cents a month; the parse dominates.
