# 6 — Race settings view

A settings subview per race: edit **track**, **turn seconds**, **laps**, and
**players**. Player edits lock once the race has started. This item also creates
the settings container that items 7, 9 and 11 put their toggles in.

**Depends on:** item 3 (subview routing), item 4 (`turnDurationDefaultMs`).

Route: `app/race/[raceId]/settings/page.tsx`.

**Changed while building, at the user's direction:** this was specified as a
player subview with a tab. It is not one. Race settings is commissioner work and
does not belong in a tab bar a player thumbs through mid-game, so it is a
sibling route beside `/results` — the commissioner's other screen — and is
reached from the race list on `/admin`. Items 7, 9 and 11 put their toggles
there rather than in the player view.

## Where each field lives

| Field | Document | Notes |
|---|---|---|
| track | `races/{id}.track` | free text |
| lapCount | `races/{id}.lapCount` | affects nothing mechanically today |
| turn seconds | `state/live.turnDurationDefaultMs` | from item 4 |
| players | `participants/*` + `live.positionOrder` | locked after start |
| feature toggles | `races/{id}.settings` | new, optional |

Add to `Race` in `lib/types.ts`:

```ts
settings?: {
  betweenRounds?: boolean;   // item 7
  carStatus?: boolean;       // item 11
};
```

Optional, and absent means off, so old races keep working untouched.

## One mutation, one event

Everything goes through a new `lib/race.ts` function — **never** an inline
`updateDoc` from the settings component:

```ts
updateRaceSettings(raceId, patch, who)
```

It writes the race doc and/or the live doc and appends one
`raceSettingsChanged` event carrying the patch. Add the event interface to
`lib/types.ts` and to the `RaceEvent` union, or item 3's history view won't
compile — which is the point.

**Changing turn seconds does not disturb a running turn.** Write
`turnDurationDefaultMs`; the new value takes effect on the next turn. Yanking
the clock out from under the player currently taking their turn is the kind of
thing that starts an argument at the table. If the race is paused, it is safe to
also write `turnDurationMs` — do that, it is what the operator expects.

## "If the game has already started"

There is no clean signal today: `createRace` writes `status: "live"` immediately,
so `scheduled` never actually occurs and `RaceStatus` has a dead variant.

**Recommended:** give `scheduled` its real meaning. `createRace` writes
`status: "scheduled"`, and an explicit **Start race** action flips it to `live`
and anchors the timer. The roster is editable while `scheduled`.

This is the honest fix and it makes item 10.5 coherent (players join before the
flag drops). It ripples: `RaceList`, the player and screen views, and
`scripts/smoke.ts` all currently assume a race is live the moment it exists.
**Confirm this with the user before building it** — it changes the game-night
flow, and that is their call, not yours.

**Fallback if rejected:** add `startedAt?: Timestamp | null` to the race doc, set
by the first `advanceTurn`. Roster locks once it is non-null. Cheaper, but it
leaves `scheduled` dead.

Either way: **removing and reordering** players locks after the start.
**Adding** stays open — that is item 10.5, and a late arrival is normal.

## Removing a player

Removing is not deleting history. It must, in one transaction: delete the
participant doc, remove the id from `positionOrder` **and** `roundOrder` and
`previousRoundOrder` and `retired`, and re-anchor `currentPlayerId` if the
removed player held the turn. Append an event. This is fiddly — it is the reason
removal is locked after the start rather than merely discouraged.

## Acceptance

- Track, laps and turn seconds edit and persist; every change appends an event.
- Changing turn seconds mid-turn does not disturb the running clock.
- Roster editing is locked once started, with the lock explained in the UI, not
  just disabled controls.
- `settings` is absent on old races and everything still renders.
- Smoke coverage for `updateRaceSettings`.
