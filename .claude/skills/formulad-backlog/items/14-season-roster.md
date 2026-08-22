# 14 — The season roster

Racers belong to the season, not the race. A race's grid is drawn from the
season roster instead of typed into a textarea.

**Depends on:** 13.

**Model: `docs/seasons-and-teams.md` §1, §2, §3.**

## Why

This is the item the user actually asked for, and the one with the most
misleading obvious implementation. "A player added to a season is added to all
races in that season" reads as a fan-out over every race. It must not be.

## The three rules that shape it

**1. Never write to a finished race.** Adding a member to a sealed race means
editing `result.order` — mutating the scoring cache of a race they did not run
so that standings can read a zero back out of it. That is a lie in the log to
produce a number.

The `+0` requirement falls out for free from making the roster an **input to
`computeStandings`**: seed a zero row per member, then score the races. Someone
who joined in week five appears with 0 points and 0 races entered, and `result`
still records exactly who was on the grid.

So `addSeasonMember` fans out only over **`scheduled` and `live`** races —
usually one, often none. Each is a normal `joinRace` appending its own
`playerJoined` event to that race's log. A loop of transactions, not one
transaction: Firestore cannot query inside a transaction, so the race list is
read first.

**2. A missed race is not a DNF.** A member with no entry scores *nothing*, not
`dnfPoints`. Invisible today at `dnfPoints: 0`; not invisible the first time
someone argues a DNF is worth a point. The standings `races` column means
*races entered*, with the season's race count in the header for contrast.

**3. The roster is not the grid.** Membership is "who is in this league". The
grid is "who is at the table tonight, and in what order". Ken skipping a week
must not remove him from the season.

## Model

```ts
seasons/{seasonId}/members/{playerId}
{ playerId, joinedAt, teamId?: string | null, claimedBy?: string | null }
```

A subcollection, not an array on the season doc: a member carries fields, and
item 17's transactions must be able to read *one* member without reading the
whole league. `teamId` is item 17's and `claimedBy` is item 15's — declare the
type now, populate them there.

`players/{id}` stays global and shrinks to what it should always have been: the
human's name, stable across seasons.

## Mutations

```ts
addSeasonMember(seasonId, name, who)     // member doc + memberAdded + joinRace fan-out
removeSeasonMember(seasonId, playerId, who)
```

`removeSeasonMember` calls `removePlayer` for the season's `scheduled` races and
**refuses if the member is on a live grid** — `removePlayer` already refuses
there, and failing half way through a fan-out is worse than failing up front.
Retiring the car is the in-race answer, as it already is.

## The new-race form

`createRace` pre-fills the grid from the season roster. The form becomes a
**checklist you uncheck absentees from, plus drag for grid order** —
`app/ReorderableList.tsx` and `app/useDragOrder.ts` already exist. The "names,
one per line" textarea goes away, and this is most of the UX win in the whole
seasons/teams arc.

Adding a name that is not on the roster from this form should add them to the
roster too — a new player turning up is normal, and making the commissioner
visit two screens for it is not.

## Scoring

```ts
computeStandings(races, config, seasonId, members?: PlayerId[])
```

`members` seeds a zero row per member before scoring. **Optional**, so existing
callers and the smoke test are unaffected. `lib/scoring.ts` stays pure — no
Firestore, no clock, no I/O.

## Migration

`scripts/backfill-season-members.ts`, idempotent like `seed-season`: for each
race in a season, union its participants into `seasons/{id}/members`. Makes the
roster real without anyone retyping it. Add an npm script.

## Acceptance

- Adding a member writes the member doc, joins them to every `scheduled` and
  `live` race in the season, and touches no completed race.
- That member appears in standings with 0 points and 0 races entered.
- A member with no entry scores nothing, distinct from a DNF.
- The new-race form pre-fills from the roster, unchecks absentees, and drags to
  set grid order; no textarea.
- `removeSeasonMember` refuses a member on a live grid and says why.
- The backfill script is idempotent and populates the roster from past races.
- Smoke coverage for the fan-out, including a season with a completed race in it.
