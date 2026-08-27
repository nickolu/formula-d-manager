import type { LiveState, PlayerId } from "./types";

/**
 * Pure functions of the live doc — no Firestore, no clock, no I/O, in the shape
 * of `lib/scoring.ts` and `lib/cars.ts`. Two questions live here: whose turn it
 * is next, and who is still in the race.
 *
 * The first exists because two things now have to agree on the answer.
 * `advanceTurn` writes it, and the player view *renders* it before the write
 * lands — a Firestore transaction gets no latency compensation, so the device
 * that taps Next turn is the last one to find out what happened. If the view
 * predicted the next turn with its own copy of this arithmetic, the two would
 * drift on the first retired car or round boundary. One function, two callers.
 *
 * The second is here for the same reason: "has this car finished" is a
 * derivation, and the transaction that skips a finished car and the screen that
 * greys it out must not disagree about it.
 */

/**
 * Cars that are not taking turns any more — retired **or** finished.
 *
 * Two different facts, one consequence for turn selection, so callers ask this
 * rather than remembering to union the two lists. A finished car is not a DNF
 * and nothing downstream may treat it as one; this is the only place they are
 * ever the same thing.
 */
export function outOfPlay(
  live: Pick<LiveState, "retired" | "finished">,
): Set<PlayerId> {
  return new Set([...(live.retired ?? []), ...(live.finished ?? [])]);
}

/** First car at or after `from`, walking in `step`, that is still in the race. */
export function nextRunner(
  order: PlayerId[],
  skip: Set<PlayerId>,
  from: number,
  step: 1 | -1,
) {
  for (let i = from; i >= 0 && i < order.length; i += step) {
    if (!skip.has(order[i])) return i;
  }
  return -1;
}

/**
 * Nobody is left to take a turn: every car on the grid has finished or retired.
 *
 * This is the condition that seals a race. It is deliberately not confirmed by
 * anyone — a race whose cars are all home is over, and asking the table to
 * agree adds a tap to every game night to guard against a mis-tap the
 * commissioner can undo afterwards.
 */
export function isRaceOver(
  live: Pick<LiveState, "positionOrder" | "retired" | "finished">,
): boolean {
  const skip = outOfPlay(live);
  return (
    live.positionOrder.length > 0 && live.positionOrder.every((id) => skip.has(id))
  );
}

/**
 * The finished list, re-derived after something moved either side of
 * `lapsCompleted >= lapCount` — which in practice means the race length was
 * edited, since the lap mutations know which car they touched.
 *
 * Cars that were already finished and still qualify **keep their place**: the
 * list is a crossing order, and re-deriving it must not silently reshuffle who
 * came first. Cars that newly qualify are appended in `positionOrder`, which is
 * the best available guess at an order nobody recorded — lowering the race
 * length mid-race retro-finishes several cars at once and no lap count can say
 * which of them got there first.
 */
export function deriveFinished(
  previous: PlayerId[],
  positionOrder: PlayerId[],
  lapsOf: (id: PlayerId) => number,
  lapCount: number,
): PlayerId[] {
  const done = (id: PlayerId) => lapsOf(id) >= lapCount;
  const kept = previous.filter((id) => positionOrder.includes(id) && done(id));
  const added = positionOrder.filter((id) => done(id) && !kept.includes(id));
  return [...kept, ...added];
}

/**
 * The finishing order the race itself recorded — what a race that ends on its
 * own is sealed with, and the default the results view offers.
 *
 * Every part of it is a fact the table entered: who crossed the line and in
 * what order, who was still running, and who went out when. Nothing here
 * invents a placing. It stays a *derivation* rather than a rule, though:
 * `finishRace` and `amendRaceResult` validate whatever order they are handed,
 * so a commissioner can disagree with all of it.
 *
 * 1. Cars that crossed the line, in the order they crossed it.
 * 2. Anyone still running, by current standings.
 * 3. Retirees in **reverse** retirement order — the first car out is placed
 *    last, the next one above it. That is the classification rule the scoring
 *    section states, and `retired` is insertion-ordered, so the information to
 *    honour it is already there.
 */
