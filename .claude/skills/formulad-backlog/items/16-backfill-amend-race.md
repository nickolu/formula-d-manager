# 16 — Backfill a past race, and amend a finished one

Enter a race the app never timed, and correct a race it did.

**Depends on:** 13, 14.

**Model: `docs/seasons-and-teams.md` — "`backfillRace`" and "`amendRaceResult`".**

## `backfillRace`

Creates the race **already complete**:

- race doc: `status: "complete"`, `backfilled: true`, `result: {order, dnf}`,
  and a **`scheduledAt` the admin picks**.
- participants with `finalPosition` and `dnf` set, `lapsCompleted: 0`.
- a minimal live doc — `currentPlayerId: null`, `positionOrder: order`,
  `currentRound: 0` — so `useLiveState` and every screen reading it keep working
  instead of special-casing a race with no live state.
- events: `raceCreated` then `raceFinished`, both `source: "manual"`.

**No new event variant.** A replay of the log produces the correct state with
zero new logic; `backfilled` on the race doc is the cache flag that lets a view
say "entered afterwards". `lapCount` and turn duration are meaningless here —
take them optionally and default them.

### The `scheduledAt` bug this exposes

`createRace` hardcodes `scheduledAt: serverTimestamp()`. Backfill **must** take
a date, or every backfilled race sorts to today and scrambles the season's
order. Fix it in `createRace`'s input too while the file is open.

## `amendRaceResult`

This is the one that could quietly break the project's central rule, so state
plainly in the code why it does not: **`result` is a cache of the log**, exactly
as the live doc is. Rewriting a cache is fine. Rewriting history is not.

```ts
amendRaceResult(raceId, order, dnf, note, who)
```

1. validates the new order the way `finishRace` does — no duplicates, nobody
   missing, no strangers,
2. rewrites `result` and each participant's `finalPosition`/`dnf`,
3. appends **`raceResultAmended`** carrying the new order, **and** a
   `correction` pointing at the original `raceFinished`.

The original `raceFinished` is untouched. Standings recompute on the next
snapshot because they were never stored.

`HistoryView.tsx`'s `describe()` switches exhaustively over `RaceEvent` and ends
in a `never` assignment — **adding `raceResultAmended` without describing it
fails `npx tsc --noEmit`**, which is the point. Describe it.

Editing a past race's track, date or laps goes through `updateRaceSettings`,
which already appends a diff. It needs `scheduledAt` added to its patch shape.

## Orphaned races

Races whose `seasonId` resolves to nothing get pruned by
`scripts/prune-orphan-races.ts` — a one-time script rather than a UI, so
`deleteRace`'s "finish it first" rule survives intact. Idempotent, and it should
print what it would delete before deleting it.

## Files

- `lib/setup.ts` — `backfillRace`, `createRace` takes `scheduledAt`.
- `lib/race.ts` — `amendRaceResult`; `updateRaceSettings` patch gains
  `scheduledAt`.
- `lib/types.ts` — `Race.backfilled`, `RaceResultAmendedEvent` in the union.
- `app/race/[raceId]/player/history/HistoryView.tsx` — describe the new event.
- `app/admin/season/[seasonId]/` — the backfill form and an Edit result form.
- `scripts/prune-orphan-races.ts` + npm script.

## Acceptance

- A backfilled race appears in standings with correct points and sorts by its
  chosen date, not by today.
- Every screen renders a backfilled race without special-casing.
- Amending a result changes standings, leaves `raceFinished` intact, and shows
  both the amendment and a correction in the history view.
- The amendment validates the order and refuses a partial one.
- The prune script is idempotent and reports before it deletes.
- Smoke coverage for both mutations, including a rejected partial amendment.
