# Formula D

A tool for running our Formula D board game nights and season: a shared turn
timer, a log of what happened during the race, and — later — a season website.

Next.js 16 on Vercel, Firestore for data, Firebase Auth for identity.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in from the Firebase console
npm run dev
```

The Firebase project is `formula-d-aaf82`. It needs **Firestore** and
**Anonymous sign-in** enabled (Authentication → Sign-in method). Without
anonymous auth the app shows "Sign-in failed", because the security rules reject
unauthenticated reads.

To get the config values without the console:

```bash
firebase apps:sdkconfig WEB
```

## Using it on game night

| Screen | Who looks at it | URL |
|---|---|---|
| **Player** | anyone playing — their phone, or the shared tablet | `/race/<id>/player` |
| **Screen** | the TV — big timer and standings | `/race/<id>/screen` |
| **Results** | corrections and finishing the race | `/race/<id>/results` |

Older bookmarks still work: `/table` and `/device` redirect to `/player`,
`/entry` and `/edit` to `/results`.

`/` is the player landing — a list of races, tap one to land in it. That is the
only URL anyone needs. The commissioner's tools live at `/admin`.

Create a race from `/admin`, enter players in starting grid order, then open the
player and screen views on separate devices. A new race starts **scheduled**
with its clock stopped — edit the grid and the settings, then tap **Start race**
on the player view to drop the flag. The roster locks once it is running.

During play:

- **Next turn** advances to the next car in the round.
- **↑ ↓** nudge the standings when someone overtakes. This is what the *next*
  round's order is built from — a mid-race overtake never reshuffles the round
  already in progress.
- **+lap** marks a car as having crossed the line. Laps are per car, so cars
  complete them on different rounds.
- Round counter is global; one round means every car has moved once.

The timer is a pace-keeper with no teeth. It turns amber under 30 seconds and red
at zero, and nothing happens mechanically — it's social pressure only.

## Scripts

```bash
npm run dev     # dev server
npm run build   # production build
npm run smoke   # 112 end-to-end checks against the real Firestore project
npm run lint
```

`npm run smoke` is the real test suite: it drives actual transactions and a live
listener against Firestore, which is the only way to verify the parts that
matter. It creates a `SMOKE-TEST` race and cleans up afterwards. Run it after
changing anything in `lib/`.

Deploy security rules with:

```bash
firebase deploy --only firestore:rules
```

## How it's put together

```
lib/race.ts     every state mutation — live doc + event log, one transaction
lib/timer.ts    pure countdown arithmetic
lib/hooks.ts    Firestore subscriptions
lib/types.ts    the data model, with the reasoning in comments
lib/setup.ts    race creation
app/race/...    the three views
```

Two ideas carry most of the design:

**The event log is the product.** The live document is a denormalized cache that
screens subscribe to; the append-only event log is the record of truth.
Corrections append rather than mutate, so there's an audit trail and a bad entry
is one undo. The Firestore rules enforce append-only at the server.

**The timer is state, not a process.** Nothing counts down anywhere. The live doc
stores a start timestamp and a duration, and each client derives the remaining
time locally. No drift, no polling, no server involvement between taps — a
reconnecting screen is instantly correct, and one small write per turn is the
only network traffic.

`AGENTS.md` has the full design notes and the invariants worth not breaking.

## Status

Phase 1 (game night) is done and verified. Still to come: the season website and
standings, a chatbot for logging races in natural language, and a rules chatbot
that knows our house rulings.

That last one is waiting on `docs/house-rules.md` — see the note in that file.
