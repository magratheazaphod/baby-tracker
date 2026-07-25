# Voice logging

Two ways to log the baby by voice: an in-app microphone button, and a Siri
Shortcut for hands-free use. Both go through the exact same parser, so a
sentence that logs correctly one way logs correctly the other - they only
differ in how your voice becomes text.

> Tap the mic button - *"半小时前拉了"*
> → *"已记录：尿布（便），下午 2:45。"*
>
> **"Hey Siri, Log Baby"** - *"she just had a hundred and twenty ml bottle"*
> → *"Logged: bottle, 120 ml, 3:15 PM."*

## Which one to reach for

- **In-app mic button** - the default choice. Works in any language,
  including Mandarin and sentences that switch languages mid-thought ("120 ml
  的奶"). Also answers spoken questions ("when did she last eat?"). Needs a
  hand free to tap start and stop.
- **Siri Shortcut** - hands-free: locked screen, Apple Watch, AirPods,
  CarPlay. Reach for it when your hands are full holding the baby. English
  and Mandarin need separate Shortcut copies (see below), and - this part
  matters - only one of those copies actually works correctly when triggered
  by saying "Hey Siri." Read the next section before building a Mandarin
  Shortcut and wondering why it isn't behaving.

## The Siri language problem

**Siri-invoked Shortcuts transcribe in the device's Siri language and ignore
the Dictate Text action's own Language setting.** That setting only takes
effect when the Shortcut is run from the Shortcuts app, the home screen, or a
widget - not when it's triggered by saying "Hey Siri, *\<name>*."

This was confirmed empirically, not assumed: the identical Shortcut, with its
Dictate Text language set to Mandarin, transcribes correctly when you tap its
▶ button, and comes back with English clarification questions when you
trigger it by saying its name to Siri - because Siri handed the model an
English transcription of Mandarin speech.

Practically: **Mandarin dictation cannot work through "Hey Siri" on a phone
whose Siri language is English.** If your household speaks more than one
language, at most one of them gets true hands-free voice logging per phone -
and it's the same reason a Shortcut can't handle a sentence that switches
languages partway through. That's the whole reason the in-app mic button
exists: it has no such restriction, because transcription happens
server-side, off a recorded clip, with automatic language detection and no
`lang` fixed in advance.

Secondary Siri problems, all real but survivable:

- The dictation prompt is loud and can't be quieted programmatically - there's
  no API for Siri's TTS volume.
- Each phone needs its own copy of each Shortcut.
- Distribution is by AirDrop (or an iCloud link) - there's no App Store
  install for a personal Shortcut.

## In-app: the mic button

A full-width **Voice log** button sits at the top of the log grid. Tap to
start recording, tap again to stop; it auto-stops at 20 seconds so a pocket
tap can't record indefinitely. The clip uploads, gets transcribed
server-side, and the resulting text goes through the identical parser the
Shortcut uses - same units, same time handling, same event types, same
multi-event sentences.

It follows the app's existing quick-log rule: the result **saves
immediately**, and a toast offers "tap to edit" (which opens the event's
sheet, whose Delete button is the undo path). A sentence with more than one
event toasts a count instead and opens the timeline.

The button only appears when both are true: the server has a transcription
key configured, and the browser can actually reach a microphone. Otherwise it
stays hidden rather than failing when tapped.

**Server-side transcription, not the browser's built-in speech recognition -
deliberately.** Whisper-class models auto-detect the spoken language and
tolerate code-switching mid-sentence. The browser's Web Speech API takes a
single language per call, which reproduces exactly the Siri limitation above,
and its behavior inside an iOS home-screen PWA is unreliable besides. The
cost of this choice is a second AI vendor, since Claude models don't accept
audio directly.

### Setup

One env var turns the feature on; two more are optional overrides:

```sh
TRANSCRIBE_API_KEY=...                                              # required - unset disables the button
TRANSCRIBE_URL=https://api.groq.com/openai/v1/audio/transcriptions  # default shown
TRANSCRIBE_MODEL=whisper-large-v3-turbo                             # default shown
```

`TRANSCRIBE_URL`/`TRANSCRIBE_MODEL` exist so switching vendors is two env
vars, not a code change - Groq and OpenAI both expose the same
`/v1/audio/transcriptions` multipart shape. No `language` parameter is ever
sent to the vendor; auto-detection is the entire point. `ANTHROPIC_API_KEY`
still has to be set too, same as for the Shortcut - it's the model that
parses the transcript into events, shared by both paths.

### Audio isn't kept

The recorded clip lives in memory for the one request, goes to the
transcription vendor, and is dropped. It is never written to disk and never
logged - not the audio, and not the transcript, beyond being handed back to
the parent who spoke it so they can see what was heard if the parse fails.

### Spoken questions

The same button answers questions as well as logging - the parser decides
which an utterance is. Supported: last feed (optionally "was it a breastfeed"
or "a bottle"), last diaper (optionally wet or dirty), today's totals, and
the latest weight/height/head measurement with its WHO percentile.

The model only ever picks a question **type** from a fixed list; it never
states a number itself. Every figure spoken back is computed by the server
from the database - the same `HOME_TZ` day boundary the Reports view uses,
the same WHO growth tables the charts use - so an answer can never disagree
with what the app's own screens show.

**Sleep questions aren't supported.** "How long has she been asleep?" gets a
plain "I can't answer that one yet." The sleep inference currently lives in
the client, not the server, and porting it is a bigger job than the rest of
this feature.

Questions are answered **in-app only** - see Security below for why.

## Hands-free: the Siri Shortcut

A PWA can't register Siri intents, so this half is a personal Shortcut you
build once per device. It dictates text, POSTs it to `/api/voice`, and speaks
the `speech` string that comes back.

### Server setup (once)

`/api/voice` is off unless both of these are set:

- `ANTHROPIC_API_KEY` - already needed for diaper-photo analysis (and for the
  in-app button above).
- `VOICE_TOKEN` - a new secret, **not** `APP_SECRET`. Generate something long
  and random (`openssl rand -hex 32`).

```sh
fly secrets set -a your-app-name --stage VOICE_TOKEN="$(openssl rand -hex 32)"
fly deploy --ha=false
```

Locally, put `VOICE_TOKEN=...` in `.env` and restart.

Check it before touching the phone:

```sh
curl -s https://your-app.example/api/voice \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer YOUR_VOICE_TOKEN' \
  -d '{"text":"120 ml bottle twenty minutes ago","user":"YourName","lang":"en","dry":true}'
```

`dry: true` parses and reports what *would* be saved without writing anything -
use it while you're getting the Shortcut right.

### Build the Shortcut

In the Shortcuts app, create a new shortcut with four actions:

1. **Dictate Text** - *Stop Listening*: **After Pause**. Set **Language**
   explicitly (English, or 中文（普通话）- see the pair below).
2. **Get Contents of URL** - `https://your-app.example/api/voice`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_VOICE_TOKEN`
   - Request Body: **JSON**
     - `text` (Text) = the *Dictated Text* variable
     - `user` (Text) = `YourName` - must match one of `USER_NAMES` exactly
     - `lang` (Text) = `en` or `zh`

   Instead of `user`, you can send `device` and let the server work out who
   that is - see below. It's worth it as soon as there's a second phone.
3. **Get Dictionary Value** - Key `speech`, from *Contents of URL*.
4. **Speak Text** - the *Dictionary Value*. Set **Language/voice** to match
   `lang`.

**The trigger phrase is just the Shortcut's name** - "Hey Siri, *<name>*" - so
rename it to whatever feels natural. Avoid single common words like "Log" that
collide with built-ins, and say the phrase out loud to confirm it actually
triggers before settling on it.

### One Shortcut for every phone

Hardcoding `user` means each phone needs its own edited copy, and a copy that
kept the original's name logs silently under the wrong parent - a mistake
nobody notices until they read the timeline weeks later. Instead, let the
Shortcut say which phone it's running on:

1. Add **Get Device Details** → *Device Name* before the request.
2. In the JSON body, replace `user` with `device` (Text) = that variable.
3. Tell the server whose phone is whose:

```sh
fly secrets set -a your-app-name --stage DEVICE_USERS="Phone One:Alex,Phone Two:Sam"
fly deploy --ha=false
```

Read each phone's exact name from **Settings → General → About → Name**. Case,
spacing and curly-vs-straight apostrophes are all normalized, so `Alex’s
iPhone` and `alex's iphone` both match.

Now every copy is byte-identical: AirDrop it and it identifies its owner by
the phone it's running on. If a phone isn't in the map it says *"I don't know
whose phone this is"* rather than guessing. Rename a phone and you'll hear
that - update the secret to match.

`user` still wins when both are sent, so Shortcuts built before this keep
working untouched.

### One Shortcut per language, per phone

Siri and the Dictate Text action are each locked to a single language, and - as
covered above - the trigger phrase itself only works in the device's Siri
language. So each phone gets a **pair** of Shortcuts that differ only in name,
dictation language, `lang`, and Speak Text voice:

| | English | Mandarin |
|---|---|---|
| Name / trigger | "Log Baby" | "Baby Chinese" |
| Dictate Text language | English | 中文（普通话） |
| `lang` in the body | `en` | `zh` |
| Speak Text voice | English | Chinese |

Build one, duplicate it, flip those four things.

Saying the trigger phrase *is* the language switch - no settings change
mid-feed, and Siri's own device language never has to change. On an
English-Siri phone both names must be English-pronounceable, which is why the
Mandarin one above is called "Baby Chinese" rather than 中文.

**Code-switching within one sentence:** English dictation won't transcribe
Chinese at all, and Mandarin dictation tolerates common embedded English words
but garbles full English phrases. The parser handles mixed *text* fine -
dictation is the weak link, for the reasons in "The Siri language problem"
above. Speak mostly one language per utterance and pick the matching
Shortcut, or use the in-app mic button, which has no such limit.

### Optional: zero-dictation Shortcuts

For the logs you make most often, skip the Dictate step entirely and hardcode
`text`. These are a single utterance with no dictation pause:

- Name it "Wet Diaper", `text` = `log a wet diaper now`, `lang` = `en`
- Name it "尿布" (on a Chinese-Siri phone), `text` = `记一个尿`, `lang` = `zh`

Everything else in the Shortcut is identical.

## What it understands

Shared by both paths - the mic button and the Shortcut hit the same parser.
Anything the app can log except photos: breastfeeds, bottles (formula or
pumped breastmilk), pumping sessions, diapers, weight, height, head
circumference, milestones.
Up to three events in one sentence.

- **Times** - "twenty minutes ago", "this morning at seven", 刚刚, 半小时前.
  Anything more than 24 hours back is refused; edit those in the app.
- **Units** - ounces, pounds, inches, 毫升, 盎司, 公斤, 斤, 两, 厘米 all convert
  automatically. Bottle amounts with no unit: 15 or under is read as ounces, 30
  or more as millilitres; in between it asks rather than guessing.
- **Breastfeeding has no left/right field** by design. Mention a side and it
  goes in the notes.
- **Multiple events** - "90 ml and a wet diaper" logs both.
- If a value looks implausible (a mis-heard weight, say), nothing is saved and
  the response says so.
- If a sentence is too ambiguous, nothing is saved and it asks a follow-up
  question instead. There's no back-and-forth yet - just say the whole thing
  again.

Because voice bypasses the app's last-logged-time buttons, a second log of the
same type within ten minutes still saves but adds a note ("…note, a
bottle was also logged 3 minutes ago"). That covers both a retry after a
dropped response and both parents logging the same feed. Fix genuine
double-logs in the app.

## Security

**Shortcut token.** The Shortcut contains your app URL and the voice token.
Both are credentials - don't screenshot a real one, and don't share the
Shortcut outside the family. The token is scoped so a leaked Shortcut can only
*create validated events* on this one endpoint: it cannot read the timeline,
download photos, hit `/api/export`, or answer a spoken question - a question
sent with the Shortcut's token gets a fixed refusal rather than an answer.
Rotating the token is one line:

```sh
fly secrets set -a your-app-name VOICE_TOKEN="$(openssl rand -hex 32)"
```

then update the header in each Shortcut.

**In-app mic button.** It rides the same login cookie as the rest of the app
- only a signed-in parent can record a clip or ask a question. There's no
separate token to leak, and no way to reach it from outside a logged-in
session. This is also why questions are answered in-app only and refused on
the Shortcut's token: the token's create-only scope is exactly why a leaked
Shortcut is survivable, and answering questions on it would widen that scope
into a read.

## Where it works

**Shortcut:** anywhere Siri works - locked screen, Apple Watch, AirPods,
CarPlay. "Run When Locked" isn't needed - Siri invocation handles it.

**Mic button:** anywhere you have the app open with a microphone available,
including the installed home-screen PWA - it just needs a hand free to tap it.
