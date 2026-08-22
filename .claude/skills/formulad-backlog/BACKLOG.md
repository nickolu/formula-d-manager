# Backlog status

Statuses: `todo` · `in progress` · `done` · `blocked`

Update this file when an item changes state. It is the only status record.

## Recommended order

Dependency-driven, not priority-driven. Later items assume earlier routes and
fields exist.

| Order | # | Item | Status | Depends on |
|---|---|---|---|---|
| — | 1 | Drag-to-reorder, mobile-first | **done** | — |
| 1 | 2 | Rename device → player | **done** | — |
| 2 | 5 | Rename edit → results | **done** | — |
| 3 | 12 | Player landing + `/admin` split | **done** | 2 |
| 4 | 3 | Player view IA + history subview | **done** | 2 |
| 5 | 4 | Go back a turn (reset + auto-pause) | **done** | — |
| 6 | 6 | Race settings view | **done** | 3, 4 |
| 7 | 7 | Between-rounds pause step | **done** | 6 |
| 8 | 9 | Delete a race | **done** | 6 |
| 9 | 8 | Notes in results | **done** | 5 |
| 10 | 10 | My Racer identity | **done** | 3 |
| 11 | 10.5 | Join a race | **done** | 10 |
| 12 | 11 | Per-player car status | **done** | 6, 10 |
| 13 | 13 | Seasons as a real entity | **done** | — |
| 14 | 14 | The season roster | **done** | 13 |
| 15 | 15 | Player-side season scoping + season claim | **done** | 13, 14 |
| 16 | 16 | Backfill and amend a race | **done** | 13, 14 |
| 17 | 17 | Teams, admin side | **done** | 13, 14 |
| 18 | 18 | Teams, player side | **done** | 17 |
| 19 | 19 | Standings: drivers and constructors | **done** | 14, 17 |

**Every item is done.** What changed after an item shipped is under "Amended
after shipping"; what is left is under "Still open".

**Land 2 and 5 together in one commit.** They are the same redirect pass and
splitting them means editing `next.config.ts` and every internal link twice.

**Items 13–19 are the seasons and teams arc.** Their shared model lives in
`docs/seasons-and-teams.md` and is authoritative — read it before any of them.
Each step leaves the app working, so they can stop at any boundary.

## Why this order

- The **renames (2, 5)** go first because every later item references the new
  paths. Doing them later means rewriting specs and links mid-flight.
- **12** goes early and is cheap: until the root page points at the player view,
  players have no way to reach the app at all, and every later item is built for
  a screen nobody can get to.
- **3** establishes the subview routing the player view hangs everything off.
  6, 10 and 11 are all subviews of it.
- **4** lands before 6 because it introduces the canonical turn duration field
  that 6's "edit turn seconds" then edits. Doing 6 first means guessing at a
  field 4 will define.
- **6** gates 7, 9 and 11 — each needs a per-race setting and a place to put it.
- **10 before 10.5 and 11**: both need the claimed-racer identity 10 defines.
- **13 is pure plumbing and gates everything after it.** Until a season is a
  real, enumerable document that owns its races, the roster has nowhere to live
  and standings cannot be scoped. It also carries the two things that fail
  *silently* rather than loudly — the Firestore rules for the season
  subcollections, and the `seasonId`/`scheduledAt` composite index — so they
  land before anything depends on them.
- **14 before 15, 16 and 17.** The roster is the thing seasons exist to hold.
  Teams assign from it, backfilled races draw their grid from it, and the "+0
  for a race you missed" requirement is a change to `computeStandings`'s inputs
  that has to exist before any view reads it.
- **16 is independent of 17.** Backfill and amend touch races; teams touch
  seasons. If the user wants this season's history entered before game night,
  16 can jump the queue ahead of 17 without disturbing anything.
- **17 before 18**: `joinTeam`/`leaveTeam` and both denormalized invariants are
  built in 17 even though 18 is what puts them on a phone.
- **19 last.** It is the only item that reads both a roster and a team, and it
  is the one place where getting the order wrong means shipping a standings
  table that is quietly wrong rather than visibly broken.

## Amended after shipping

Rules that changed **after** their item closed, on the user's call while using
the thing. These outrank the item specs, which record what was decided at the
time. Do not re-argue them from a spec file.

