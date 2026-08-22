# 10 — My Racer

The identity step. A player lands cold on the player view and needs to say which
car is theirs. Per the paradigm, **a visitor with no claimed racer is the common
case** — this is the front door, not a side feature.

**Depends on:** item 3 (subview routing).

Route: `app/race/[raceId]/player/my-racer/page.tsx`, plus its tab.

## Identity without accounts

There is no login (Phase 2 adds real accounts). Use the **anonymous auth uid**
that `AuthGate` already establishes — it is stable per device, which is exactly
the granularity wanted: one phone, one racer.

`app/AuthGate.tsx` currently doesn't expose the uid. Add a `useUid()` hook to
`lib/hooks.ts` (or lift it through AuthGate) rather than calling `getAuth()`
ad-hoc from components.

## Claims are shared state, not local

The requirement "a player cannot select a racer another player has selected"
makes this shared state. It cannot live in `localStorage`.

`Participant` in `lib/types.ts` gains `claimedBy?: string | null` — the uid.

**Do not also store the local selection.** "My racer" is derived: the participant
whose `claimedBy` equals this device's uid. Derived, never stored — the same rule
`computeStandings` and `lib/cars.ts` follow, and it means the two halves can
never disagree.

New `lib/race.ts` functions:

```ts
claimRacer(raceId, playerId, uid, who)     // refuses if claimed by another uid
releaseRacer(raceId, playerId, uid, who)
```

`claimRacer` **must** be a transaction that re-reads `claimedBy` and throws if it
belongs to someone else. Two phones tapping the same racer at the same moment is
a real race at a table, not a theoretical one. Claiming while already holding a
different racer releases the old one in the same transaction.

Both append events (`racerClaimed` / `racerReleased`) — add them to the union.

## The flow

**Unclaimed:** a list of the race's racers — car label and colour from
`lib/cars.ts`, name, and a clear marker on already-claimed ones. Claimed racers
are visible but not selectable; hiding them makes a player think their friend is
missing. Also present the **Join race** action here (item 10.5).

**Tap a racer** → modal overview: name, car label/colour, start position, laps
completed, retired status, note (item 8), car status (item 11 when enabled) —
and a **Select racer** button. The modal must work one-handed at phone width:
full-height sheet, large dismiss target, no hover-dependent affordances.

**Claimed:** the list is replaced by that racer's overview, plus **Change racer**,
which releases the claim and returns to the list.

## Watch out for

- A claim is a live subscription, not a fetch. If someone else claims a racer
  while the list is open, it must update — `useParticipants` already streams.
- Handle the claim transaction throwing. Show "someone just took that one" and
  refresh, don't leave a spinner.
- `releaseRacer` on a uid that no longer holds the claim is a no-op, not an error.
- Old races have no `claimedBy` anywhere. Everything is unclaimed. That is fine.

## Acceptance

- A cold landing with no claim shows the racer list.
- Claiming persists across reload on the same device.
- A racer claimed on device A cannot be claimed on device B.
- Change racer returns to the list and frees the claim.
- The modal is usable one-handed at phone width.
- Smoke coverage for `claimRacer` (including the contested case) and
  `releaseRacer`.
