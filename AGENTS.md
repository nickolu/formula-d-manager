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

`rewindTurn` walks the same list backwards, for a mis-tapped turn. It leaves
the race **paused with a full clock**: `turnStartedAt: null` (which `readTimer`
already reads as paused — no pause flag was added) and `turnDurationMs` reset
to `turnDurationDefaultMs`. Rewinding means something went wrong at the table
and people are arguing about it; starting a clock on that argument is wrong,
and handing back the four seconds that were left is worse. Only `turnRewound`
is emitted — "a rewind leaves the race paused with a fresh clock" is a rule of
the system, not a separate thing that happened, so a replay applies it without
a second event.

`turnDurationDefaultMs` exists because `turnDurationMs` is **not** the race's
configured turn length: `pauseTurn` overwrites it with whatever time was left.
It is seeded by `createRace`, optional (races predating it fall back to
`turnDurationMs` — no migrations here), and it is the field the race settings
view edits.

Because rollover overwrites `roundOrder`, a rewind can only cross a boundary
thanks to `previousRoundOrder` — one round of history, saved by `advanceTurn`
at each rollover and cleared once used. Rewinding deliberately does **not** try
to restore `positionOrder`: standings are human-nudged and the operator is
looking straight at the board.

**A round is not a lap.** One round = every car moves once. A lap spans many
rounds. And laps are *per car* — the leader can be on lap 2 while a back marker
is on lap 1 — so `currentRound` is global on the live doc while `lapsCompleted`
lives on each participant. There is no global lap counter, deliberately.

The app does **not** model the board: no car positions, no gear, no wear tokens.
Humans nudge the standings when an overtake happens. Adding board state was
explicitly rejected — it re-implements the game and can desync from the table.

**The car status card is not a reversal of that.** `Participant.carStatus` is a
shared counter standing in for a piece of cardboard, the way the standings list
stands in for looking at the table. The distinction that keeps it honest: the
app never *derives* anything from those numbers and never enforces a rule with
them, so nothing can desync. **Keep it that way** — the moment something
validates a move against remaining tires, this becomes a board model and the
rejection above applies. It is off by default, and its maxima live in
`races/{id}.settings.carStatus.spec` in Firestore rather than in code, following
the `scoringConfig` precedent: house variants must not need a deploy. A key
absent from a participant's `carStatus` means *full* — nothing is backfilled.
`setCarStatus` clamps to `0..max` and refuses an unknown key **in `lib/race.ts`**,
not only in the UI, because every caller — the Phase 3 chatbot included — has to
hit the same limit. There are deliberately no permissions: anyone can change
anyone's card, exactly as anyone can reach across the table and move your pegs.

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
- **`/` belongs to players; `/admin` is the commissioner's.** The root page is
  a list of races — tap one, land on `/race/:id/player` — so the site root is
  the only URL anyone has to know and it never changes between game nights.
  Everything the root used to do (new-race form, per-view links) moved to
  `/admin`, reachable only from `Nav.tsx`; nothing hides it, because there is
  no auth to hide it behind yet and pretending otherwise would be theatre.
  `app/RaceList.tsx` renders both with a `variant` prop rather than forking —
  the listener, ordering and empty state are shared and two copies would drift.
  The landing groups live races above a collapsed "Past races", and
  deliberately **does not auto-redirect when exactly one race is live**: it
  would save a tap at the cost of the root behaving differently week to week,
  and it would strand anyone trying to reach a finished race.
- **`scheduled` is a real state.** A race is created `scheduled` with its clock
  stopped, and `startRace` is the explicit moment the flag drops: it flips the
  status to `live`, anchors the timer, snapshots `roundOrder` from
  `positionOrder` and rewrites each participant's `startPosition`. Snapshotting
  at the start rather than at creation is what lets the grid be reordered right
  up to the flag without leaving the recorded start positions describing a race
  nobody ran. The roster is editable only while `scheduled` — `removePlayer`
  refuses afterwards, because mid-race it would have to unpick three ordered
  lists *and* re-anchor a round already in progress. Retiring a car is the
  in-race answer, and it is reversible.
- **The between-rounds interstitial.** With `settings.betweenRounds` on (the
  default for new races; absent means off, so old races are untouched), a
  rollover stops on nobody's turn: `phase: "betweenRounds"`,
  `currentPlayerId: null`, clock paused with a full duration. The round still
  increments and `roundOrder` is still snapshotted there — only the *selection*
  waits. `startRound` leaves the interstitial and is where `roundStarted` is
  emitted, so that event marks the round actually beginning rather than the
  previous one ending; with the toggle off those are the same instant and
  `advanceTurn` emits it inline as before. Entering the interstitial appends
  `roundEnded`, because the operator did tap Next turn and the log must say so.
  `rewindTurn` treats the interstitial as a boundary crossing and reuses that
  branch — in the interstitial `roundOrder` is already the *next* round's
  snapshot, so stepping back within it would be meaningless.
- **Nobody's turn means two different things** — the race is over, or it is
  between rounds. Every view discriminates on `race.status === "complete"`,
  never on the null `currentPlayerId`. `finishRace` nulls it too.
- **`joinRace` adds to `positionOrder` only, never `roundOrder`.** A late
  arrival starts taking turns *next* round, when the rollover snapshots
  standings — the same rule as an overtake. Splicing a car into a round already
  underway would break the `turnIndex`/`alreadyMoved` arithmetic in the views
  and hand the joiner a turn out of nowhere. Adding stays open once a race is
  live even though item 6 locked removal: a late arrival is normal, unpicking
  someone from three ordered lists mid-race is not.