- **`dnfPoints` is gone, and a retirement is classified like any other result**
  (amends 14, and `AGENTS.md`'s scoring section twice). The finishing order
  already encodes the retirement — first car out is placed last, the next above
  it — so the order *is* the ranking, and a flat DNF value scored the same fact
  twice while letting a flag override a placing. A retirement now changes
  exactly one column: `dnfs`. Points, wins, podiums, `bestFinish` and the
  countback all read the placing. It had to be all of them: `bestFinish` from
  the placing while excluding that placing from `podiums` puts a best finish of
  third and zero podiums on one row.
- **A sealed race refuses the clock and the turn** (amends `AGENTS.md`'s
  "`advanceTurn` deliberately does not check the race status"). That decision
  rested on "no screen offers it", which was false — the player view fell
  through to the live controls once a race was finished. `refuseIfOver` keeps
  the hot-path bargain instead of reversing it: the extra read happens only when
  `currentPlayerId` is null. A finished race also gets its own read-only screen.
- **Identity is established at the season, and Teams is not a season tab**
  (amends 15 and 18). Item 15 moved the claim to the season but left the only
  screen that could make one inside a race. `/season/:id/racer` is that screen;
  the team panel sits below it, `/season/:id/teams` redirects there, and the
  season subnav is Races / Racer / Standings. In-race "my racer" falls back to
  the season claim when the participant is unclaimed there.
- **A race records `location` and a settable `scheduledAt`.** Free text, because
  the venue is as often "the pub" as "Nick's". Empty clears it, like a
  participant note.
- **`Race.backfilled` has no reader.** The flag stays — it records that the app
  never timed a race, unrecoverable otherwise — but no view surfaces it: at the
  table nobody is telling those two kinds of race apart.

## Still open

Nothing here is blocking, and none of it has a spec yet. Give it a numbered item
when it gets picked up.

- **1b — standings rows overflow at phone width.** See below.
- **Nothing in the seasons and teams arc has been seen at phone width.** There
  was no browser on the machine it was built on, so every mobile-first claim in
  items 13–19 is reasoning rather than observation. The tab bars, the slot grid
  and the two standings tables are the places to look first. This is the single
  largest untested assumption in the arc.
- **Post-game review** — confirm the finishing order before a race is sealed.
  `AGENTS.md` lists it as the next thing after this arc.
- **A history view for the season event log.** Deferred in item 13 on purpose:
  append now, view when someone wants to read it. The data is being written.

## Reopened

- **1b — standings rows overflow at phone width.** Verified by screenshot at
  390px: the list rows in the player view (`name · lap · +lap · DNF · ↑ · ↓`)
  are wider than the viewport, so the ↑/↓ fallback sits off-screen for the
  longer names. Item 1's spec says to reopen this as a mobile polish pass
  rather than fix it silently inside another item — so here it is. The track
  rendering does not have the problem. Not blocking anything.

## Decided for the seasons and teams arc

Settled with the user before any of 13–19 was specced. Recorded here and in
`docs/seasons-and-teams.md`; do not re-litigate them inside an item.

- **`/` is not gated by a season picker.** It stays a list of races with the
  season named in the header and a switcher beside it — the AGENTS.md rule that
  the root must not behave differently week to week.
- **Team scoring is "sum"**, with `teamConfig.scoring` present so a future
  season can disagree without a deploy.
- **Every team is the same size, and nobody switches teams during a season.**
  House rules, surfaced in the UI rather than enforced in `lib/`. They delete
  the `result.teams` snapshot and the historical-attribution machinery entirely.
- **`teamSize` is configurable, default 2.**
- **The racer claim lives on the season and seeds the race claim.** The in-race
  claim stays authoritative and re-tappable; "my racer" is still derived.
- **The season event log ships from day one, its view later.** A team move
  silently re-derives the season's team standings, and this is the only thing
  that records the move happened.

## Open questions

Not blocking, but they will surface. Decide when the item comes up, then record
the answer in the spec file and in `AGENTS.md`.

- ~~**Is "current season" the newest non-archived one, or an explicit flag?**~~
  **Resolved in item 15: newest non-archived**, derived in `useCurrentSeason`
  so nothing has to be remembered to be set. A `seasons/{id}.current` flag read
  in that one hook is the whole change if pinning is ever wanted.
- **Does the season event log get a history view?** Deferred deliberately in
  item 13 — append now, view when someone wants to read it.
- ~~**How does a player get the URL?**~~ **Resolved by item 12:** `/` becomes a
  player landing listing races, so the site root is the only URL anyone needs and
  it never changes between game nights. Nothing further to build.
- **Is the settings subview commissioner-only?** There is no auth to enforce it
  with (Phase 2 adds real accounts). Item 9 puts race deletion behind it.
  Interim answer in item 6: keep it reachable but visually separated, and gate
  destructive actions behind confirmation.
- ~~**"If the game has already started"**~~ **Resolved in item 6, confirmed by
  the user:** `scheduled` was given its real meaning. `createRace` writes
  `status: "scheduled"` with the clock stopped, and an explicit `startRace`
  flips it to `live`. The roster is editable only while scheduled.
