# Seasons and teams — the model

Status: **steps 1–2 shipped** (seasons as a real entity, and the season
roster — items 13 and 14). Steps 3–7 are still proposal. Written before code so the arguments happen here rather than in
a diff.

## What this changes about the one idea

Nothing. The race event log is still the product. Everything below is either a
new *derived* view over it (team standings), a new *input* to the pure scoring
function (the season roster), or a new *cache* written in the same transaction
as its event (team snapshots on `result`). The two consequences in AGENTS.md
still hold: state changes go through `lib/`, and corrections append.

One thing does move, though, and it is the load-bearing change:

> **The season becomes the unit of identity. A race becomes a thing that
> happens inside one.**

Today `players/{id}` is global and a race's roster is whatever names got typed
into a textarea. After this, the league roster lives on the season, a race's
grid is *drawn from* that roster, and `players/{id}` shrinks to what it should
always have been: the human's name, stable across seasons.

---

## Data model

### Season

```ts
seasons/{seasonId}
{
  name: string
  scoringConfig: ScoringConfig      // unchanged
  startDate: Timestamp
  /** Absent means active. Archived seasons drop out of pickers, keep their standings. */
  archived?: boolean
  /** Absent means teams off. Same "absent means off" rule as RaceSettings. */
  teamConfig?: TeamConfig
  /** Which colour keys are taken, and by whom. See "Colour uniqueness". */
  teamColors?: Record<string /* colourKey */, string /* teamId */>
}
```

```ts
interface TeamConfig {
  enabled: boolean
  /**
   * Racers per team. House rule is that every team is exactly this size, but
   * nothing enforces it — see "Equal teams are a house rule". Configurable
   * because 2 today does not mean 2 forever.
   */
  teamSize: number              // default 2
  /** Players may create, rename, recolour, join and leave. Not security; see below. */
  playerManaged: boolean
  /** Config, not code — house palettes churn. Seeded from DEFAULT_TEAM_PALETTE. */
  palette: TeamColor[]
  /** How member points make a team score. Default "sum". */
  scoring?: "sum" | "average"
}

interface TeamColor {
  key: string      // stable id — "ferrari". Never reused for a different colour.
  label: string    // "Ferrari Red"
  hex: string      // "#E8002D"
}
```

### Season member

```ts
seasons/{seasonId}/members/{playerId}
{
  playerId: PlayerId
  joinedAt: Timestamp
  /** Mirror of teams/{teamId}.members. See "Team membership is written twice". */
  teamId?: string | null
  /**
   * The anonymous uid that claims this racer for the whole season, so a phone
   * claims once instead of every game night. participants/{id}.claimedBy is
   * still the in-race truth; createRace/joinRace seed it from here.
   */
  claimedBy?: string | null
}
```

A subcollection rather than an array on the season doc, for two reasons: a
member carries fields, and a transaction has to be able to read *one* member
without reading the whole league.

### Team

```ts
seasons/{seasonId}/teams/{teamId}
{
  id: string
  name: string
  colorKey: string          // must exist in teamConfig.palette
  members: PlayerId[]       // capacity authority — see below
  createdAt: Timestamp
}
```

### Race — three changes

```ts
races/{raceId}
{
  seasonId: string          // no longer defaulted to "default"; must resolve
  scheduledAt: Timestamp    // now settable, not always serverTimestamp()
  /** True for a race entered after the fact, that the app never timed. */
  backfilled?: boolean
  result?: RaceResult       // unchanged — see "Teams don't move"
}
```

`Participant` is unchanged.

### Season event log

```ts
seasons/{seasonId}/events/{eventId}
```

Same shape and same rules as race events — append-only, `source`, `actor`, `at`.
Season and team changes are otherwise unrecoverable: nothing else records that
Ken left the team, or that the commissioner shrank teamSize to 2 in week four.
**Append these from day one even before there is a view for them.** The view is
cheap later; the data cannot be reconstructed.

`SeasonEvent` variants: `seasonCreated`, `seasonSettingsChanged` (a diff, same
as `raceSettingsChanged`), `memberAdded`, `memberRemoved`, `teamCreated`,
`teamRenamed`, `teamRecoloured`, `teamDeleted`, `teamJoined`, `teamLeft`.

---

## Six things in the plan worth arguing about

### 1. "Added to all races" should not touch a finished race

