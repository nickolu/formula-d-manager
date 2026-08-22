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

`rewindTurn` walks the same list backwards, for a mis-tapped turn. Because
rollover overwrites `roundOrder`, it can only cross a boundary thanks to
`previousRoundOrder` — one round of history, saved by `advanceTurn` at each
rollover and cleared once used. Rewinding deliberately does **not** try to
restore `positionOrder`: standings are human-nudged and the operator is looking
straight at the board.

**A round is not a lap.** One round = every car moves once. A lap spans many
rounds. And laps are *per car* — the leader can be on lap 2 while a back marker
is on lap 1 — so `currentRound` is global on the live doc while `lapsCompleted`
lives on each participant. There is no global lap counter, deliberately.

The app does **not** model the board: no car positions, no gear, no wear tokens.
Humans nudge the standings when an overtake happens. Adding board state was
explicitly rejected — it re-implements the game and can desync from the table.

**Retirement is live state, not a finishing attribute.** A car that breaks on
lap 1 stops taking turns immediately, so `setDnf` writes `participants/{id}.dnf`
*and* a cached `retired` list on the live doc, in one transaction. The list is
duplicated onto the live doc so `advanceTurn` can skip retired cars from a
single document read instead of fanning out over participants — the same bargain
as `result` on the race doc, and every open listener gets it free.

`advanceTurn` and `rewindTurn` skip retired cars **at selection time**; they do
not filter `roundOrder` itself. Keeping the snapshot faithful to the round that
actually started is what makes un-retiring reversible mid-round, and it keeps
the `turnIndex`/`alreadyMoved` arithmetic in the views working unchanged.
Retiring the current player does *not* auto-advance the turn — the human taps
Next turn and the skip takes over; auto-advancing would fight the person holding
the tablet.

`finishRace` unions its `dnf` argument with `live.retired`, so a finish form
can't silently un-retire a car that broke three rounds ago. Un-retiring goes
through `setDnf`, which leaves a trail.

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
- The three race screens are `/race/:id/player` (what a player looks at, on a
  phone or the shared tablet), `/race/:id/screen` (the big screen) and
  `/race/:id/results` (corrections and finishing). Each has been renamed twice —
  `table` → `device` → `player`, `entry` → `edit` → `results` — and every
  historical path redirects **straight to the current one**, never chaining
  through the intermediate name: the tablets have old URLs bookmarked and a
  second round trip on house wifi buys nothing.
- `app/Nav.tsx` is opt-in per page, **not** rendered from `layout.tsx`. The big
  screen is read from across a room and the tablet's buttons are sized for a
  thumb at arm's length; neither wants nav chrome, and the layout would give
  both one.
- Drag-to-reorder is built on pointer events, not HTML5 drag-and-drop. Native
  drag events never fire on touch, so `draggable` would silently do nothing on
  the phones and tablet this is for. The mechanics live in
  `app/useDragOrder.ts` and are shared by `app/ReorderableList.tsx` and the
  track view; the ↑/↓ buttons stay as a fallback.
- The player view renders standings two ways — `list` or `track` — chosen by a
  toggle and remembered per device in `localStorage` (key
  `formulad:standingsMode`, deliberately unchanged across the renames so no
  tablet silently loses its preference), read through
  `useSyncExternalStore` so SSR and hydration agree without an effect.
  `TrackView` draws `positionOrder` as cars on a strip of asphalt travelling up
  the screen, leader nearest the flag. **It is a second rendering, not a second
  source of truth**: cars are evenly spaced because the app models no board
  state, so a car's real location is unknowable and nothing on that screen
  claims otherwise. The only other axis drawn is laps, which is real data.
  Dragging a car emits the same `setPositionOrder` mutation the list does.
- Car identity (`lib/cars.ts`) is **derived, not stored** — a 1–2 character
  label from the display name and a colour from a hash of the player id, both
  assigned over the ids *sorted* so nothing reshuffles when someone overtakes.
  Storing `carLabel`/`carColour` on the player would mean a setup screen and a
  migration, and two cars could still collide; `assignCars` guarantees
  uniqueness within a race instead. Pure, like `lib/scoring.ts`.

## Verification

```bash
npm run smoke         # 57 end-to-end checks against the real project
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
  - **Done:** UI pass over the two interactive screens — drag-to-reorder
    standings, mid-race retirement that skips a car's turns, a reverse gear for
    a mis-tapped turn, and global nav. `table`/`entry` became `device`/`edit`.
  - **Done:** optional track visualisation on the player view — cars drawn
    top-down travelling up the screen, drag to reorder, tap a name for lap and
    DNF. Order-only by design; the no-board-state rule stands.
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