- **Identity is a claim on a participant, and "my racer" is derived.**
  `Participant.claimedBy` holds the anonymous auth uid `AuthGate` establishes —
  read through `useUid()`, never `getAuth()` from a component, so there is one
  place to change when Phase 2 brings real accounts. It has to be shared state
  rather than `localStorage`: "you cannot pick a racer someone else picked" is
  a fact about the race. The device's own racer is never stored — it is the
  participant whose `claimedBy` matches, derived like standings and car
  identity, so the two halves cannot disagree. `claimRacer` re-reads
  `claimedBy` in a transaction and refuses a taken racer; two phones tapping
  the same one is a real race at a table. Changing racer releases the old claim
  in the same transaction, and the caller passes the racer it currently holds
  because **the web SDK cannot run a collection query inside a transaction** —
  that value is verified before being cleared, so a stale one can never free
  someone else's claim.
- **One free-text note per participant, not a DNF-only reason.** `Participant.note`
  is written by `setParticipantNote`, and the results view labels it by context —
  "Reason" for a retired car, "Note" otherwise. "Blew the engine on lap 3" and
  "won it on the last corner" are the same shape of data, so one field avoids a
  second schema later, and a note that isn't coupled to the DNF flag survives
  un-retiring instead of being orphaned or silently destroyed. An empty string
  *clears* the note rather than deleting the field, so the clearing still
  appends an event. Notes are **not** on `RaceResult`: that is a scoring cache,
  notes are not scoring input, and `computeStandings` stays a pure function of
  finishes. They stay editable after a race is sealed — they are commentary.
- **`deleteRace` is the one mutation that appends no event** — there would be
  nowhere to append it to. The event log survives: the rules forbid deleting
  event documents, so they are left orphaned under a race that no longer
  exists, invisible to the app because nothing queries events except scoped to
  a race. Do not loosen the rules to "fix" it. It refuses anything that is not
  `complete` — that is a data rule, not a button state — and it deletes
  participants, then the live doc, then the race doc **last**, so a failure
  part-way leaves a findable race rather than orphaned subcollections. It is
  not a transaction because Firestore has no client-side recursive delete.
- **`advanceTurn` deliberately does not check the race status.** It is the hot
  path — once per turn, per race — and adding a race-doc read would double its
  cost to guard against something no screen offers.
- **Race configuration goes through `updateRaceSettings`**, which writes the
  race doc and/or the live doc and appends one `raceSettingsChanged` event
  carrying **only the fields that changed**, so the log reads as a diff rather
  than a snapshot. Changing the turn length writes `turnDurationDefaultMs`
  only, taking effect on the next turn: yanking the clock out from under
  whoever is mid-move starts arguments. If the race is already paused there is
  nobody to disturb, so `turnDurationMs` is written too — which is what an
  operator changing it during a break expects. Feature toggles live under
  `races/{id}.settings` and are written by **dot path**, since writing the map
  whole would silently clear a toggle the caller never mentioned.
- **Player subviews are real routes, not conditional render.** A player lands
  cold on a phone with no navigation history, so every subview has to be
  reachable by URL and survive a reload. `app/race/[raceId]/player/layout.tsx`
  is a server component that awaits `params` and hands the id to
  `PlayerTabs`, a fixed **bottom** tab bar — thumb-reachable, which a top bar
  is not, and it survives the page scrolling. Active state comes from
  `usePathname`, not from state, which is what makes a cold load land on the
  right tab. Only subviews that exist get a tab: a tab leading to a 404 is
  worse than no tab.
- The **history subview** renders the event log as sentences, newest first —
  the log is the product, and this is the first view that shows it as such.
  `describe()` in `HistoryView.tsx` switches exhaustively over `RaceEvent` and
  ends in a `never` assignment, so adding a variant to the union without
  describing it fails `npx tsc --noEmit` instead of rendering a blank line at
  the table. `BaseEvent.at` is typed `Timestamp | null` for the same reason:
  it is a `serverTimestamp()` and the persistent cache surfaces a local write
  before the server acknowledges it, so every event this device appends
  renders once with no timestamp. Corrections are shown in chronological place
  with their target's sentence beneath them rather than folded into the target
  — a correction that happened a minute ago must not vanish into a row from
  half an hour ago — and `targetEventId: ""` (what `uncompleteLap` writes) is a
  legitimate value meaning "no specific target".
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
npm run smoke         # 137 end-to-end checks against the real project
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
  - **Done:** the renames — `device` → `player`, `edit` → `results` — and the
    root split: `/` is the player landing, `/admin` is the commissioner's.
  - **Done:** rewinding a turn now resets the clock and leaves it paused.
  - **Done:** the player view is a route with subviews and a bottom tab bar,
    and the first subview is history — the event log read back as sentences.
  - **Done:** the car status card — tires, brakes, gearbox, engine, body, nitro
    as pegs under My racer. Off by default, spec configurable in Firestore.
  - **Done:** My Racer — a player claims their car on their own phone, and the
    claim is shared state so two people can't pick the same one. A player who
    isn't on the grid can put their own name in from the same screen.
  - **Done:** a note per car in the results view — usually why they retired.
  - **Done:** race deletion, from race settings and behind a named confirmation
    that says it will rewrite the season table.
  - **Done:** a between-rounds pause — the table confirms the order before the
    next round's clock starts. On by default, switchable in race settings.
  - **Done:** a race settings subview, and `scheduled` given real meaning —
    races start unstarted, the grid is editable until Start race drops the
    flag, and the roster locks after that.
  - **Next:** season-level player pages (a view over the same `result` data
    across races), then post-game review to confirm the finishing order before
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