export function proposedFinishingOrder(
  live: Pick<LiveState, "positionOrder" | "retired" | "finished">,
): PlayerId[] {
  const finished = (live.finished ?? []).filter((id) =>
    live.positionOrder.includes(id),
  );
  const retired = (live.retired ?? []).filter(
    (id) => live.positionOrder.includes(id) && !finished.includes(id),
  );
  const running = live.positionOrder.filter(
    (id) => !finished.includes(id) && !retired.includes(id),
  );
  return [...finished, ...running, ...retired.reverse()];
}

/**
 * The fields a turn change writes to the live doc. Deliberately only the ones
 * that describe *whose turn it is* — the clock is anchored separately, since
 * the transaction anchors it with a server timestamp and the optimistic render
 * has only the local one.
 */
export interface TurnProjection {
  phase: "turn" | "betweenRounds";
  currentPlayerId: PlayerId | null;
  currentRound: number;
  roundOrder: PlayerId[];
  /** Set only at a rollover, which is the only time roundOrder is destroyed. */
  previousRoundOrder?: PlayerId[];
  roundOver: boolean;
}

/**
 * Where the turn goes next, or **null when there is nowhere for it to go** —
 * every car has finished or retired and the race is over.
 *
 * That case used to throw `"Every car has retired"`, which was a dead end:
 * retiring the last running car left a race that could not be advanced, rewound
 * or escaped. It is not an error at all now, it is how a race ends, so the
 * caller seals rather than reports. Null rather than a third phase, because
 * nobody's turn already means two things and a sealed race is not a third — it
 * is `status: "complete"`, which every view already discriminates on.
 */
export function projectAdvance(live: LiveState): TurnProjection | null {
  if (live.roundOrder.length === 0) throw new Error("Round order is empty");

  const skip = outOfPlay(live);
  const index = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;

  const withinRound = nextRunner(live.roundOrder, skip, index + 1, 1);
  const roundOver = withinRound === -1;

  const currentRound = roundOver ? live.currentRound + 1 : live.currentRound;
  const roundOrder = roundOver ? live.positionOrder : live.roundOrder;
  const nextIndex = roundOver
    ? nextRunner(roundOrder, skip, 0, 1)
    : withinRound;

  // Every car has finished or retired. Checked before the interstitial below,
  // because there is no point asking the table to confirm the order for a round
  // nobody is going to run.
  if (nextIndex === -1) return null;

  // Every car has moved and the table wants to look at the order before the
  // clock starts again. Stop on nobody's turn: the snapshot and the round
  // increment still happen here, only the selection waits for startRound.
  if (roundOver && live.betweenRounds) {
    return {
      phase: "betweenRounds",
      currentPlayerId: null,
      currentRound,
      roundOrder,
      previousRoundOrder: live.roundOrder,
      roundOver: true,
    };
  }

  return {
    phase: "turn",
    currentPlayerId: roundOrder[nextIndex],
    currentRound,
    roundOrder,
    // Rollover destroys the outgoing order; keep one round of it so a mis-tap
    // on a round's first car is still recoverable.
    ...(roundOver ? { previousRoundOrder: live.roundOrder } : {}),
    roundOver,
  };
}

/**
 * What Start round does: leave the interstitial with the leader up — or null,
 * as above, when there is nobody left to put up. A lap tapped during the
 * interstitial can finish the last car still running.
 */
export function projectStartRound(live: LiveState): TurnProjection | null {
  const skip = outOfPlay(live);
  const first = nextRunner(live.roundOrder, skip, 0, 1);

  if (first === -1) return null;

  return {
    phase: "turn",
    currentPlayerId: live.roundOrder[first],
    currentRound: live.currentRound,
    roundOrder: live.roundOrder,
    roundOver: false,
  };
}

/**
 * Whose turn it is, as one comparable string.
 *
 * This is the compare-and-set token for a turn change, and the thing the
 * optimistic render waits to see. It is *not* a version number on the live
 * doc: a standings nudge or a lap must not invalidate a Next turn tap that is
 * already in flight, and under this key it does not — only an actual change of
 * turn does.
 */
export function turnKey(
  live: Pick<LiveState, "phase" | "currentRound" | "currentPlayerId">,
): string {
  return `${live.phase ?? "turn"}:${live.currentRound}:${live.currentPlayerId ?? ""}`;
}
