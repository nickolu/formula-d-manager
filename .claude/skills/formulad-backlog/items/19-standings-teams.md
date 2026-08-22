# 19 — Standings: drivers and constructors

Rebuild the standings view around two tables, with team scores, sorting, and a
mark for each leader.

**Depends on:** 14, 17.

**Model: `docs/seasons-and-teams.md` — "Scoring" and "Standings view".**

## Scoring stays pure

`lib/scoring.ts` has no Firestore, no clock, no I/O, and that is what lets house
rules be re-argued against past seasons. Keep it that way.

**Built with a smaller signature than this spec first proposed**, and the
change is recorded here rather than argued again later:

```ts
computeTeamStandings(races, config, teams, teamConfig?, seasonId?): TeamStanding[]
```

The `members: SeasonMember[]` argument is gone. `Team.members` already answers
"who is on this team" — it is the capacity authority item 17 denormalized, and
it is written in the same transaction as `SeasonMember.teamId`, so passing both
would have been passing the same fact twice. `seasonId` was *added*, because
unscoped races would quietly fold another season's points into this one's team
table — wrong rather than broken, which is the failure mode this item warns
about.

```ts

interface TeamStanding {
  teamId: string
  points: number
  finishCounts: number[]   // sum of member finishCounts — the existing countback works unchanged
  memberIds: PlayerId[]
  races: number
  wins: number
}
```

**Attribution is current membership.** Teams do not move during a season
(item 17's house rule), so there is no historical team to look up and
`RaceResult` is untouched. Comment *why*, including the consequence: when
someone is moved, that is a correction of a recording error, and re-deriving the
whole season's team standings is the right behaviour for a correction — not a
bug.

`scoring: "average"` divides by the members who *entered* that race, not by
`teamSize`. With equal full teams it changes nothing; it exists for the day the
house rule bends.

A driver on no team contributes to no team and still appears in the drivers
table. A team whose every member missed a race scores nothing that week.

## The view

One page, a segmented control at the top: **Drivers | Constructors**.

**Drivers** — the existing table plus:

- a **4px left border in the driver's team colour** — grouping you can read
  without a legend,
- **Team** and **Team pts** columns,
- `races` still means *races entered*; the season's race count goes in the
  header (item 14), so a member on 0 of 5 reads correctly rather than looking
  broken.

**Constructors** — rank, colour bar, name, points, and its drivers with their
individual points beneath.

**Sorting** by column header — points, wins, team points, team rank — remembered
per device in `localStorage` under `formulad:standingsSort`, the way
`formulad:standingsMode` already is, read through `useSyncExternalStore` so SSR
and hydration agree without an effect. Sorting by team rank groups teammates
together, which is the constructors view in disguise and worth having.

**Leaders** — 👑 next to the leading driver's name, and for the leading team a
*different* mark: the team's colour as a filled chip with a laurel. Two crowns
on one row reads as one thing being doubly first. Keep both subtle; this is a
table, not a podium.

If teams are uneven, say so in the header — that is where the unfairness shows
up (item 17).

## Files

- `lib/scoring.ts` — `computeTeamStandings`, `TeamStanding`.
- `lib/hooks.ts` — `useTeamStandings(seasonId)`, derived like `useStandings`
  from listeners already open.
- `app/season/[seasonId]/standings/` — the two-table view.
- `app/standings/StandingsTable.tsx` — stops hardcoding `DEFAULT_SEASON_ID`.

## Acceptance

- Team points equal the sum of their members' season points, and re-derive when
  a member is moved.
- Both tables sort by every offered column and remember the choice per device.
- The leading driver and leading team carry visibly *different* marks.
- Team colours read at a glance without a legend, and are distinguishable to
  someone who cannot rely on hue alone.
- A driver with no team, and a team whose members all missed a race, both render
  correctly.
- With teams disabled the Constructors control does not appear at all.
- Works at phone width; the tables scroll horizontally rather than the page.
- `lib/scoring.ts` still imports nothing from Firestore.