The plan says a player added to a season is added to every race in it, and gets
+0 for races already completed. Writing them into a sealed race would mean
editing `result.order` — mutating the scoring cache of a race they did not run,
so that the standings can then read a zero back out of it. That is a lie in the
log to produce a number.

**The +0 falls out for free if the season roster is an input to
`computeStandings`.** Seed a zero row for every member, then score the races.
Someone who joined in week five appears with 0 points and 0 races entered, and
`result` still says exactly who was on the grid.

So `addSeasonMember` fans out only over races that are **`scheduled` or
`live`** — a bounded loop (usually one race, often none), each one a normal
`joinRace` appending its own `playerJoined` event. Completed races: no write.

### 2. A missed race is not a DNF

Related, and easy to get wrong later. A member with no entry in a race scores
*nothing* — not `dnfPoints`. Today `dnfPoints` is 0 so the distinction is
invisible; the moment someone argues for "a DNF is worth 1", it stops being
invisible. Write it down now: **absent ≠ retired**, and the standings row shows
`races` as *races entered*, with the season's race count in the header for
contrast.

### 3. The season roster is not the grid

Membership answers "who is in this league". The grid answers "who is at the
table tonight, and in what order". Ken skipping a week must not remove him from
the season.

So: `createRace` **pre-fills the grid from the season roster**, and the form is
a checklist you uncheck absentees from, plus a drag handle for grid order. The
"names, one per line" textarea goes away entirely, which is most of the UX win
in this whole document.

### 4. Teams don't move, so a team change is a correction

**House rule: a player does not switch teams during a season.** That assumption
deletes a whole mechanism. The first draft of this document had `finishRace`
snapshot `result.teams` — playerId → teamId as it stood that day — so that a
week-six transfer couldn't drag five races of points onto a new team. With no
transfers, there is nothing to protect against, and the snapshot would only be a
second copy of a fact that never changes.

So: **team points are attributed by current membership, and `RaceResult` is
untouched.** No new field, no fallback rule, no migration.

The interesting consequence is what happens when someone *does* get moved. Under
this house rule a team change is not a transfer — it is a **correction of a
recording error**: the player was always on that team and we wrote it down
wrong. And re-deriving the whole season's team standings is exactly the right
behaviour for a correction. The thing that looked like a hazard in the transfer
model is the desired outcome in this one.

That is worth a comment in `computeTeamStandings`, because it will otherwise
read as an oversight to whoever finds it next. The trail of who moved and when
lives in the season log (§ below), not in the scoring cache.

The team's *name and colour* are current too, for the same reason: a constructor
that renames itself renames itself in the record books.

### 5. Equal teams are a house rule, not an invariant

Every team is the same size, so "sum" is fair and `average` would be `sum ÷
teamSize` — a monotone transform that produces an identical ranking. The
`teamConfig.scoring` field stays anyway, as one field and one branch, because
the *only* case where it matters is the one the house rule forbids and someone
will eventually allow.

**Do not enforce equal sizes in `lib/`.** It is a season-wide invariant, so a
transaction cannot check it without a query — and enforcing it would block
creating the third team until the first two are full, which is hostile during
the ten minutes when the commissioner is setting the league up. Surface it
instead:

- the admin Teams section flags uneven teams, and flags a roster that is not a
  multiple of `teamSize` ("9 members, teams of 2 — one player will be teamless"),
- the standings header says so too, since that is where the unfairness shows up.

Shrinking `teamSize` below an existing team's size is **allowed** — it blocks
new joins and kicks nobody. Kicking someone out of a team because a setting
changed is the sort of thing that ends a game night.

### 6. "Players can manage teams" is a mode, not a permission

There is no real auth until Phase 2, so `playerManaged` cannot *stop* anyone
from renaming any team — same honesty as AGENTS.md's line about `/admin` not
being hidden. What it can do, and what `lib/` should enforce, is the soft check
that already works: a player may edit **the team they are on**, resolved through
their claim. That is a real constraint at a real table, and it is not security.
Say so in the comment so nobody later mistakes it for one.

---

## Two invariants that need care, because Firestore

Both are the `claimRacer` problem again: **the web SDK cannot run a collection
query inside a transaction**, so any invariant that spans documents needs the
answer denormalized into a document the transaction can read.

### Team membership is written twice

