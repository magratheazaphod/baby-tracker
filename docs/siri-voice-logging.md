# Hands-free voice logging with Siri

Say a phrase to Siri on your phone, watch, or AirPods, dictate a sentence in
English or Mandarin, and the entry lands in the tracker — no screen, no taps.
Siri reads a confirmation back in the same language.

> **"Hey Siri, Log Baby"** — *"she just had a hundred and twenty ml bottle"*
> → *"Logged: bottle, 120 ml, 3:15 PM."*
>
> **"Hey Siri, Baby Chinese"** — *"半小时前拉了"*
> → *"已记录：尿布（便），下午 2:45。"*

A PWA can't register Siri intents, so the phone half is a personal Shortcut you
build once per device. It dictates text, POSTs it to `/api/voice`, and speaks
the `speech` string that comes back.

## Server setup (once)

`/api/voice` is off unless both of these are set:

- `ANTHROPIC_API_KEY` — already needed for diaper-photo analysis.
- `VOICE_TOKEN` — a new secret, **not** `APP_SECRET`. Generate something long
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

`dry: true` parses and reports what *would* be saved without writing anything —
use it while you're getting the Shortcut right.

## Build the Shortcut

In the Shortcuts app, create a new shortcut with four actions:

1. **Dictate Text** — *Stop Listening*: **After Pause**. Set **Language**
   explicitly (English, or 中文（普通话）— see the pair below).
2. **Get Contents of URL** — `https://your-app.example/api/voice`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_VOICE_TOKEN`
   - Request Body: **JSON**
     - `text` (Text) = the *Dictated Text* variable
     - `user` (Text) = `YourName` — must match one of `USER_NAMES` exactly
     - `lang` (Text) = `en` or `zh`
3. **Get Dictionary Value** — Key `speech`, from *Contents of URL*.
4. **Speak Text** — the *Dictionary Value*. Set **Language/voice** to match
   `lang`.

**The trigger phrase is just the Shortcut's name** — "Hey Siri, *<name>*" — so
rename it to whatever feels natural. Avoid single common words like "Log" that
collide with built-ins, and say the phrase out loud to confirm it actually
triggers before settling on it.

## One Shortcut per language, per phone

Siri and the Dictate Text action are each locked to a single language — iOS has
no mixed English↔Chinese mode. So each phone gets a **pair** of Shortcuts that
differ only in name, dictation language, `lang`, and Speak Text voice:

| | English | Mandarin |
|---|---|---|
| Name / trigger | "Log Baby" | "Baby Chinese" |
| Dictate Text language | English | 中文（普通话） |
| `lang` in the body | `en` | `zh` |
| Speak Text voice | English | Chinese |

Build one, duplicate it, flip those four things.

Saying the trigger phrase *is* the language switch — no settings change
mid-feed, and Siri's own device language never has to change. One constraint:
**Siri only recognizes phrases in the device's Siri language.** On an
English-Siri phone both names must be English-pronounceable, which is why the
Mandarin one above is called "Baby Chinese" rather than 中文.

**Code-switching within one sentence:** English dictation won't transcribe
Chinese at all, and Mandarin dictation tolerates common embedded English words
but garbles full English phrases. The parser handles mixed *text* fine —
dictation is the weak link. Speak mostly one language per utterance and pick
the matching Shortcut.

## Optional: zero-dictation Shortcuts

For the logs you make most often, skip the Dictate step entirely and hardcode
`text`. These are a single utterance with no dictation pause:

- Name it "Wet Diaper", `text` = `log a wet diaper now`, `lang` = `en`
- Name it "尿布" (on a Chinese-Siri phone), `text` = `记一个尿`, `lang` = `zh`

Everything else in the Shortcut is identical.

## What it understands

Anything the app can log except photos: breastfeeds, bottles (formula or
pumped breastmilk), diapers, weight, height, head circumference, milestones.
Up to three events in one sentence.

- **Times** — "twenty minutes ago", "this morning at seven", 刚刚, 半小时前.
  Anything more than 24 hours back is refused; edit those in the app.
- **Units** — ounces, pounds, inches, 毫升, 盎司, 公斤, 斤, 两, 厘米 all convert
  automatically. Bottle amounts with no unit: 15 or under is read as ounces, 30
  or more as millilitres; in between it asks rather than guessing.
- **Breastfeeding has no left/right field** by design. Mention a side and it
  goes in the notes.
- **Multiple events** — "90 ml and a wet diaper" logs both.
- If a value looks implausible (a mis-heard weight, say), nothing is saved and
  Siri says so.
- If a sentence is too ambiguous, nothing is saved and Siri asks a follow-up
  question. There's no back-and-forth yet — just say the whole thing again.

Because voice bypasses the app's last-logged-time buttons, a second log of the
same type within ten minutes still saves but adds a spoken note ("…note, a
bottle was also logged 3 minutes ago"). That covers both a retry after a
dropped response and both parents logging the same feed. Fix genuine
double-logs in the app.

## Security

The Shortcut contains your app URL and the voice token. Both are credentials —
don't screenshot a real one, and don't share the Shortcut outside the family.

The token is scoped so a leaked Shortcut can only *create validated events* on
this one endpoint: it cannot read the timeline, download photos, or hit
`/api/export`. Rotating it is one line:

```sh
fly secrets set -a your-app-name VOICE_TOKEN="$(openssl rand -hex 32)"
```

then update the header in each Shortcut.

## Where it works

Anywhere Siri works: locked screen, Apple Watch, AirPods, CarPlay. "Run When
Locked" isn't needed — Siri invocation handles it.
