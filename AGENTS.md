<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Formula D league tool

Runs a home Formula D board game group: a turn timer for game night, a log of
what happened, and (later) a season website. Next.js 16 on Vercel, Firestore for
data, Firebase Auth for identity.

## The one idea everything follows from

**The race event log is the product.** Timer, chatbot, website, and stats are all
adapters and views over it. Get the event model right and the rest falls out.

Two consequences that are easy to violate:

- **All state changes go through `lib/race.ts`.** Each function updates the live
  doc *and* appends to the event log in a single transaction. Never write race
  documents directly from a component or a route handler.
- **Corrections append, they never mutate.** Fixing bad data means adding a
  correction event. The Firestore rules enforce this — event docs reject UPDATE
  and DELETE — so code that tries to edit history will fail at runtime, not
  review.

## Domain model — the parts that are counterintuitive

Formula D turn order is **track position, not a fixed player rotation.** This was
gotten wrong once already; the fix is the reason for two separate lists:

| Field | Meaning | Changes when |
|---|---|---|
| `positionOrder` | live standings | someone overtakes |
| `roundOrder` | snapshot frozen at round start | only when a round ends |

`advanceTurn` walks `roundOrder`. Running off the end means every car has moved
once: the round ends and the next `roundOrder` is snapshotted from
`positionOrder`. **Do not collapse these into one list.** The split is what makes
a mid-round overtake affect the *next* round instead of reshuffling a round
already in progress.

**A round is not a lap.** One round = every car moves once. A lap spans many
rounds. And laps are *per car* — the leader can be on lap 2 while a back marker
is on lap 1 — so `currentRound` is global on the live doc while `lapsCompleted`
lives on each participant. There is no global lap counter, deliberately.

The app does **not** model the board: no car positions, no gear, no wear tokens.
Humans nudge the standings when an overtake happens. Adding board state was
explicitly rejected — it re-implements the game and can desync from the table.

## The timer is state, not a process

There is no countdown running anywhere. The live doc holds `turnStartedAt`
(server timestamp) + `turnDurationMs`, and every client derives remaining time
locally via `readTimer()`. Nothing drifts, a reconnecting screen is instantly
correct, and Vercel is never in the realtime path — serverless functions are
request-scoped and cannot hold a WebSocket anyway.

- `setInterval` in the views is a **repaint loop**, not a clock and not a poll.
  It touches no network.
- **Pause** rewrites the same two fields: freeze what's left into
  `turnDurationMs`, set `turnStartedAt: null`. Resume re-anchors. Do not add
  pause bookkeeping fields — the render path stays identical.
- Expiry has **no mechanical consequence** (deliberate). Screens just turn red.
  Enforcing a penalty would require a single authority on expiry; don't add one
  without asking.

Clock skew between clients is unaddressed on purpose. It's cosmetic for an
ambient timer. If it ever matters, fetch server time from a route handler once on
load and store the offset.

## Realtime

`onSnapshot` is server-push over Firestore's persistent connection (WebChannel),
not polling. One listener per screen, one document read per change. A weekly
7-player game sits inside the free tier; polling would not.

Firestore persistent local cache is enabled in `lib/firebase.ts`, so the
countdown survives a wifi drop and the next-turn write queues until reconnect.

## Scoring and standings

**Standings are derived, never stored.** `computeStandings` in `lib/scoring.ts`
is a pure function of finished races plus a `ScoringConfig` — no Firestore, no
clock, no I/O. That is what lets you re-argue house rules against past seasons
without touching the database, and it means standings cannot drift from the
races they summarize.

The one piece of denormalization that makes this work: `finishRace` writes the
finishing order onto the **race document** as `result: {order, dnf}`, in the
same transaction that appends `raceFinished`. Standings are then a pure function
over the races listener the app already has open — no per-race participant
fan-out, no `collectionGroup` index, no extra reads. `result` is a cache of the
log in exactly the way the live doc is; the `raceFinished` event stays the
record of truth.

`finishRace` validates the order against `positionOrder` (no duplicates, nobody
missing, no strangers) because a partial order would silently under-count a
season rather than fail.

Two scoring rules that look like bugs and aren't:

- **A DNF scores `dnfPoints` regardless of track position**, so retiring from
  the lead never out-scores finishing last.
- **A retirement doesn't count as a podium and doesn't set `bestFinish`** — a
  car that broke while running second did not finish second.

Ties break on countback (most wins, then most seconds, …), then player id for a
stable order.

Season docs did not exist through Phase 1 — `createRace` wrote `seasonId:
"default"` against nothing. `npm run seed-season` creates it, and is a no-op if
it already exists so it can never clobber a scoring table tuned in the console.

## Conventions

- **Next 16:** `params` is a `Promise` and must be awaited. A client component
  page cannot be `async` — server page awaits params, passes the id to a
  `"use client"` child. Every route here follows that shape.
- Season scoring lives in `seasons.scoringConfig` in Firestore, **not in code**.
  House rules churn; changing them must not require a deploy.
- Every event carries `source: "manual" | "chat" | "system"` so chat-entered
  mistakes stay traceable.

## Verification

```bash
npm run smoke         # 39 end-to-end checks against the real project
npm run seed-season   # create the default season if missing (idempotent)
```

`scripts/smoke.ts` exercises the real transactions and a live listener — the
parts unit tests can't reach. Run it after any change to `lib/`.

It writes to the **real** Firestore (project `formula-d-aaf82`) using a
`SMOKE-TEST` race and cleans up after itself. Its event docs survive deletion by
design, since the rules forbid deleting events; they're orphaned under a deleted
race and invisible to the app.

There is no Firestore emulator on this machine — it needs Java, which isn't
installed.

`npx tsc --noEmit`, `npx eslint .`, and `npm run build` should all be clean.

**Do not run `npm audit fix --force`** — it "fixes" two moderate build-time
PostCSS advisories by downgrading Next.js to 9.3.3.

## Status and what's next

**Phase 1 is done and verified**: table device, big-screen timer, standings
nudging, per-car laps, manual correction.

- **Phase 2 — the website.** *In progress.*
  - **Done:** season scoring and standings. `seasons/default` exists with a
    real `scoringConfig`, `finishRace` denormalizes `result` onto the race doc,
    `lib/scoring.ts` derives the table, and `/standings` renders it. The finish
    path is now covered by the smoke test — it never had been.
  - **Next:** race history and player pages (both are views over the same
    `result` data), then post-game review to confirm the finishing order before
    a race is sealed.
  - **Then:** Firebase Auth graduates from anonymous to real accounts, and the
    rules tighten — right now any signed-in caller can write anything, which
    suits a living room and not a public site. Decided: **Google sign-in**, with
    admin gating via **custom claims set through the Firebase Admin SDK** (needs
    a service account key in Vercel env and a route handler to set claims).
    Anonymous auth stays alive for the table devices so game night still needs
    no login.
- **Phase 3 — the chatbot.** An *input adapter*, not a separate system. It gets
  the `lib/race.ts` functions as its tool surface and emits the same mutations
  the buttons do — never raw document writes. Anthropic calls go through a
  route handler so the API key stays server-side.
- **Phase 4 — the rules chatbot.** Gated on `docs/house-rules.md`, which has to
  be filled in by hand. It's the only input that can't be backfilled.

Races created before the `positionOrder`/`roundOrder` split render
`app/StaleRace.tsx` instead of crashing. There's no migration — the old model
stored a fixed rotation that can't be reconstructed.