- `teams/{id}.members: PlayerId[]` — the **capacity** authority. "Is there an
  open slot" is `members.length < teamSize`, answerable from one doc read.
- `members/{playerId}.teamId` — the **exclusivity** authority. "Am I already on
  a team" is one field, answerable from one doc read.

`joinTeam` reads both, checks both, writes both, in one transaction. `leaveTeam`
reads the member doc for `teamId`, then splices that team's array. Neither
invariant can be violated by two phones tapping at once. Same denormalization
bargain as `retired` on the live doc.

### Colour uniqueness

"No two teams share a colour" spans all teams in the season, which a transaction
cannot query. So the season doc carries a claimed-colours map:

```ts
seasons/{id}.teamColors = { ferrari: "team_abc", mercedes: "team_def" }
```

Written by **dot path** (`teamColors.ferrari`), never as a whole map — writing
it whole would clobber a colour someone claimed a second earlier, exactly the
reason `settings` toggles are written by dot path today. Released with
`deleteField()`. The picker reads it from a document it is already streaming, so
taken colours grey out with no extra listener.

Consequence: **the admin cannot remove a palette colour a team currently holds.**
Refuse it in `lib/`, and grey it out in the palette editor for the same reason.

---

## Mutation surface

New file `lib/seasons.ts` (extended) and `lib/teams.ts`. Everything appends a
season event; nothing writes documents from a component.

```ts
// seasons
createSeason(input): Promise<string>
updateSeason(seasonId, patch, who)          // name, scoringConfig, archived — diff event
updateTeamConfig(seasonId, patch, who)      // dot-path writes, like updateRaceSettings
deleteSeason(seasonId)                      // refuses if the season has any race
addSeasonMember(seasonId, name, who)        // + joinRace into scheduled/live races
removeSeasonMember(seasonId, playerId, who) // refuses if they are on a live grid
claimSeasonRacer(seasonId, playerId, uid, currentlyHeld, who)

// teams
createTeam(seasonId, name, colorKey, who)
renameTeam(seasonId, teamId, name, who)
recolourTeam(seasonId, teamId, colorKey, who)   // transactional colour claim
deleteTeam(seasonId, teamId, who)               // releases colour, clears members' teamId
assignToTeam(seasonId, teamId, playerId, who)   // admin path
joinTeam(seasonId, teamId, playerId, who)       // player path, capacity-checked
leaveTeam(seasonId, playerId, who)

// races
createRace(input)                    // seasonId now required and verified
backfillRace(input)                  // see below
amendRaceResult(raceId, order, dnf, note, who)
```

### `backfillRace` — a race the app never timed

Creates the race **already complete**:

- race doc: `status: "complete"`, `backfilled: true`, `result: {order, dnf, teams}`,
  and a **`scheduledAt` the admin picks** — not `serverTimestamp()`, or every
  backfilled race sorts to today and scrambles the season's order. (This is a
  live bug waiting in `createRace` as written.)
- participants with `finalPosition` and `dnf` set, `lapsCompleted: 0`.
- a minimal live doc — `currentPlayerId: null`, `positionOrder: order`,
  `currentRound: 0` — so `useLiveState` and every screen that reads it keep
  working instead of special-casing a race with no live state.
- events: `raceCreated` then `raceFinished`, both `source: "manual"`. **No new
  event variant**, so a replay of the log produces the correct state with zero
  new logic. `backfilled` on the race doc is the cache flag that lets a view say
  "entered afterwards".

`lapCount` and turn duration are meaningless here; take them optionally and
default them.

### `amendRaceResult` — editing a past race

This is the one that could quietly break the project's central rule, so it is
worth stating precisely why it does not. `result` is a **cache of the log**, in
exactly the way the live doc is. Rewriting a cache is fine. Rewriting history is
not. So the amendment:

1. validates the new order the same way `finishRace` does,
2. rewrites `result` and each participant's `finalPosition`/`dnf`,
3. appends **`raceResultAmended`** carrying the new order *and* a
   **`correction`** pointing at the original `raceFinished`.

The original `raceFinished` stays untouched and the history view shows both, in
chronological place. Standings recompute on the next snapshot because they were
never stored. Editing track, date or laps of a past race goes through
`updateRaceSettings`, which already appends a diff — it just needs `scheduledAt`
added to its patch shape.

---

## Scoring

