# 7 — A pause between rounds to confirm turn order

After every car has moved, stop on nobody's turn so the table can confirm the
order for the next round. Disable-able from race settings.

**Depends on:** item 6 (the settings container).

This fits the existing model well: `positionOrder` changes mid-round already
take effect next round. This item just makes that handoff visible instead of
instantaneous.

## The state

Add to `LiveState` in `lib/types.ts`:

```ts
phase?: "turn" | "betweenRounds";
```

Optional; absent means `"turn"`, so old races behave exactly as now.

When `advanceTurn` rolls over and `race.settings.betweenRounds` is on, instead of
selecting the next round's first car:

- `phase: "betweenRounds"`
- `currentPlayerId: null`
- `turnStartedAt: null` (paused — the pause is free, it is just the null anchor)
- snapshot `roundOrder` from `positionOrder` and increment `currentRound` as it
  does today, and keep saving `previousRoundOrder`

A new `lib/race.ts` function — `startRound(raceId, who)` — leaves the interstitial:
sets `phase: "turn"`, selects the first non-retired car in `roundOrder`, anchors
the clock, and appends `roundStarted`.

**Move the `roundStarted` event to `startRound`.** It should mark the round
actually beginning, not the moment the previous one ended. When the feature is
off, `advanceTurn` keeps emitting it inline as it does today.

## Distinguishing this from a finished race

`finishRace` also sets `currentPlayerId: null`. Every view that asks "is it
nobody's turn?" must not confuse the two. Discriminate on `race.status`
(`"complete"`) — not on the null player. Check the screen view as well as the
player view.

## Interaction with rewind

`rewindTurn` must handle being called while in `betweenRounds`: step back into
the previous round's last car, restore `phase: "turn"`, `roundOrder` from
`previousRoundOrder`, and decrement `currentRound`. This is close to the existing
round-boundary branch — reuse it rather than writing a parallel path.

## The UI

The player view's turn-order subview shows a distinct interstitial state: "Round
N — check the order", the standings still draggable, and one large **Start
round N** button. The screen view needs its own rendering of it too; a big screen
showing nobody's turn with no explanation reads as a bug from across the room.

## Default

**On for new races, off for races that predate the field.** Write
`settings.betweenRounds: true` in `createRace`; absent stays off. The user asked
for this on by default, and silently changing the flow of a race already in
progress is worse than an old race not getting a new feature.

## Acceptance

- With it on: the last car of a round advances into the interstitial, paused.
- **Start round** selects the leader and anchors a fresh clock.
- With it off: rollover behaves exactly as it does today.
- Rewinding out of the interstitial lands on the previous round's last car.
- Retired cars are still skipped when selecting the round's first car.
- Smoke coverage for the interstitial and for `startRound`.
