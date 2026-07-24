# Handoff — finishing Siri voice logging (phone side)

**For the next assistant.** The server half of the voice-logging feature
(`docs/plans/siri-voice-logging.md`) is **built, committed, deployed, and
verified in production**. What remains is entirely **on the parents' iPhones** —
building Shortcuts — which the assistant cannot do directly; your job is to
guide the user through it, diagnose spoken errors, and reproduce parses with
`curl` when something is off.

**Read `.claude/skills/baby-tracker/SKILL.md` first** (privacy — public repo)
and `docs/plans/siri-voice-logging.md` (the original design). Real values
(app URL, parent names, tokens) live in `.env` and `fly secrets`, never in
committed files including this one — placeholders below.

---

## Status snapshot

| Piece | State |
|---|---|
| `server/voice.js`, `POST /api/voice` in `server/index.js` | Done, commit `355ca20` on `main`, pushed to GitHub |
| `VOICE_TOKEN` Fly secret | Set and **deployed** (digest visible in `fly secrets list`) |
| `ANTHROPIC_API_KEY` in prod | Already present (diaper analysis uses it) |
| Prod deploy | Live, machine `started`, health check passing |
| Parent 1 English Shortcut | **Built and working** — spoke a correct confirmation back over Siri |
| Parent 1 Mandarin Shortcut | Not built |
| Parent 2 (both languages) | Not built |
| True hands-free / real-dictation testing | Partially done (P1 English only) |

### Verified in production (assistant-side, all green)
- `/api/health` → `{"ok":true}`; `/api/config` anon → `{"user":null}`
- `/api/voice` no token → 401 + speakable message
- `/api/voice` with **`APP_SECRET`** as bearer → **401** (scoped token works)
- Real `dry:true` round trip with the true token → correct parse, correct
  local time, correct back-dating
- One real Siri round trip on Parent 1's phone spoke the right confirmation

---

## Endpoint contract (so you can reproduce anything)

```sh
curl -s https://<app>.fly.dev/api/voice \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <VOICE_TOKEN>' \
  -d '{"text":"120 ml bottle ten minutes ago","user":"<Parent1>","lang":"en","dry":true}'
```

- Body: `{ text, user, lang?: 'en'|'zh', dry?: bool }`. `user` must match
  `USER_NAMES` exactly. `lang` defaults `en`, selects the confirmation
  language. `dry:true` parses without saving — use it for all testing.
- Response is always `{ ok, saved, speech }`. **The Shortcut only reads
  `speech`.** Every outcome (success, ambiguity, refusal, bad auth, unset
  token) returns a short speakable sentence.
- Get the real `<app>` from `fly.toml` (`app = "..."`), the token from the
  user's password manager / `.env` (`VOICE_TOKEN=`). Never print the token
  into chat — have the user run token-bearing curls, or read it locally.
- **The login rate limiter is separate**; the voice limiter is 30/15min/IP and
  will lock you out during repeated testing — wait or restart the local server.

Model note: runs on `claude-sonnet-5` (thinking off, effort low), **not** Haiku.
Haiku got units right including 斤 but misread clock times ("this morning at
seven" → 7 PM with an evening "now"). Don't switch back to Haiku without
re-checking absolute-time utterances in both languages.

---

## Remaining steps, in order

The build recipe is `docs/siri-voice-logging.md` (committed). Four actions:
Dictate Text → Get Contents of URL (POST, JSON body, Bearer header) → Get
Dictionary Value (key `speech`) → Speak Text. Trigger phrase = the Shortcut's
name.

1. **Parent 1 Mandarin Shortcut.** Duplicate the working English one and flip
   exactly four things: name, Dictate Text **Language** → 中文（普通话）,
   JSON `lang` → `zh`, Speak Text **Language/voice** → Chinese. Nothing else
   changes. On an English-Siri phone the name must stay English-pronounceable
   (e.g. "Baby Chinese"), because Siri only recognizes trigger phrases in the
   device's Siri language.
2. **Parent 2's pair.** Same two Shortcuts on the second phone, with
   `user` = `<Parent2>` (must match `USER_NAMES`). Duplicate Parent 1's and
   change name + `user`; do not edit in place.
3. **AirDrop path (optional, for surprising Parent 2).** Build Parent 2's pair
   on Parent 1's phone with `user` = `<Parent2>`, AirDrop both, they tap
   Accept, first run prompts them to allow the domain. They still need Siri on
   and to know the phrases. Alternative: Share → Copy iCloud Link (puts the
   token on Apple's servers behind an unlisted URL — defensible for a
   create-only token, but rotate if it leaks).
4. **Real hands-free + code-switching tests.** "Hey Siri, <name>" from lock
   screen, Watch, AirPods. Test a mixed-language sentence through real
   dictation — that's the weak link (dictation, not the parser). Confirm each
   Shortcut's Speak voice matches its `lang` (Chinese text through an English
   voice = misconfig, see issues below).
