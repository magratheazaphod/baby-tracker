# In-app voice logging - decision record

**This is a record of why the code looks the way it does, not a tutorial.**
For how to use the feature, see `docs/siri-voice-logging.md`. For the Siri
Shortcut half this builds alongside, see
`docs/plans/siri-voice-logging-handoff.md`. This doc replaces
`docs/plans/in-app-voice-logging-handoff.md`, which was the design handoff
written before any of this was built; that handoff's "Decisions already made"
section is expanded below into full reasoning.

---

## Why this exists

Voice logging shipped first as a Siri Shortcut. A night of real testing on
that feature turned up a finding that disqualifies it for part of the
household:

> **Siri-invoked Shortcuts transcribe in the device's Siri language and
> ignore the Dictate Text action's own Language setting.** That setting only
> applies when the Shortcut is run from the Shortcuts app, home screen, or a
> widget - not when triggered by "Hey Siri."

Confirmed empirically, not assumed: the identical Shortcut, dictation
language set to Mandarin, works correctly when run by tapping ▶ and fails
through Siri, coming back with English clarification questions - because
Siri handed the model an English transcription of Mandarin speech. The
household speaks six languages. Siri handles one at a time, per device, and
only recognizes the trigger phrase itself in the device's own Siri language.
So Mandarin dictation cannot work through "Hey Siri" on an English-Siri
phone, full stop - there's no Shortcut configuration that fixes this.

Secondary Siri problems, all real but survivable: the dictation prompt is
loud and can't be quieted programmatically (no API for Siri's TTS volume);
each phone needs its own Shortcut copy; distribution is by AirDrop.

An in-app mic button fixes all of that except hands-free operation - which
remains genuinely useful (holding the baby, hands full) and stays the
Shortcut's job. The two paths are complementary, not a replacement of one by
the other.

---

## Decisions already made (and why)

**Server-side transcription, not the browser's Web Speech API.**
Whisper-class models auto-detect the spoken language and tolerate
code-switching mid-sentence. Web Speech takes a single `lang` per call, which
would reproduce exactly the Siri limitation this feature exists to escape,
and its support inside an iOS home-screen PWA is unreliable on top of that.
The cost: a second AI vendor, since Claude models don't accept audio - the
parser that turns transcript into events still runs on Claude, only the
speech-to-text step moves to a different vendor.

**Vendor behind an OpenAI-compatible env shim, not a hardcoded SDK.** Groq and
OpenAI both expose `/v1/audio/transcriptions` with the identical multipart
shape, so `server/transcribe.js` targets that shape generically rather than
importing either vendor's SDK. Switching vendors, or pointing at a
self-hosted Whisper endpoint, is two env vars (`TRANSCRIBE_URL`,
`TRANSCRIBE_MODEL`), not a code change. The cost is modest: no
vendor-specific error handling or retry behavior, just a fetch and a status
check.

**No `language` parameter ever sent to the transcription vendor.**
Auto-detection is the entire point of building this path at all. Sending a
language hint would just reintroduce the Siri constraint one layer down.

**Audio is never persisted.** The clip is transient in memory for the one
request, sent to the vendor, and dropped - never written to disk, never
logged, not even the endpoint's own multer buffer touching a file path. This
is family audio in a house with a newborn; the cost of this decision is that
a failed parse can't be replayed for debugging without asking the parent to
say it again, which is an acceptable trade against keeping a standing archive
of recorded speech.

**Save immediately, toast to undo - no confirm step.** Matches
`quickDiaper()`'s existing rule and the repo's ≤2-taps-at-3am spirit. The
event's own sheet already has a Delete button, so a second, feature-specific
undo path would just be a redundant piece of UI to maintain. Multiple events
in one sentence toast a count and open the timeline instead of the sheet,
since there's no single event to point "tap to edit" at.

**The button is gated on two independent conditions, not one.** It's hidden
unless the server has a transcription key configured *and* the browser can
reach a microphone. Either check alone is insufficient: a configured server
with no mic (desktop browser, insecure context) would show a button that
fails on tap; a capable browser with no server key would do the same in the
other direction. Failing silently by hiding the button costs nothing, since
the Shortcut remains available regardless.

**Rate limit changed from 30/15min/IP to 60/15min, keyed on the logged-in
parent with IP as fallback.** The old ceiling assumed one Shortcut call
pattern per household IP. Two things broke that assumption: both parents
share home wifi, so an IP-keyed limit was really a household-wide limit even
before this feature; and the in-app button turns voice into a plausible
*primary* way to log, not an occasional Shortcut invocation, so the same
budget needs more headroom. Keying on the parent when there is one (rather
than IP alone) also means one parent's heavy usage doesn't visibly throttle
the other.

