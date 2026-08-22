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

The app does **not** model the board: no car positions, no move validation, no
computing what a roll allows. Humans nudge the standings when an overtake
happens. Adding board state was explicitly rejected — it re-implements the game
and can desync from the table.

**The car status card and the gear lever are not a reversal of that**, and the
line between them and the rejection is worth stating precisely, because it is
easy to cross by accident. `Participant.carStatus` and `Participant.gear` are
shared counters standing in for a piece of cardboard and a lever, the way the
standings list stands in for looking at the table. What keeps them honest: the
app never *derives* anything from those numbers and never enforces a rule with
them, so nothing can desync — a wrong value is wrong on a screen, not wrong in
the game. **Keep it that way.** The moment something validates a move against
remaining tires, or checks a roll against the current gear's range, this becomes
a board model and the rejection above applies. The gear ranges are *printed*
next to the lever, exactly as they are printed on the card; nothing reads them.

(An earlier version of this file listed "no gear" among the rejected state. That
was the right call for a gear the app *acted on* and the wrong wording for a
gear it merely displays. The distinction above is the rule.)

The card is off by default. Its spec and gear ranges live in
`races/{id}.settings.carStatus` in Firestore rather than in code, following the
`scoringConfig` precedent: house variants must not need a deploy, and a race
keeps whatever it was created with. Each property carries a `start` (what an
undamaged car has) *and* a `max` (the most it can hold once upgraded) — they
differ, so a key absent from a participant's `carStatus` means **`start`**, not
full, read through `startOf`. `setCarStatus` clamps to `0..max` and refuses an
unknown key **in `lib/race.ts`**, not only in the UI, because every caller — the
Phase 3 chatbot included — has to hit the same limit; `setGear` refuses a gear
the race's set doesn't define. There are deliberately no permissions: anyone can
change anyone's card, exactly as anyone can reach across the table and move your
pegs.

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

## Seasons

**The season is the unit of identity; a race is a thing that happens inside
one.** That sentence is the whole of what changed. `createRace` now *requires*
`seasonId` and verifies the document exists before writing anything — the old
`?? "default"` made every race silently a member of a season nothing could
enumerate, and standings are scoped by `seasonId`, so a race pointing at
nothing scores into nothing. The check is a `getDoc` before the batch rather
than inside it, because a batch cannot read and an orphaned race is worse than
a slower create.

`lib/seasons.ts` is `lib/race.ts`'s counterpart, with the same rule: one
transaction, document write plus event append, never a bare `updateDoc` from a
component. `updateSeason` carries **only the fields the caller set**, so the log
reads as a diff — the same shape as `updateRaceSettings`.

**`deleteSeason` refuses a season that has any race.** Cascading would mean
deleting races, and `deleteRace` already refuses anything not `complete` for
good reasons; a season delete must not become the back door around that.
Archiving is the action people actually want when a season ends — it drops out
of pickers and keeps its standings — so delete exists for the season made by a
mis-tap. Like `deleteRace` it appends **no event**: there would be nowhere to
append it to, and the log survives orphaned because the rules forbid deleting
event documents. It clears `members` and `teams` before the season doc, so a
failure part-way leaves a findable season rather than orphaned subcollections.

`ensureSeason` is deliberately *not* routed through `createSeason`. It writes a
known id, is idempotent, and is a migration rather than a mutation — seeding the
season that Phase 1's races already claimed to be in is not a thing that
happened at the table, so it appends nothing.

**The season event log ships before its view, on purpose.** Nothing replays it
the way the race log can be replayed and Phase 3's chatbot does not write to it.
It earns its place on one narrow ground: a team move re-derives the whole
season's team standings silently, and this log is the only thing that will
record the move happened. Unrecoverable after the fact, trivial to write now.
`SeasonEvent` reuses the race log's `BaseEvent` shape — `at`, `source`, `actor`
— so "who said so" reads the same whichever log you are in, and one shape means
one set of rules.

