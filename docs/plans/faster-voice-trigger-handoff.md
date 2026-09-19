# Handoff - triggering voice logging faster

**For the next assistant.** This is a *decision* handoff: nothing below is
built, and the decision itself is still open pending both parents' input. Read
`.claude/skills/baby-tracker/SKILL.md` first (privacy - public repo). Real
values (app URL, parent names, `VOICE_TOKEN`) live in `.env` and `fly secrets`,
never in committed files including this one.

Work on a branch and open a PR; `main` is what's deployed.

---

## The question

In-app voice logging works well (`docs/plans/in-app-voice-logging-handoff.md`),
but it has to be triggered from inside the app: unlock, find the app, wait for
the log grid, tap **Voice log**. Can it be faster - ideally a physical button
on the side of the phone?

## The hard constraint

**iOS exposes no hardware button to web apps.** The Action Button, Back Tap,
and the iOS 18 Control Center / Lock Screen slots are reachable only from a
Shortcut, or from an App Intent in a *native* app. There is no permission,
entitlement, or manifest key that changes this. A PWA cannot get there.

So the only ways to a physical button are (a) Shortcuts, or (b) a small Swift
app - which costs an Apple Developer account, Xcode, and a re-sign every year
(every 7 days on free provisioning). For a single button that trade was judged
bad; don't revive it without a new reason.

The stated preference is to **avoid Shortcuts if possible** - it works, but
it's clunky to author, and an assistant can't build one on your behalf.

---

## Option A - dedicated "Voice log" home-screen icon (no Shortcuts)

A second entry point, e.g. `/voice`, that serves the same app and starts
recording on load. Added to the home screen it installs as its own icon that
can live in the dock: tap it, you're recording.

- **Keeps** the in-app mic path, so server-side transcription, auto language
  detection and mid-sentence code-switching all still work. No Siri language
  problem.
- **Saves** roughly two taps and a few seconds. Better at 3am; not as good as
  a real button, and still needs the phone unlocked.
- **Not hands-free.**

Sketch:
- A `/voice` route serving `index.html`, with its own manifest
  (`start_url: "/voice"`, `short_name: "Voice log"`) so iOS installs it as a
  distinct standalone icon instead of aliasing the main app.
- Frontend reads the path on boot and fires the existing mic handler once the
  session is confirmed logged in; falls back to the normal log view if not.
- Privacy: the second manifest needs the same logged-in-only naming treatment
  as the existing one in `server/index.js` - anonymous fetches see the generic
  label.

**Must be tested on a real iPhone before calling it done.** iOS
Add-to-Home-Screen behaviour around `start_url` has shifted across versions.
The `/voice` *path* is chosen to be robust either way - the launch URL is right
whether Safari uses the page URL or the manifest's `start_url` - but confirm
the icon installs separately and lands in standalone mode.

## Option B - hardware button via a Record Audio Shortcut

Bind Back Tap (any iPhone 8+, Settings → Accessibility → Touch → Back Tap) or
the Action Button (15 Pro and newer) to a Shortcut. Also works as a Lock Screen
control, or an Apple Watch complication.

Critically, the Shortcut should **record audio and POST the clip**, not dictate
text. Dictation goes through `/api/voice` and inherits the Siri-language
limitation that made the in-app mic exist in the first place. Recording goes to
`/api/voice/audio`, which transcribes server-side with language auto-detection.

- **Only** option that is truly hands-free (baby in both arms, locked screen).
- Roughly 5 Shortcut actions: Record Audio → Get Contents of URL (POST, form
  body, file field `audio`, bearer header) → Speak Text. One-time setup, per
  phone, done by hand.
- **Requires a server change:** `/api/voice/audio` is currently `requireAuth`
  (login cookie only), deliberately - the cookie identifies the speaking
  parent. A Shortcut has no cookie. It would need to also accept the
  `VOICE_TOKEN` bearer and take the parent from the request body the way
  `/api/voice` does, while keeping `allowQueries` restricted to real cookie
  sessions so a shared token still cannot read data back out.
- If built, document the Shortcut steps tap-by-tap in
  `docs/siri-voice-logging.md` next to the existing Shortcut docs.

## Option C - leave it as is

The in-app mic button already works well. Nothing is broken; this is purely
about shaving seconds.

---

## Status

Paused 2026-07-26 pending both parents' input before picking, since both would
be living with whichever trigger is chosen. Nothing started, no branch, no
half-finished work.

A and B are **not exclusive** - A is the everyday path, B is the hands-free
path, and they share the same `/api/voice/audio` endpoint. If both are wanted,
build A first: it is smaller, needs no auth changes, and doesn't depend on
anyone hand-authoring a Shortcut.