`lib/scoring.ts` stays pure. Two changes and one new function:

```ts
computeStandings(races, config, seasonId, members?: PlayerId[]): SeasonStanding[]
```

`members` seeds a zero row per season member before scoring — that is the whole
of the "+0 for a race they missed" requirement (§1). Optional, so existing
callers and the smoke test are unaffected.

```ts
computeTeamStandings(
  races, config, teams: Team[], members: SeasonMember[], teamConfig,
): TeamStanding[]
```

```ts
interface TeamStanding {
  teamId: string
  points: number
  /** Sum of member finishCounts — the same countback comparator works unchanged. */
  finishCounts: number[]
  memberIds: PlayerId[]
  races: number
  wins: number
}
```

Attribution is **current membership** — teams do not move during a season, so
there is no historical team to look up (§4). Sort by points, then the existing
countback, then teamId. `scoring: "average"` divides by the number of members
who *entered* that race, not by `teamSize`, and with equal full teams it changes
nothing.

A driver on no team contributes to no team and still appears in the drivers
table. A team whose every member missed a race simply scores nothing that week.

---

## Routes and UI

### Player side

```
/                              current season's races, with a season switcher in the header
/season/:seasonId              that season's races (the same page, explicit)
/season/:seasonId/standings    drivers + constructors
/season/:seasonId/teams        team list; join / leave / rename / recolour
/standings                     → redirects to the current season's standings
/race/:raceId/...              unchanged
```

**Recommendation: do not gate `/` behind a season picker.** AGENTS.md is
explicit that the root is the one URL anyone has to know and that it must not
behave differently week to week — that is why the landing deliberately does not
auto-redirect to a single live race. A picker page makes the root a different
page every time the season changes over, and adds a tap to every game night for
a league that has one active season.

Instead: **the root is still a list of races, with the season named in the
header and a switcher next to it.** Same shape forever, deep links still work,
and the season is a control on the page rather than a door in front of it. The
"current" season is the newest non-archived one — or an explicit
`seasons/{id}.current` flag if the commissioner wants to pin it.

If a hard picker really is wanted, it should still be `/` → season list → races,
never a redirect that sometimes fires.

### Teams, on a player's phone

**Put the team panel inside the existing "My racer" tab, not in a fourth tab.**
The panel needs to know who *you* are, which is the claim — and a standalone
Team tab would open on "claim a racer first", which is the My racer screen with
extra steps. Below the car card:

- your team's colour bar and name, tappable to rename/recolour when
  `playerManaged` is on,
- teammates: name, current position, laps, DNF badge, and season points,
- when you have no team: the joinable teams with `n/teamSize` slots, full ones
  greyed rather than hidden (seeing that Ferrari is full is information),
- "Leave team", muted and small, never beside anything else — the same reasoning
  as the reverse gear.

Between game nights there is no race to be in, so `/season/:id/teams` is the
same panel standing alone, reached from the season header.

### Standings view

One page, a segmented control at the top: **Drivers | Constructors**.

Drivers table gains a 4px left border in the driver's team colour — grouping you
can read without a legend — plus **Team** and **Team pts** columns. Sorting is
by column header (points, wins, team points, team rank), remembered per device
in `localStorage` under `formulad:standingsSort`, the same way
`formulad:standingsMode` already is. Sorting by team rank groups teammates
together, which is the constructors view in disguise and worth having.

Constructors table: rank, colour bar, name, points, and its drivers with their
individual points beneath.

Leaders: **👑 next to the leading driver's name**, and for the leading team a
*different* mark — the team's colour rendered as a filled chip with a laurel,
rather than a second crown. Two crowns on one row reads as one thing being
doubly first. Keep both subtle; this is a table, not a podium.

### Admin side

```
/admin                         seasons: create, archive, delete; orphaned-race cleanup
/admin/season/:seasonId        one page, sections: Races · Roster · Teams · Scoring · Settings
```

- **Races**: the season's races, a New race form (roster checklist + drag order),
  a "Backfill a past race" form, and per-race links including Edit result.
- **Roster**: add/remove members, each row showing team and claim state.
- **Teams**: enable toggle, `teamSize`, `playerManaged`, palette editor, and a
  **slot grid** — one card per team showing `teamSize` slots, an empty slot taps
  to a picker of unassigned members. With teams of 2 and a known roster this is
  a handful of taps, and it makes an unequal team or a leftover player visible
  at a glance in a way a dropdown-per-player never does. Colour pickers grey out
  taken colours.