**The season owns the roster; the race owns the grid.** `seasons/{id}/members`
answers "who is in this league"; the live doc's `positionOrder` answers "who is
at the table tonight, and in what order". Someone missing a game night is not
leaving the season. A subcollection rather than an array on the season document,
because a member carries fields and item 17's transactions have to read *one*
member without reading the whole league. `players/{id}` stays global and shrinks
to what it should always have been: the human's name, stable across seasons.

**"Added to all races" is the trap in this feature.** It reads as a fan-out over
every race in the season. It must not be one — **a finished race is never
written to.** Adding a member to a sealed `result.order` would mutate the
scoring cache of a race they did not run so that standings could read a zero
back out of it: a lie in the log to produce a number. The `+0` falls out for
free from the roster being an *input to* `computeStandings`, which seeds a zero
row per member before scoring anything. So `addSeasonMember` fans out over
`scheduled` and `live` races only — usually one, often none — and each is an
ordinary `joinRace` appending its own `playerJoined` event. It is a loop of
transactions rather than one transaction, because the race list has to be
queried first and the web SDK cannot query inside a transaction.

**A missed race is not a DNF.** A member with no entry scores *nothing*, not
`dnfPoints`. Invisible today at `dnfPoints: 0`, and not invisible the first time
someone argues a DNF is worth a point. The standings `races` column means
*races entered*, which is why the view prints how many races the season has run
beside it: 0 of 7 and 0 of 0 are different facts.

`computeStandings` still scores everyone it finds in a result, **not** only the
current members — someone who ran three races and later left the league still
scored those points, and filtering them out would silently rewrite a past
result.

`removeSeasonMember` checks every reason it could fail *before* writing
anything, and **refuses a member who is on a live grid.** `removePlayer` refuses
there anyway; the point is that failing half way through a fan-out would leave
the member dropped from two races and not a third. Retiring the car is the
in-race answer, and it is reversible.

