# 9 — Delete a race

From the settings subview, behind a confirmation dialog. Refuse to delete a race
that is still in progress.

**Depends on:** item 6 (the settings subview).

## The constraint that shapes this

**The event log cannot be deleted.** `firestore.rules` sets
`allow update, delete: if false` on `races/{raceId}/events/{eventId}`, on
purpose — corrections append, they never mutate.

So "delete a race" means deleting the race doc, the live state doc, and the
participant docs, and **leaving the events orphaned**. They become invisible to
the app: nothing queries events except scoped to a race that no longer exists.
This is already how `scripts/smoke.ts` cleans up after itself, and it is
documented as by-design in `AGENTS.md`.

Do not try to work around it by loosening the rules.

## Reference implementation

`scripts/smoke.ts` lines ~348–354 do exactly this teardown: enumerate
participants, `deleteDoc` each, then the live doc, then the race doc. Firestore
has no client-side recursive delete — subcollections must be enumerated.

Put it in `lib/race.ts` as `deleteRace(raceId)` so the rule that all race
mutations live there holds. It is the one function that **cannot** append an
event — there would be nowhere to append it to. Say so in a comment; an
unexplained exception to the project's central rule will read as a bug.

Delete in this order: participants → live doc → race doc. The race doc last, so a
failure part-way leaves a findable race rather than orphaned subcollections.

## Guards

- **Refuse unless `status === "complete"`.** Check it inside `deleteRace`, not
  only in the UI. "Have to end it first" is a data rule, not a button state.
- Confirmation dialog naming the race (track and date). A generic "Are you sure?"
  on a phone gets tapped through.
- **Warn that it changes season standings.** Standings are derived from finished
  races, so deleting one silently rewrites the table. That is the consequence
  people won't predict, and it belongs in the dialog text.

## Afterwards

Navigate to `/` — the race the player was on no longer exists. Every view
subscribed to it gets a null snapshot; make sure they render "race not found"
rather than crashing. `useLiveState` already returns `null` for a missing doc, so
check the consumers, not the hook.

## Acceptance

- Deleting a complete race removes race, live and participant docs.
- A live or scheduled race cannot be deleted, enforced in `lib/race.ts`.
- The dialog names the race and warns about standings.
- Open views on a deleted race show "not found" and don't crash.
- Standings recompute without it.
- Smoke coverage for both the refusal and the successful delete.
