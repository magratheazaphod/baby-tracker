# Handoff: hands-free voice logging via Siri + Shortcuts

**Status**: planned, not started.
**Recommended implementer**: Opus-class model (`claude-opus-4-8`) at **medium** effort.
Sonnet 5 at **high** effort is an acceptable substitute — the design below is
fully specified, so the work is careful execution rather than open-ended design.
The two judgment-heavy spots (the parser prompt, and the sanity-bounds table)
are written out in this doc; don't reinvent them.

**Read `.claude/skills/baby-tracker/SKILL.md` first** — especially the privacy
section. This repo is public; this doc and all committed code must contain only
placeholder names/URLs. Real values live in `.env` and Fly secrets.

---

## Goal

A parent says a custom trigger phrase to Siri on a phone/watch/AirPods (e.g.
**"Hey Siri, Log Baby"** or **"嘿 Siri，记一笔"**), dictates a sentence in
English or Mandarin ("she just had a hundred and twenty em el bottle", "wet
diaper about twenty minutes ago", "瓶喂一百二十毫升", "半小时前拉了"), and the
event lands in the tracker with no touch at all. Siri speaks back a
confirmation in the same language ("Logged: bottle, 120 ml, 3:15 PM." /
"已记录：瓶喂 120 毫升，下午 3:15。"). Both parents are bilingual and may use
either language at any time — the trigger phrase selects the language per
utterance (see Part 2). Mandarin support is a first-class
requirement, not a nice-to-have.

## Approach (decided — don't redesign)

A PWA cannot register Siri intents, so the iOS half is a **personal Shortcut**
(Shortcuts app), invoked by name via Siri. The Shortcut dictates text and POSTs
it to a new server endpoint; the **server** parses the utterance into structured
events with the Claude API (the Anthropic SDK is already a dependency and
`ANTHROPIC_API_KEY` is already configured — see `server/analyze.js` for the
existing usage pattern), validates, inserts, and returns a `speech` string the
Shortcut speaks aloud.

Why server-side parsing instead of Shortcut-side regex: utterances are messy
("half an ounce shy of four", "poopy diaper this morning around seven"), and
the server already has the key, the event schema, and the timezone.

## Part 1 — server endpoint

### Route: `POST /api/voice` (in `server/index.js`)

- **Auth**: cookie OR `Authorization: Bearer <VOICE_TOKEN>` — a **new,
  separate secret** (env var + Fly secret), NOT `APP_SECRET`. Shortcuts can't
  hold the login cookie, so bearer is the path they'll use, and the token
  ends up baked into Shortcuts that sync through iCloud and get casually
  AirDropped/shared. `APP_SECRET` guards everything including `/api/export`
  (full DB + photos); the voice token must only be able to *create validated
  events* on this one endpoint. Compare with the same `timingSafeEqual`
  pattern as `secretOk`. If `VOICE_TOKEN` is unset, the endpoint returns
  `{ok: false, speech: "Voice logging isn't set up."}` — never fall back to
  accepting `APP_SECRET`, or the scoping is theater. Document the new secret
  in the setup docs and set it with `fly secrets set --stage`.
- **Rate limit**: this is a new brute-forceable surface that also burns API
  tokens. Reuse the `loginRateLimit` pattern (per-IP budget/window) with its
  own Map — generous enough for real use (say 30/15 min/IP) since parents may
  log a dozen times a day but never 30 in 15 minutes.
- **Body**: `{ text: string, user: string, lang?: 'en' | 'zh', dry?: boolean }`.
  - `user` must be in `USER_NAMES` (each parent's Shortcut has their own name
    baked in) → becomes `created_by`. Reject unknown users with 400.
  - `lang` (default `'en'`) selects the language of the confirmation `speech`.
    It is a per-Shortcut setting, not model-detected: it must match the
    Shortcut's Speak Text voice, and a parent who code-switches mid-sentence
    still wants replies in one consistent language.
  - `text` capped at ~500 chars.
  - `dry: true` parses and returns what *would* be saved without inserting —
    for curl testing and Shortcut debugging.
- **Response**: always `{ ok, saved: [events...], speech: string }`. The
  Shortcut only ever reads `speech`, so every outcome — success, ambiguity,
  parse failure, missing API key — must produce a short speakable sentence
  (e.g. "Sorry, I didn't catch that — try again with the amount and event
  type."). Never return a bare error the Shortcut would read as JSON noise.

### Parser: new file `server/voice.js`

Mirror `server/analyze.js` conventions (module-level `new Anthropic()`,
credentials resolve at request time, graceful failure).

- **Model**: `claude-haiku-4-5-20251001` — this is a latency-sensitive
  structured-extraction task; the parent is standing there waiting for Siri to
  answer. If accuracy disappoints in testing — check the Mandarin half of the
  test matrix specifically, especially 斤/两 conversions — step up to `claude-sonnet-5`
  with `thinking: {type: 'disabled'}, output_config: {effort: 'low'}` (the
  analyze.js pattern).
- **Structured output**: force a tool call (`tool_choice: {type: 'tool', name:
  'log_events'}`) with this schema:

  ```
  events: array (max 3) of {
    type:        'breastfeed' | 'formula' | 'diaper' | 'weight' | 'height' | 'head' | 'milestone'
    kind:        diaper: 'pee'|'poop'|'both';  formula: 'formula'|'breastmilk'
    duration_min, amount_ml, weight_g, height_cm, head_cm: number (canonical units)
    minutes_ago: integer ≥ 0 (0 = now)
    notes:       string (anything extra the parent said, e.g. "she was fussy")
  }
  clarification: string — set INSTEAD of events when the utterance is too
                 ambiguous to log safely; phrased as a question to speak back
  ```

- **Prompt must cover** (all learned from this family's actual usage):
  - **Utterances may be in English, Mandarin, or a mix**, and both languages
    are first-class. The schema output is language-independent;
    only the parsing prompt needs to handle both. Cover the common Mandarin
    vocabulary explicitly: 喂奶/亲喂/母乳 → breastfeed; 瓶喂/奶瓶 → bottle
    (配方奶 → kind formula, 母乳瓶喂/挤出来的奶 → kind breastmilk);
    尿/尿了 → pee, 便便/大便/拉了 → poop, 都有/又尿又拉 → both; 体重 →
    weight; 身高/身长 → height; 头围 → head; 里程碑/第一次… → milestone.
  - Current local time in `HOME_TZ` (so "this morning at seven" or
    "今天早上七点" → `minutes_ago`; also 刚才/刚刚 → 0, 半小时前 → 30).
    Compute with `Intl.DateTimeFormat` like the reports code.
  - Unit conversion to canonical: oz → ml (×29.57), lb/oz → g, inches → cm.
    Parents in the US will say ounces and pounds. Chinese units too:
    毫升 → ml, 盎司 → oz → ml, 公斤 → ×1000 g, **斤 → ×500 g** (a common
    unit for baby weight in Chinese — easy to garble into kg or lb if the
    prompt doesn't call it out), 两 → ×50 g, 厘米/公分 → cm. Numbers may
    arrive as Chinese numerals ("一百二十毫升") depending on how dictation
    renders them.
  - **Bottle amounts are always mL or oz in this household** (either
    language — "a hundred and twenty", 一百二十毫升, "four ounces", 四盎司).
    That licenses a disambiguation rule for unit-less bottle numbers:
    ≤ 15 → ounces, ≥ 30 → mL; in between, ask via `clarification` rather
    than guess.
  - `formula` type means *any bottle*; `kind` says what was in it
    ('breastmilk' for pumped milk). "Bottle" with no contents mentioned →
    `kind: 'formula'`.
  - **Breastfeeding has no side (left/right) field** — deliberate product
    decision. If a side is mentioned, put it in `notes`, don't invent a field.
  - "Wet" → pee, "dirty"/"poopy" → poop, "wet and dirty" → both.
  - Multiple events in one utterance are normal ("90 ml and a wet diaper").
  - Milestones: "log a milestone: first smile" → `type: 'milestone'`, the
    description in `notes` (validation requires non-empty notes).
  - No `photo` type via voice.
  - Do **not** embed the baby's name or any personal string in the committed
    prompt; if age/name context helps, inject from env at runtime like
    `babyAgeLine()` in analyze.js.

- **Server-side sanity bounds** (voice adds unit-mishap risk — a mis-parse
  could write `weight_g: 7` from "seven pounds"). After the model returns,
  and after the existing `validateEvent`, reject any event outside:

  | field | bounds |
  |---|---|
  | `amount_ml` | 10–400 |
  | `duration_min` | 1–90 |
  | `weight_g` | 1500–15000 |
  | `height_cm` | 40–100 |
  | `head_cm` | 25–60 |
  | `minutes_ago` | 0–1440 (older edits go through the app) |

  Out-of-bounds → save nothing, `speech` explains ("That weight didn't sound
  right — try again with pounds or grams."). All-or-nothing per utterance:
  if any parsed event fails validation, insert none (partial saves are
  confusing to un-do by voice).

- **Insert path**: reuse the existing `insertEvent(type, body, user)` — do not
  write new SQL. `occurred_at` = now minus `minutes_ago`, as UTC ISO.
- **Near-duplicate warning** (voice bypasses the app's last-logged-time UI,
  and a lost response tempts a retry after the insert already happened):
  before inserting, check for an existing event of the same type within the
  last 10 minutes. If found, still insert (warn, don't block — clusters like
  pee-then-poop are legitimate) but append it to the speech: "…note, a
  bottle was also logged 3 minutes ago." / "…注意：3 分钟前也记过一次瓶喂。"
  This covers both the retry-after-timeout duplicate and the
  two-parents-log-the-same-feed case.
- **Confirmation speech is deterministic server code, not model output** — the
  parent must be able to trust it verbatim. Format per event: type, key
  quantity, and time in `HOME_TZ` ("Logged: bottle, 120 ml, 3:15 PM." /
  "Logged: wet diaper, just now."). Join multiple events with "and".
  Templates exist in **both languages**, selected by the request's `lang`
  (zh examples: "已记录：瓶喂 120 毫升，下午 3:15。" / "已记录：尿布（尿），
  刚刚。"). Every speakable string — confirmations, clarifications, error
  speech, out-of-bounds refusals — goes through the same bilingual template
  table; grep for hardcoded English before calling it done. Clarification
  questions come from the model: instruct it to write `clarification` in the
  language of the utterance.
- **No API key / API error** → `{ok: false, speech: "Voice logging isn't
  available right now."}` (zh per `lang`), HTTP 200 (the Shortcut should
  still speak it).

### No DB migration, no frontend changes

Voice-created events are ordinary rows (`created_by` = the parent). The
timeline, reports, sleep inference, and nudge timer all pick them up for free.
Optionally verify the nudge timer resets on a voice-logged feed (it keys off
feed/diaper events — it should just work).

## Part 2 — the Shortcut (document, don't code)

Write `docs/siri-voice-logging.md` (committed, placeholder values only) walking
a parent through building it once per phone:

1. **Dictate Text** (stop listening: "after pause"; **Language** set
   explicitly — see per-parent setup below)
2. **Get Contents of URL** — POST `https://<your-app>.example/api/voice`,
   Request Body JSON: `text` = Dictated Text, `user` = `<YourName>`,
   `lang` = `en` or `zh`; Header `Authorization` = `Bearer <your VOICE_TOKEN>`
3. **Get Dictionary Value** — key `speech`
4. **Speak Text** — the dictionary value (**Language/voice** matching `lang`)

- **The trigger phrase is simply the Shortcut's name** — "Hey Siri,
  <Shortcut name>" — so it's fully customizable per device: rename the
  Shortcut to whatever feels natural and the phrase follows. Avoid single
  common words ("Log") that collide with built-ins, and test the chosen name
  actually triggers before settling. One constraint: **Siri only recognizes
  phrases in the device's Siri language**, so on an English-Siri phone both
  trigger phrases must be English-pronounceable (a Chinese-named Shortcut
  won't trigger reliably there, and vice versa).
- **Language is chosen per utterance by which Shortcut you invoke.** Siri
  and the Dictate Text action are each locked to a single language — iOS has
  no mixed English↔Chinese mode — so bilingual parents get a **pair of
  Shortcuts on each phone**: one with English dictation + `lang: en` +
  English Speak voice (e.g. "Hey Siri, Log Baby"), one with 中文（普通话）
  dictation + `lang: zh` + a Chinese Siri voice (e.g. "Hey Siri, Baby
  Chinese" on an English-Siri phone). Saying the trigger phrase *is* the
  language switch; no settings change mid-use, and Siri's own device
  language never needs to change. Both Shortcuts differ only in those three
  settings and the name — build one, duplicate, flip.
- **Set expectations on code-switching within one utterance**: English
  dictation will not transcribe Chinese at all; Mandarin dictation tolerates
  common embedded English words but garbles full English phrases. The
  parser handles mixed *text* fine — dictation is the weak link, so speak
  mostly one language per utterance and pick the matching Shortcut.
- **Optional zero-dictation variants**: extra Shortcuts with a hardcoded
  `text` instead of the Dictate step ("log a wet diaper now" / "记一个尿").
  Named per event ("Hey Siri, 尿布" / "Hey Siri, Wet Diaper"), they make the
  most frequent logs a single utterance with no dictation pause. Cheap to
  add since they hit the same endpoint; document the pattern with one
  example.
- **Run when locked** isn't needed for Siri invocation, but note dictation
  works from lock screen, Apple Watch, AirPods, and CarPlay — that's the
  hands-free win.
- Warn: the Shortcut contains the app URL and the voice token — never
  screenshot the real one for the README; use the demo-instance rules in the
  project skill. (The token is deliberately scoped so a leaked Shortcut can
  only create events, not read or export anything — but treat it as a
  credential all the same, and note it's a one-line
  `fly secrets set` to rotate.)

## Part 3 — verification (manual; no test suite exists)

1. `npm start`, then curl the endpoint with `dry: true` through a matrix of
   utterances — at minimum: each event type; oz→ml and lb→g conversion;
   unit-less bottle numbers ("she had four" → ~118 ml, "took 120" → 120 ml,
   "had 20" → expect `clarification`, not a guess);
   "X minutes ago" and "this morning at 7"; a two-event utterance; a nonsense
   utterance (expect `clarification`, nothing saved); an out-of-bounds value
   (expect refusal speech); wrong bearer (401); `APP_SECRET` as bearer
   (**must also 401** — the scoped token is the point); `VOICE_TOKEN` unset
   (speakable "isn't set up" reply); unknown user (400); two same-type logs
   minutes apart (second reply carries the duplicate warning).
   **Run the same matrix in Mandarin** with `lang: 'zh'`: 喂奶十五分钟 /
   瓶喂一百二十毫升 / 半小时前拉了 / 体重六斤半 (expect 3250 g — the 斤
   conversion is the likeliest silent failure) / 今天早上七点尿了 / a
   mixed-language utterance — and confirm every `speech` reply, including
   clarifications and refusals, comes back in Chinese.
   Remember zsh curl quirks and the 20/15min login limiter notes in the skill.
2. Re-run the best cases without `dry`, confirm rows via `GET /api/events`
   and that the timeline renders them normally.
3. Build the real Shortcut pair against the local server (phone on same
   network or against prod after deploy) and do true hands-free runs in
   **both languages on each phone**, confirming each Shortcut's Speak Text
   voice matches its `lang` (Chinese `speech` through an English voice means
   the `lang` plumbing or the Shortcut's voice setting is wrong). Test the
   code-switching reality through real dictation, not typed curl input —
   that's where mixed-language utterances actually degrade.
4. Privacy audit per the skill (grep for real names/secret/app URL in
   committable files) **before every commit** — this feature touches docs and
   prompts, the two easiest places to leak.
5. Deploy per the skill (`fly deploy --ha=false`); confirm
   `ANTHROPIC_API_KEY` is present in `fly secrets list` (diaper analysis
   already uses it in prod, so it should be); post-deploy check
   `/api/config` → `{"user":null}` and a real voice log round-trip.

## Explicit non-goals (v1)

- No multi-turn clarification loop (Siri asks → parent answers). If the
  clarification speech proves annoying in practice, v2 can wrap the Shortcut
  in a repeat-until-saved loop with "Ask for Input (Siri asks)".
- No editing/deleting by voice — mis-logs are fixed in the app (every entry
  time is editable there).
- No hard dedup/blocking of double-logs — the near-duplicate spoken warning
  is deliberate warn-don't-block; genuine fixes happen in the app.
- No on-device/offline parsing.