**The new-race form is a checklist, not a textarea.** It draws the grid from the
roster, unchecks absentees, and drags for order — and a name typed into it goes
onto the roster too, because a new player turning up is normal and making the
commissioner visit two screens for it is not. The displayed order is *derived*
(dragged order ∩ roster, then whatever the roster has that it doesn't) rather
than state synchronized from a listener, so a member added on another phone
appears without a re-render fight over who owns the list.

`scripts/backfill-season-members.ts` writes member documents **directly** rather
than through `addSeasonMember`, and appends no season event. The fan-out would
append a `playerJoined` claiming they arrived today, when they were already on
those grids: a migration records that the roster caught up with history, not
that history happened again.

**The root did not become a season picker, and that was the decision most
likely to get quietly reversed.** `/` is still a list of races; the season is
*named in the header with a switcher beside it* — a control on the page, not a
door in front of it. A picker would make the root a different page at every
season rollover and add a tap to every game night for a league with one active
season, which is the same reasoning that already forbids auto-redirecting to a
single live race. `app/SeasonRaces.tsx` renders both `/` and `/season/:id`,
because they are the same page and two copies would drift.

**"Current season" is derived, not flagged**: the newest season that has not
been archived. Nothing has to be remembered to be set — a new season becomes
current by existing, an old one stops by being archived. If pinning is ever
wanted, a `seasons/{id}.current` read inside `useCurrentSeason` is the whole
change. `/standings` stays as a **redirect** to `/season/:id/standings` because
phones have it bookmarked; it is a client redirect rather than a
`next.config.ts` one because the destination is a document id nobody knows until
the seasons collection has been read, and it `replace`s rather than pushes so it
does not sit in the back stack bouncing the player forward.

**The season claim is a default, not a second source of truth.**
`SeasonMember.claimedBy` lets a phone claim once a season instead of every game
night; `createRace` and `joinRace` *seed* `participants/{id}.claimedBy` from it,
and from then on the in-race claim is authoritative and still re-tappable — which
is what makes a stale claim from a borrowed tablet one tap to fix. "My racer" is
still derived from the participant, never stored. `claimSeasonRacer` takes the
racer the caller currently holds for the same reason `claimRacer` does: the web
SDK cannot query a collection inside a transaction, so the value is verified
before being cleared and a stale one can never free someone else's claim.

Updating the season claim from the player view is deliberately **best-effort and
silent on failure**. The in-race claim has already been written by then, so
surfacing "someone else has that racer" about a racer visibly theirs would be a
lie about what happened; the worst case is that next week seeds nothing and they
tap again. Putting your own name in mid-race also joins you to the *league*, not
just to tonight's race — otherwise you would be missing from the roster the next
grid is built from.

**`backfillRace` introduces no new event variant, deliberately.** A race the
app never timed is created already complete, and its log gets an ordinary
`raceCreated` followed by an ordinary `raceFinished` — so replaying it produces
the correct state with zero new logic anywhere. `backfilled: true` on the race
document is the cache flag that lets a view say "entered afterwards". It writes
a **minimal live doc** (`currentPlayerId: null`, `currentRound: 0`,
`positionOrder` = the finishing order) so `useLiveState` and every screen
reading it keep working instead of each special-casing a race with no live
state. Both its events are stamped with the *date the race was run*, a second
apart, because `at` means "when this happened" everywhere else in the log and a
race from March must not sort to the top of it.

`scheduledAt` became an input rather than always `serverTimestamp()`, and that
was a live bug waiting: without it every backfilled race sorts to today and
scrambles the season's order. `updateRaceSettings` takes it too, since a typed
date can be wrong.

**`amendRaceResult` is the mutation that looks like it breaks "corrections
append, they never mutate", and the reason it does not is worth keeping
stated.** `result` on the race document is a **cache of the log**, exactly as
the live doc is — `finishRace` writes it in the same transaction that appends
`raceFinished`, purely so standings can be a pure function over the races
listener. Rewriting a cache is fine; rewriting history is not, and nothing here
does. The original `raceFinished` is untouched, a `raceResultAmended` records
the new order, and a `correction` pointing at that original is appended beside
it, so the history view shows both in chronological place. Standings recompute
on the next snapshot because they were never stored.

Two details it does *not* share with `finishRace`. It validates against the
sealed `result.order` rather than the live doc, because that is the record of
who was actually in the race. And it does **not** union the retirements with
what is already there: `finishRace` does that so a finishing form cannot
silently un-retire a car, but "we wrote down that he retired and he did not" is
exactly the mistake an amendment exists to fix, and a union would make it the
one correction that cannot be made. The target event is looked up *before* the
transaction, because the web SDK cannot query a collection inside one.

`scripts/prune-orphan-races.ts` reports by default and only deletes with
`--delete`, and it goes through `deleteRace` — so the "finish it first" rule
holds there too, and a live orphan is reported and left alone. A one-time script
rather than a button, so that rule never acquires a back door.

## Teams

Two house rules shape this, and both **delete mechanism rather than adding it**.
Do not build for the cases they forbid.

**Every team is the same size**, and **nobody switches teams during a season.**
The second one is load-bearing: with no transfers there is nothing for a
`result.teams` snapshot to protect against, so `finishRace` and `RaceResult` are
untouched by the entire teams arc and team points are attributed by *current*
membership. The interesting consequence is what happens when someone does get
moved — under this rule that is not a transfer, it is a **correction of a
recording error**: the player was always on that team and it was written down
wrong. Re-deriving the whole season's team standings is then exactly the right
behaviour, and the thing that would be a hazard in a transfer model is the
desired outcome here. The trail of who moved and when lives in the season log,
which is the only place it lives at all.

**Equal sizes are not enforced in `lib/`, deliberately.** It is a season-wide
invariant, so a transaction cannot check it without a query — and enforcing it
would block creating the third team until the first two are full, which is
hostile during the ten minutes a league gets set up in. So the admin path
(`assignToTeam`) may overfill a team while the player path (`joinTeam`) is
capacity-checked, and the admin view *flags* an uneven team and a roster that
does not divide by `teamSize`. Lowering `teamSize` below an existing team's size
is allowed and kicks nobody: it blocks new joins and leaves everyone where they
are. Removing someone from their team because a setting changed is the sort of
thing that ends a game night.

**Two invariants are denormalized, because the web SDK cannot query inside a
transaction** — the `claimRacer` problem again:

- `teams/{id}.members` is the **capacity** authority: "is there an open slot" is
  `members.length < teamSize`, from one document read.
- `members/{playerId}.teamId` is the **exclusivity** authority: "am I already on
  a team" is one field, from one document read.

`joinTeam` reads both, checks both, writes both, in one transaction, so neither
can be violated by two phones tapping at once. `leaveTeam` finds the team from
the member document — that is what the exclusivity mirror is *for* — and
tolerates a team that has already been deleted.

**Colour uniqueness** spans every team in the season, so the answer lives in
`seasons/{id}.teamColors` — a map from colour key to team id, on the one
document every colour-changing transaction already reads. Written by **dot
path**, never whole: writing it whole would clobber a colour claimed a second
earlier, exactly the reason race settings toggles are written by dot path.
Released with `deleteField()`. The picker reads it from a document it is already
streaming, so taken colours grey out with no extra listener — greyed rather than
hidden, because seeing that Ferrari is spoken for is information. The
consequence is that **a palette colour a team is wearing cannot be removed**;
`updateTeamConfig` refuses it and the palette editor greys the ×.

`teamConfig` follows the `scoringConfig` and car-status precedent exactly:
Firestore, not code; **absent means off**; existing seasons untouched; no deploy
to change a house variant. `teamConfigFor` is the one place absence is resolved,
so a season switched on before a palette was written gets the house palette
rather than an empty picker. `teamConfig.scoring` stays even though with equal
full teams `average` is `sum ÷ teamSize` — a monotone transform with an
identical ranking. One field and one branch, and the only case where it matters
is the one the house rule forbids and somebody will eventually allow.

`playerManaged` is **a mode, not a permission.** There is no auth to enforce one
with, the same honesty as `/admin` not being hidden. What `lib/` enforces is the
soft check that actually works at a table: a player may edit the team they are
on. Say so wherever it is read, so nobody later mistakes it for security.

**Constructor standings are derived, never stored** — the same rule as driver
standings, and `computeTeamStandings` is a pure function beside
`computeStandings` in `lib/scoring.ts`, which still imports nothing from
Firestore. A team score is an *aggregate of driver rows* rather than a second
scoring rule, so there is one place points are worked out. It takes `seasonId`
and scopes: unscoped races would quietly fold another season's points into this
one's team table, which is wrong rather than broken.

`scoring: "average"` divides by the members who **entered** that race, not by
`teamSize` — dividing by a constant is a monotone transform and would rank
identically to `sum`, which would make the option pointless.

The standings view is one page with a **Drivers | Constructors** segmented
control that does not render at all when teams are off. The drivers table gains
a 4px left border in the team's colour — grouping readable without a legend —
but **colour is never the only signal**: the Team column names it too. Sorting
is by column header, remembered per device in `localStorage` under
`formulad:standingsSort`, read through `useSyncExternalStore` exactly as
`formulad:standingsMode` is, so SSR and hydration agree without an effect. The
crown stays on the points leader whatever the sort in force — sorting by team
rank must not decorate whoever floats to the top — and the leading *team* gets a
**different** mark, a colour chip with a trophy, because two crowns on one row
reads as one thing being doubly first. The table scrolls horizontally inside its
own container; the page never does.

**The player's team panel lives inside My racer, not in a fourth tab.** The
panel has to know who *you* are, and that is the claim — a standalone Team tab
would open on "claim a racer first", which is the My racer screen with extra
steps. `PlayerTabs` stays three tabs. `app/TeamPanel.tsx` is rendered twice from
one component: under the car card during a race, where teammates show live
position, laps and DNF, and standing alone at `/season/:id/teams` between game
nights, where the racer is resolved from the *season* claim because there is no
race to derive one from. Do not fork it — join, leave and rename are the same
paths in both places.

**"Leave team" is muted, small, and on its own**, the same reasoning as the
reverse gear: a rare action that undoes something must not sit beside a target a
thumb is aimed at all evening. Full teams stay **visible and disabled** rather
than hidden, for the same reason a claimed racer does — hiding one makes a
player think their friend's team is missing.

The admin assigns through a **slot grid** — one card per team showing `teamSize`
slots, an empty slot tapping to a picker of unassigned members. Not a dropdown
per player: with teams of two and a known roster it is a handful of taps, and an
uneven team or a leftover player is visible at a glance in a way a dropdown
never is.

**Firestore rules do not inherit into subcollections.** `match /seasons/{id}`
covers the season document and nothing under it, and a missing nested match is
a silent permission denial at the table, not a build error. So `events`
(append-only, like race events), `members` and `teams` are all declared now,
ahead of the items that create the last two: rules are one file, and a partial
ruleset means the next change ships and mysteriously cannot write. The
`races` composite index on `seasonId ASC, scheduledAt DESC` ships early for the
same reason — a missing index fails at runtime, so it is created before anything
depends on it. `useRaceList(seasonId)` is what uses it; called with no argument
it lists every race, which is what `/` wants.

## Conventions

- **Next 16:** `params` is a `Promise` and must be awaited. A client component
  page cannot be `async` — server page awaits params, passes the id to a
  `"use client"` child. Every route here follows that shape.
- Season scoring lives in `seasons.scoringConfig` in Firestore, **not in code**.
  House rules churn; changing them must not require a deploy.
- Every event carries `source: "manual" | "chat" | "system"` so chat-entered
  mistakes stay traceable.
- The race screens are `/race/:id/player` (what a player looks at, on a phone
  or the shared tablet), `/race/:id/screen` (the big screen), and two
  commissioner ones: `/race/:id/results` (corrections and finishing) and
  `/race/:id/settings`. **Race settings is deliberately not a player subview** —
  it is commissioner work, it does not belong in a tab bar a player thumbs
  through mid-game, and it sits beside the results screen for the same reason
  that one does. Both are reached from the race list on `/admin`. The player
  and screen views have been renamed twice —
  `table` → `device` → `player`, `entry` → `edit` → `results` — and every
  historical path redirects **straight to the current one**, never chaining
  through the intermediate name: the tablets have old URLs bookmarked and a
  second round trip on house wifi buys nothing.
- **`/admin` is a season layer above the races.** The new-race form used to sit
  on `/admin` itself; it moved to `/admin/season/:seasonId` because a race must
  belong to a season that exists, so there is no coherent place to create one
  outside a season. `/admin` is now the season list plus a New season form, and
  the season page carries Races, Scoring and Settings — Roster and Teams land
  there as further sections. `NewRaceForm` and `RaceList` take a `seasonId`
  rather than being forked, the same reasoning as `RaceList`'s `variant`.
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
- **The player view has a header saying which race it is, and a way out.** A
  player arrives cold from a list of races, so the view has to name the race —
  and it has to be possible to have tapped the wrong one. The paradigm that the
  player view is self-sufficient is about never sending someone elsewhere to
  *do* something; leaving is not doing something, and a screen with no exit is
  a trap. `PlayerHeader` lives in the player layout so every subview gets it,
  and it is **not** `app/Nav.tsx`: nav chrome would put standings and admin
  links in front of a player mid-game.
- **A missing `carStatus.spec` falls back to the default.** Switching the card
  on writes only `enabled`, so a race created before the card existed would
  have no spec — and would render nothing while every `setCarStatus` threw.
  `carStatusSpecFor` is the one place that resolves it, used by both the view
  and the mutation. This is the "every reader handles the field's absence" rule
  doing its job: an old race gets the standard card, not a broken one.
- **The car card renders a change before the write lands, and the release rule
  is the whole trick.** Firestore's latency compensation covers plain writes but
  **not transactions**, and every mutation here is a transaction — so the local
  cache has nothing to show until the server answers, and a peg tap sat visibly
  waiting. `CarStatusCard` holds the tapped value and shows it at once. The part
  that is easy to get wrong is when to stop: releasing on the write's promise is
  a flicker, because a transaction resolves when the server commits, which is
  *before* the snapshot carrying that commit arrives — for one frame the row
  falls back to the pre-tap value. So a held value is released only when keeping
  it would be wrong: the write failed (dropping it *is* the undo, since the
  streamed value is already the truth), or the store settled on something that is
  neither our value nor what was there when our write landed, meaning someone
  else moved it. When the store merely catches up with what is already on screen,
  nothing happens at all — a successful tap renders exactly once. This is why the
  injected write must **rethrow**: `runReported` surfaces the error and rethrows,
  and the undo hangs off that rejection. Card edits also skip the busy flag;
  dimming the card on every tap was most of what made it feel slow.
- **The reverse gear is deliberately not beside Next turn.** "Back a turn" is a
  small, muted link at the *top* of the player view, not a button in the row
  with the primary action. Next turn is tapped a few hundred times a night and
  a rewind is tapped almost never, but a mistaken rewind un-does a move and
  stops the clock — and anything placed beside a target that big eventually
  gets caught by a thumb. Small-and-adjacent was tried first and was the wrong
  trade. Keep it visually quiet and physically far from the primary button.
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
  worse than no tab — and race settings is not one of them, being a sibling
  route rather than a subview.
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
- **The list does not reorder while you drag it.** An earlier version spliced a
  preview array on every pointermove, so rows jumped between slots and the thing
  under your finger was whatever had landed there. Now the DOM order stands
  still and everything moves by transform: the dragged row lifts and follows the
  pointer, the rows it passes ease aside, and only the drop changes the real
  order. Geometry is measured once at drag start — nothing reflows mid-drag, so
  those measurements stay true and each frame is a subtraction. Anything that
  *reads* as a position, like a row's number, comes from `projectedIndex` rather
  than the render index, or it would sit there contradicting the eye.
- **The drop is held optimistically too**, for the same reason the car card
  holds a tapped value: `onReorder` is a transaction, so clearing the transforms
  on pointer-up would snap the row back to where it started and leave it there
  for the whole round-trip. The dropped order is adopted in the same render the
  transforms clear — laying the row out where it already appears to be — and
  released when the real list agrees, or when someone else moves the list out
  from under it. While the write is in flight `items` still reads as it did
  before the drop, which is what lets those two comparisons tell the cases apart
  without waiting on the write at all. Reconciled **during render**, not in an
  effect: it is adjusting state because a prop arrived. A failed write reverts
  by dropping the held order, which is why every `onReorder` that reports an
  error must also rethrow.
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
npm run smoke         # 145 end-to-end checks against the real project
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
  - **Done:** seasons as a real entity — created, renamed, scored and archived
    from `/admin`, with a season event log, the subcollection rules, and the
    `seasonId`/`scheduledAt` index. `createRace` verifies its season.
  - **Done:** the season roster — members own the league, races draw their grid
    from it, and standings seed a zero row per member so a missed night costs
    nothing and rewrites no sealed race. `npm run backfill-season-members`
    builds the roster from races already run.
  - **Done:** player-side season scoping — `/season/:id`, per-season standings,
    a switcher in the header rather than a picker in front of the root, and a
    racer claim that lasts the season and seeds each race's.
  - **Done:** backfill a race the app never timed, and amend a finished one —
    plus `npm run prune-orphan-races` for races pointing at a season that isn't
    there.
  - **Done:** teams, admin side — `teamConfig` in Firestore, the palette and its
    colour-claim map, the slot grid, and both denormalized invariants with
    concurrency covered by the smoke test.
  - **Done:** teams on a player's phone — the panel under the car card and the
    same panel standing alone at `/season/:id/teams`.
  - **Done:** the standings rebuild — drivers and constructors in one view,
    sortable, with team colours and a mark for each leader. **The seasons and
    teams arc is complete.**
  - **Next:** post-game review to confirm the finishing order before a race is
    sealed.
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
