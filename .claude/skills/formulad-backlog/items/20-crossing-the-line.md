# 20 — Crossing the line

A car that has run its last lap has **finished**. It stops taking turns, it is
not a DNF, and the order cars cross the line in *is* the finishing order.

**Depends on:** items 6 (race settings), 7 (the `phase` field), 8 (the results
view as the correction surface). All done.

## The gap this closes

Before this, a live race gave a car exactly two states: racing, or retired.
Crossing the line was nowhere. `finishRace` sealed the *whole* race at once from
an order a human dragged in the results view, and `Participant.finalPosition`
was written nowhere else.

So when the leader finished, both options at the table were wrong:

- leave them in — they keep coming up in `roundOrder` and eating turns they
  cannot take, with a clock running red on a car parked in the pits;
- retire them with `setDnf` — they stop taking turns, but they are now flagged
  DNF on every screen and land in `result.dnf`, so the standings `dnfs` column
  counts a win as a retirement.

`race.lapCount` ("laps required to finish") and `participant.lapsCompleted`
both already existed. Nothing compared them.

## Decided with the user before building

1. **Finishing is derived from laps, not a flag someone sets.**
   `lapsCompleted >= race.lapCount` — so raising `lapCount` in race settings
   puts a car back in the race, which is the correct behaviour for "we set the
   race length wrong".
2. **A race that runs out of cars seals itself, and nobody is asked to confirm
   it.** The first version of this spec parked the race on nobody's turn and
   offered the derived order for approval. The user reversed it while it was
   being built: *"we don't need them to confirm race finish. Admin can undo it
   from the admin views."* Right call — the confirmation put a tap on every
   game night to guard against a mis-tap that is undone in one tap afterwards.

Decision 1 shapes everything else, and it is the same rule as standings, "my
racer" and car identity: **derived, never stored.** Decision 2 is what deleted a
whole state: there is **no `raceOver` phase**, no confirmation screen, and
nobody's turn still means exactly two things.

Decision 2 has a cost, and paying it is part of this item: without a
confirmation before the seal there must be a real way back after it. That is
`reopenRace`.

## No new event variants for finishing, deliberately

There is **no `carFinished` event**, and this is the same reasoning that keeps
`rewindTurn` to a single `turnRewound`: *"a rewind leaves the race paused with a
fresh clock" is a rule of the system, not a separate thing that happened, so a
replay applies it without a second event.*

What happened at the table is that a car completed a lap — `lapCompleted`,
already in the log — or that a car retired — `dnfChanged`, already in the log.
"The car that completes lap *n* of *n* has finished" and "a race with nobody
left to take a turn is over" are rules applied to those facts. A replay derives
both, and an automatic seal appends the same ordinary `raceFinished` a manual
one does.

If this ever wants a `carFinished` event, that is a sign the derivation has been
abandoned and decision 1 with it.

**`raceReopened` is the exception, and it is not one.** Reopening is not a rule
applied to other facts — it is a commissioner deciding something, unrecoverable
from anything else in the log. So it gets an event, like every other decision.

## The state

### `LiveState.finished?: PlayerId[]`

Optional (absent means nobody has), and **ordered by the order cars crossed the
line** — which is what makes it the finishing order rather than a set.

It is a **cache of the derivation**, exactly the bargain `retired` already
strikes: `advanceTurn` is the hot path and must skip finished cars from a single
document read, and every open listener gets the state for free. The authority
is `lapsCompleted >= lapCount`; the cache is maintained by the three mutations
that can move either side of that comparison — `completeLap`, `uncompleteLap`,
and `updateRaceSettings` when it changes `lapCount`.

Views read the cache, exactly as they read `retired`. There is one source of
truth for rendering: the live doc.

### `LiveState.phase` is unchanged

Still `"turn" | "betweenRounds"`. A third value was specced and then deleted by
decision 2: a race with nobody left is `status: "complete"`, so nobody's turn
still means exactly two things and every view's existing discrimination — race
status first, never the null `currentPlayerId` — is untouched.

## Turn selection

`nextRunner`'s skip set becomes retired **∪** finished, through one pure helper
in `lib/turn.ts`:

```ts
export function outOfPlay(live): Set<PlayerId>
```

Used by `projectAdvance`, `projectStartRound`, `rewindTurn` and the views, so
the transaction and the optimistic render cannot drift — the reason `lib/turn.ts`
exists at all.

