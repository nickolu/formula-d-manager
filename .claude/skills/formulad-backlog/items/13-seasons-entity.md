# 13 — Seasons as a real entity

Make the season a thing that exists, is created and edited in the app, and that
every race verifiably belongs to. This is plumbing: no player-visible change
beyond `/admin` growing a season layer.

**Depends on:** nothing. It gates 14–19.

**The model is `docs/seasons-and-teams.md`, and it is authoritative.** Read it
before this file. Decisions recorded there are not to be re-litigated here.

## Why

Today `createRace` writes `seasonId: "default"` against a document that may not
exist, `seasons/default` is created by a seed script, and `/standings`
hardcodes the id. Nothing in the app can make a second season. Every later item
— roster, teams, backfill, per-season standings — assumes a season is real,
enumerable, and the owner of its races.

## Model

Per the design doc. This item ships:

- `Season` gains `archived?: boolean`. Absent means active — the usual
  "absent is meaningful" rule.
- `seasons/{id}/events/{eventId}`, same shape as race events: `at`, `source`,
  `actor`, and a `SeasonEvent` discriminated union in `lib/types.ts`.
- `Race.seasonId` stops being defaulted. `createRace` takes it, verifies the
  season exists, and refuses without one.

`teamConfig` and `teamColors` are item 17's; do not add them here.

## Mutations — `lib/seasons.ts`

```ts
createSeason(input): Promise<string>
updateSeason(seasonId, patch, who)   // name, scoringConfig, archived — appends a diff
deleteSeason(seasonId)               // refuses a season that has any race
```

Same shape as `lib/race.ts`: one transaction, document write plus event append,
never a bare `updateDoc` from a component. `updateSeason` appends
`seasonSettingsChanged` carrying **only the fields that changed**, exactly as
`updateRaceSettings` does — the log reads as a diff, not a snapshot.

`deleteSeason` **refuses a season with races.** Cascading would mean deleting
races, and `deleteRace` already refuses anything not `complete` for good
reasons. Archive is what people actually want; offer it first and keep delete
behind a named confirmation, matching `deleteRace`'s existing UI.

## The season event log ships now, its view later

Decided with the user. Nothing replays this log and Phase 3's chatbot does not
write to it — it has none of the jobs the race log has. It earns its place on
one narrow ground: from item 17 on, a team move silently re-derives the whole
season's team standings, and this is the only thing that will record the move
happened. Unrecoverable after the fact, trivial to write now.

So: append from day one. **Do not build a history view for it in this item.**

## Firestore rules — write all the season subcollections now

`match /seasons/{seasonId}` does **not** cover subcollections. A missing nested
match is a silent permission denial at the table, not a build error.

Add matches for `events` (with `allow update, delete: if false`, like race
events), **and for `members` and `teams` even though items 14 and 17 create
them.** Rules are one file; a partial ruleset means the next item ships and
mysteriously cannot write.

## Index

`races` needs a composite index on `seasonId ASC, scheduledAt DESC` for the
scoped race listener item 15 introduces. Add `firestore.indexes.json` and
create it now, before something needs it mid-game-night.

## Files

- `lib/types.ts` — `Season.archived`, `SeasonEvent` union, `SeasonEventSource`
  reuses `EventSource`.
- `lib/seasons.ts` — the mutations above, alongside the existing `ensureSeason`.
- `lib/hooks.ts` — `useSeasons()`, `useSeasonEvents(seasonId)`.
- `firestore.rules`, `firestore.indexes.json`.
- `app/admin/page.tsx` — becomes a season list plus a New season form.
- `app/admin/season/[seasonId]/page.tsx` — new. Server component awaits
  `params`, hands the id to a `"use client"` child. The existing `NewRaceForm`
  and admin `RaceList` move here, scoped to the season.
- `lib/setup.ts` — `createRace` requires and verifies `seasonId`.
- `scripts/smoke.ts` — season lifecycle coverage.

## Acceptance

- A season can be created, renamed, its scoring edited, and archived from
  `/admin`, with each change appending a season event.
- `deleteSeason` refuses a season that has races, and says why.
- `createRace` refuses a missing or unknown `seasonId`.
- Archived seasons drop out of pickers and keep their standings reachable.
- Rules deployed with `members` and `teams` matches present, events append-only.
- The composite index exists.
- `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm run smoke` clean.