- **Scoring**: the existing `scoringConfig`, finally editable outside the console.

Season deletion: **refuse a season that has races.** Cascading would mean
deleting races, which `deleteRace` already refuses unless complete, for good
reasons. Archive is the action people actually want — offer it first, and keep
delete behind a named confirmation like `deleteRace`'s.

---

## Rules, indexes, migration

**Firestore rules — this will break silently otherwise.** `match
/seasons/{seasonId}` does *not* cover subcollections. Members, teams and season
events each need an explicit nested match, and season events need the same
`allow update, delete: if false` the race events have.

**Composite index required**: `races` on `seasonId ASC, scheduledAt DESC`, for
the scoped race listener. `useRaceList` and `useStandings` both stop reading
every race in the database.

**Migration**, all idempotent scripts in the existing `scripts/` style:

1. `seed-season` already creates `seasons/default`; leave it.
2. `backfill-season-members` — for each race in a season, union its participants
   into `seasons/{id}/members`. Makes the roster real without anyone retyping it.
3. `prune-orphan-races` — races whose `seasonId` resolves to nothing. A one-time
   script rather than a UI, so `deleteRace`'s "finish it first" rule survives
   intact.

No migration for `backfilled` or `teamConfig`: absent is a meaningful value for
both, which is the same rule every other optional field here follows. `finishRace`
and `RaceResult` are unchanged, so no completed race needs touching at all.

---

## Build order

Each step leaves the app working.

1. ~~**Seasons as a real entity**~~ — **done.** Types, `createSeason` /
   `updateSeason` / `deleteSeason`, the season event log, the subcollection
   rules (including `members` and `teams`, ahead of steps 2 and 5), and the
   `seasonId`/`scheduledAt` index. `/admin` lists seasons, `/admin/season/:id`
   carries the races and scoring, and `createRace` verifies its `seasonId`
   instead of defaulting it.
2. ~~**Season roster**~~ — **done.** Members subcollection, `addSeasonMember`
   with its fan-out over unsealed races only, `createRace` pre-filled from the
   roster (the textarea is gone), `backfill-season-members`, and
   `computeStandings` taking `members` to seed zero rows.
3. **Player-side season scoping** — `/season/:id`, the switcher on `/`,
   `/standings` redirect. Season-level claim seeds the race claim.
4. **Backfill and amend** — `backfillRace`, `amendRaceResult`, the admin forms.
   Orphan prune.
5. **Teams, admin side** — `teamConfig`, palette, create/assign, the colour
   claim map.
6. **Teams, player side** — join/leave/rename in My racer and
   `/season/:id/teams`.
7. **Standings rebuild** — `computeTeamStandings` and the two-table view with
   sorting and leader marks. `finishRace` is untouched by any of this.

`scripts/smoke.ts` grows alongside: a season lifecycle, the member fan-out, the
capacity and colour races (two concurrent joins, two concurrent colour claims —
they are the whole reason for the denormalized invariants), backfill, and amend.

## Decided

- **The root is not gated by a season picker.** `/` stays a list of races with
  the season named in the header and a switcher beside it, per the AGENTS.md
  rule that the root must not behave differently week to week.
- **Team scoring is "sum"**, with `teamConfig.scoring` present so a future
  season can disagree without a deploy.
- **Teams are all the same size, and nobody switches teams during a season.**
  House rules, held by convention and surfaced in the UI rather than enforced in
  `lib/` — see §4 and §5 for what each one deletes from the model.
- **`teamSize` is configurable, default 2.** Teams of 2 today; not locked in.
- **The racer claim lives on the season and seeds the race claim.** A phone
  claims once a season; `participants/{id}.claimedBy` is still the in-race truth
  and is still re-tappable, so a stale claim from a borrowed tablet is one tap
  to fix. When Phase 2 brings Google accounts this stops meaning "this device"
  and becomes a real person-to-racer link, which is the shape to build toward.
- **The season event log ships from day one, its view later.** A team move is a
  correction that silently re-derives the whole season's team standings (§4), so
  this log is the only thing that records the move happened at all. The writes
  are trivial; the history view is real work and can wait.

## Open questions

None outstanding. Next step is step 1 of the build order.
