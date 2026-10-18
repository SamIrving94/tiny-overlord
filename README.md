# The Tiny Overlord — web app

An installable phone app for feeds, nappies, sleep and medicine. Plain HTML, CSS and JavaScript, no build step.

## Try it

```bash
npm start
```

Then open http://localhost:8765. On the first screen, pick who uses the phone. Go to **Settings → Add an example week** to see it with data.

Run the tests (state logic only):

```bash
npm test
```

## What it does

- **Now**: one main card answers "which side, and when was the last feed?", with one big button to start the feed. Below it are three rows: Nappy, Sleep and Medicine, each with a status line and a clearly worded button.
- **While you were away**: if you haven't opened the app for 45 minutes or more and someone else has logged something, a card at the top sums up what happened.
- **Medicine**: each medicine has a minimum gap and a maximum per 24 hours, or is once a day. The app says "OK to give" or "Not before 14:20". Logging too soon needs a second, deliberate tap.
- **Every log** shows a receipt with **Undo** and **Change time** for 8 seconds.
- **Today**: totals, plus a timeline. Tap any entry to move its time, change its details or remove it.
- **Week**: the last 7 days (and earlier weeks), compared only with the baby's own days. No norms, scores or streaks, and a day with nothing logged says so instead of showing zero.
  - Longest sleep, as a sentence
  - Nappies each day (wet and dirty)
  - Sleep and feeds through the day: one bar per day, midnight to midnight
  - Feeds each day (breast and bottle, with ml)
  - **For the health visitor**: a printable summary of the last 7 or 14 days (table, day bars, medicine given, notes). Print it, or save it as a PDF from the print screen.
- **Night look** from 19:00 to 07:00 London time (or always day / always night). The look is set before the page draws, so there's no white flash.
- **Forgotten timers**: a feed left running for 90 minutes is closed automatically and flagged "How long was it really?"

## Files

| File | What it is |
|---|---|
| `derive.js` | Pure state logic: event log → "what's true now". Shared with the backend (copy it into Apps Script). |
| `store.js` | Saves events on the phone, queues them, syncs with the backend. |
| `app.js` | The screens. |
| `styles.css` | Warm day and night colours. No red. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install to home screen and work offline. |
| `test/derive.test.js` | Tests for `derive.js`. |

## Events

Everything is an event in one log. Nothing is ever deleted: `undo` cancels an event, `edit` corrects one.

| type | fields | notes |
|---|---|---|
| `feed_start` | `side` | Starts the timer. A second start while one is running is ignored. |
| `feed_switch` | `side` | Switched side during a running feed |
| `feed` | `ref` (the `feed_start` id, if timed), `kind` (`breast`/`bottle`), `sides` `[{side, minutes}]`, `minutes`, `ml`, `check` | `time` is the **start** of the feed. Only the first `feed` per `ref` counts. |
| `side_set` | `side` | Change the next side by hand (used by the device) |
| `nappy` | `detail`: `wet` / `dirty` / `both` | |
| `asleep`, `awake` | | |
| `meds` | `name` | |
| `note` | `note` | |
| `undo` | `ref` | Undoing an `undo` brings the event back |
| `edit` | `ref`, `patch` (e.g. `{time, detail, sides, minutes, check}`) | Applied oldest first |

Every event also has `id`, `time` (ISO 8601 UTC) and `source` (`app-sam`, `app-beth`, `device`).

**Next side** is the opposite of the side the last breastfeed **started** on. For a one-side feed, that's the other side. For a two-side feed, it's the side you finished on. A later `side_set` overrides it.

## Backend contract (to build in the backend milestone)

The app works without a backend; until one is connected, everything stays on the phone. To share, the Apps Script web app must provide:

**`GET ?a=events&token=…&since=<cursor>[&from=<ISO>]`**
→ `{ ok: true, events: [ … ], cursor: <number> }`
Events added after `cursor`, in any order. With `since=0`, `from` limits how far back to go (the app asks for 45 days). `cursor` must only go up. Use a counter in Script Properties, not the row count.

**`POST ?a=log&token=…`** with body (sent as `text/plain`) `{ token, events: [ … ] }`
→ `{ ok: true, accepted: [ids], duplicate: [ids], rejected: [{ id, error }] }`
An id it has already seen goes in `duplicate`, not written again. Check each event with `validateEvent()` from `derive.js`.

**Errors**: `{ ok: false, error: "…" }`, for example a wrong token.

`sides` and `patch` are objects, so store them as JSON text in the sheet.

**Setup link** for the second phone: `<app url>#setup=<base64 of {"url": "…", "token": "…"}>`. Settings → "Copy setup link" makes one. Opening it connects that phone.

## Not done yet

- Deploying the backend on real Google (see backend/README.md)
- Push notifications (the backend can send them through ntfy; they are off by default)
- Testing on a real Android phone at minimum brightness