**Spoken questions are answered in-app only, never on the Shortcut's token.**
The Shortcut's `VOICE_TOKEN` is deliberately scoped to create events and
nothing else - that's the property that makes a leaked Shortcut survivable,
since it can spam junk rows but can't read the timeline, download photos, or
hit `/api/export`. Answering a question requires *reading* data, which would
quietly widen that scope. So a question arriving on the token gets a fixed
spoken refusal instead of an answer, and questions only resolve on a
cookie-authenticated request - i.e., from the mic button, from a parent who
is actually logged into a real session. This was worth a small user-facing
inconsistency (the Shortcut can log but can't answer "how much did she eat
today?") to keep the security property intact rather than relaxing it for
convenience.

**The model classifies; the server computes.** The same discipline that
governs event parsing extends to questions: the model's only job is to pick
an intent off a fixed list (`last_feed`, `last_diaper`, `totals_today`,
`latest_measurement`, `unsupported`) and, for feed/diaper/measurement
questions, which sub-kind was asked about. It never states a number. Every
figure that gets spoken back - a feed time, a diaper count, a percentile - is
computed by the server from the database, reusing the exact `HOME_TZ` day
boundary the Reports view uses and the exact WHO LMS tables the growth charts
use. The alternative (let the model read the number off retrieved rows and
say it) would make a hallucinated figure indistinguishable from a real one in
what's spoken back, which is not an acceptable failure mode for numbers a
parent might act on.

**Sleep questions are deliberately unsupported, not attempted.** "How long
has she been asleep?" always gets a plain refusal. The sleep interval
inference currently lives client-side in `public/app.js` (asleep-between-feeds
logic, awake-override toggles), not on the server, and there's no server-side
equivalent to query. Porting that logic to the server to support one spoken
intent was judged a bigger job than the rest of this feature combined, so it
was scoped out rather than half-built.

**The reply language is read from the transcript's own script, never from a
client field.** There's no language picker in the UI, because declaring one
up front would be exactly the Siri limitation this feature exists to escape.
Instead, Han characters anywhere in the transcript mean the reply comes back
in Chinese (`scriptLang()` in `server/voice.js`); otherwise it's English. A
code-switched sentence like "120 ml 的奶" is treated as Chinese, matching what
the parent who said it would expect to read back.

---

## Known limitations, written down rather than solved

- **No offline support.** Recording without a network connection loses the
  utterance - there's no local queue-and-retry.
- **The 20-second recording cap is a guess.** It exists so a pocket tap can't
  record indefinitely, not because 20 seconds is a measured right answer.
- **Mandarin numeral accuracy through Whisper is unmeasured.** Chinese
  numerals for baby weight (斤, 两) and volumes are exactly the kind of value
  where a mis-transcription is silent bad data, and this hasn't been
  systematically checked against real speech yet - only spot-tested.
- **Rate limit (60/15min, keyed on parent with IP fallback) is a guess**, same
  as the old 30/15min/IP was. It hasn't been checked against real household
  usage once the button is the default logging path rather than a novelty.
- **Sleep questions are unsupported** - see above; this is a scope decision,
  not a bug.
- **Not hands-free.** This was never the goal; the Shortcut remains the only
  hands-free path and this feature doesn't compete with it.

---

## Open questions for whoever picks this up next

- **Measure Mandarin numeral accuracy.** Run a set of real Mandarin
  utterances with weights/volumes through the button, compare transcript to
  intent, and decide whether Whisper's error rate on 斤/两/毫升 numerals is
  acceptable as-is or needs a mitigation (e.g., a plausibility nudge in the
  prompt, or surfacing the raw transcript more prominently on save so a
  mis-hearing is easy to catch).
- **Is 20 seconds the right cap?** Revisit once there's evidence of real
  sentences getting truncated - or evidence that they never do, which would
  argue for leaving it alone.
- **Should sleep questions move server-side?** The inference exists and
  works client-side; the question is whether the effort to port it is worth
  unlocking the one spoken intent it would enable, versus other priorities.
- **Should the rate limit be revisited?** 60/15min/parent-or-IP was a
  reasoned guess, not a measurement. Once there's real usage data (both
  parents actually logging by voice regularly), check whether it's
  comfortably above real usage or occasionally getting hit.