Cars are skipped **at selection time**; `roundOrder` is not filtered. Same rule
as retirement, and for the same reason: it keeps the snapshot faithful to the
round that actually started, it keeps the `turnIndex`/`alreadyMoved` arithmetic
in the views working, and it is what makes un-finishing reversible mid-round.

## Sealing

`projectAdvance` used to **throw** `"Every car has retired"` when no runner was
left. That throw was a dead end — retire everyone and the race could not be
advanced, rewound or escaped. It returns **null** now, meaning "the race is
over", and `advanceTurn` seals instead of reporting. Null rather than a third
phase, for the reason above.

**`completeLap` and `setDnf` seal too, when they account for the last car** —
which is the normal path, since a race ends on the last car crossing the line or
going out, not on somebody tapping Next turn afterwards. `advanceTurn` and
`startRound` keep the seal as a backstop for a race that predates all of this,
where retiring everyone is the only way to run out of cars.

This is not a reversal of *"setDnf deliberately does not move the turn on — the
human taps Next turn and auto-advancing would fight the person holding the
tablet"*. That rule is about moving the turn **to another car**. There is no
other car.

One `seal()` helper writes the race doc, the live doc, every participant's
`finalPosition` and the `raceFinished` event, and both `finishRace` and the
automatic path go through it — two copies would drift on the first field either
one gains.

## The derived finishing order

```ts
export function proposedFinishingOrder(live): PlayerId[]
```

Pure, in `lib/turn.ts` beside the other pure functions of the live doc, and what
an automatic seal uses:

1. `finished`, **in crossing order** — first across is first;
2. anyone still running, by `positionOrder`;
3. retirees, in **reverse** retirement order — the first car out is placed
   last, which is the classification rule `AGENTS.md` already states, and
   `retired` is insertion-ordered so the information is there.

Every part of it is something the table entered. It stays a derivation rather
than a rule: `finishRace` and `amendRaceResult` validate whatever order they are
handed, so a commissioner can disagree with all of it.

## `reopenRace` — the undo that replaces the confirmation

Sets the race back to `live`, `deleteField()`s `result`, clears every
`finalPosition`, and appends `raceReopened` carrying the result it cleared.

- **It is not an amendment.** `amendRaceResult` fixes an order that was merely
  wrong; this is for a race that is not over — a mis-tapped final lap on the
  last car running, which no amendment can express.
- **It does not edit history.** The `raceFinished` event stays exactly where it
  is. What is undone is the *cache* — `result` on the race doc and
  `finalPosition` on the participants — which is the same licence
  `amendRaceResult` takes and for the same stated reason.
- **The race comes back through the interstitial**: paused, full clock, nobody's
  turn. Guessing whose turn it was when the race ended would invent something
  nobody recorded.
- It lives in race settings, beside delete, because that is the commissioner's
  screen and this is the commissioner's undo.

## The screens

- **No new screen.** A sealed race already has one on the player view and the
  big screen, and an automatic seal arrives there the same way a manual one
  does. That is the whole dividend of decision 2.
- A finished car reads as **finished, not retired**, wherever a retired one is
  marked: a chequered badge rather than the DNF strike-through, in the player
  list, the track view, the big screen and the results view.
- **`+lap` is disabled on a finished car.** There is no lap left to complete.
  The undo for a mis-tapped final lap is the results view's `−`, the same place
  every other mis-tapped lap is undone.
- **Race settings** gets **Reopen this race**, shown only on a finished race,
  above the Danger section rather than in it — it destroys nothing.

## Acceptance

- A car reaching `lapCount` stops being offered turns, without being a DNF, and
  without a new event type appearing in the log.
- Raising `lapCount` in race settings puts it back in the race and un-parks.
- Lowering `lapCount` finishes everyone who is already past it.
- With every car finished or retired, the race seals itself, with a `result`
  whose order is crossings-then-retirements and whose `dnf` holds only the
  retirees — and one ordinary `raceFinished` in the log.
- A sealed race reopens with its laps and retirements intact, on nobody's turn,
  and seals again on the next tap.
- A race that predates `finished` (absent field) behaves exactly as it did.
- Retiring the last running car ends the race instead of throwing "Every car
  has retired" — the dead end this item removes.