5. **Optional zero-dictation Shortcuts** for the frequent logs — hardcode
   `text` (e.g. "log a wet diaper now" / "记一个尿"), skip the Dictate step.
   Pattern documented in `docs/siri-voice-logging.md`.
6. **Week-1 watch.** Whether clarification questions get annoying (v2 = a
   repeat-until-saved loop in the Shortcut), and API cost (~$0.003/call).

---

## Issues seen so far (and fixes)

- **Reply came back part-Chinese through an English voice** ("tried Mandarin
  first, then English"). Cause: the `speech` string contained Chinese
  characters and the Speak Text voice was English. Two sources: (a) JSON
  `lang` was `zh` on an English Shortcut → whole confirmation is Chinese; fix
  the `lang` field; or (b) it was a **model clarification**, which is written
  in the language of the utterance. Set Speak Text **Language** to a fixed
  language (not Automatic), and match `lang` to it. To tell which: read back
  the on-screen `speech` — starts with 已记录 = case (a); a Chinese *question*
  = case (b).
- **"The network connection was lost."** Transient phone-side drop
  (tethering suspected), not the server — prod was `started`/healthy
  throughout. The parse is ~1.7s, so a flaky link has a window to drop the
  request. Fix: re-run. If it recurs on stable wifi, check whether the
  Shortcut's Get Contents of URL is timing out and whether the Fly machine is
  cold (it shouldn't be — `auto_stop_machines = "off"` is load-bearing).

---

## Spoken-error decoder (each `speech` → cause)

Every failure speaks a fixed line (`SPEECH` table in `server/voice.js`). Map:

| Spoken (en) | HTTP | Cause |
|---|---|---|
| "Voice logging isn't set up." | 200 | `VOICE_TOKEN` unset in the environment |
| "Sorry, that wasn't authorized." | 401 | Wrong/missing Bearer token (or `APP_SECRET` used — intended 401) |
| "I don't know who's logging that." | 400 | `user` not in `USER_NAMES` (typo, or wrong parent's Shortcut) |
| "I didn't hear anything." | 400 | Empty `text` — dictation captured nothing |
| "That was a bit long…" | 400 | `text` > 500 chars |
| "Sorry, I didn't catch that…" | 200 | Parsed to zero events, no clarification |
| "…isn't available right now." | 200 | API/credential failure (check `ANTHROPIC_API_KEY`, Anthropic status) |
| "I couldn't save that…" | 200 | Parsed event failed `validateEvent` |
| "That weight didn't sound right…" etc. | 200 | Out-of-bounds value (`BOUNDS` in voice.js) |
| "Too many requests…" | 429 | Voice rate limiter (30/15min/IP) |
| a *question* | 200 | Model clarification — utterance too ambiguous, nothing saved |

Chinese equivalents are in the same `SPEECH` table, selected by `lang`.

---

## Things NOT to do
- Don't re-scope the token to accept `APP_SECRET` — the whole point is that a
  leaked Shortcut can only create events, not read/export.
- Don't commit real names, app URL, or the token to any tracked file (public
  repo). Run the privacy grep in the skill before any commit.
- Don't add a frontend change — voice rows are ordinary rows; timeline,
  reports, sleep inference, and the nudge timer already pick them up.
- Rotating the token is one line (`fly secrets set VOICE_TOKEN=...`, no
  `--stage`, then update the header in every Shortcut).
