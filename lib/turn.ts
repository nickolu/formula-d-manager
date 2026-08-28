import type { LiveState, PlayerId } from "./types";

/**
 * Where the turn goes next — as a **pure function of the live doc**, in the
 * shape of `lib/scoring.ts` and `lib/cars.ts`: no Firestore, no clock, no I/O.
 *
 * It exists because two things now have to agree on the answer. `advanceTurn`
 * writes it, and the player view *renders* it before the write lands — a
 * Firestore transaction gets no latency compensation, so the device that taps
 * Next turn is the last one to find out what happened. If the view predicted
 * the next turn with its own copy of this arithmetic, the two would drift on
 * the first retired car or round boundary. One function, two callers.
 */

/** First car at or after `from`, walking in `step`, that has not retired. */
export function nextRunner(
  order: PlayerId[],
  retired: Set<PlayerId>,
  from: number,
  step: 1 | -1,
) {
  for (let i = from; i >= 0 && i < order.length; i += step) {
    if (!retired.has(order[i])) return i;
  }
  return -1;
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

/** What Next turn does. Throws exactly where `advanceTurn` used to throw. */
export function projectAdvance(live: LiveState): TurnProjection {
  if (live.roundOrder.length === 0) throw new Error("Round order is empty");

  const retired = new Set(live.retired ?? []);
  const index = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;

  const withinRound = nextRunner(live.roundOrder, retired, index + 1, 1);
  const roundOver = withinRound === -1;

  const currentRound = roundOver ? live.currentRound + 1 : live.currentRound;
  const roundOrder = roundOver ? live.positionOrder : live.roundOrder;
  const nextIndex = roundOver
    ? nextRunner(roundOrder, retired, 0, 1)
    : withinRound;

  // Without this the loop would either spin or park the turn on nobody.
  if (nextIndex === -1) throw new Error("Every car has retired");

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
 * Whether the reverse gear steps back past the flag drop rather than onto
 * another car: the race is sitting on the first car of round 1, so there is no
 * earlier turn to go to and `rewindTurn` un-starts the race instead.
 *
 * Here beside projectAdvance for the same reason those are here — the
 * transaction and the view have to agree. The view labels the button with it,
 * because "back a turn" on a control that puts the whole race back on the grid
 * is a surprise, and this is the one place the arithmetic lives.
 *
 * A fact about the live doc, not about the race: an unstarted race satisfies it
 * too, which is why rewindTurn checks the status as well.
 */
export function rewindUnstarts(
  live: Pick<
    LiveState,
    "phase" | "currentRound" | "currentPlayerId" | "roundOrder" | "retired"
  >,
): boolean {
  if (live.currentRound > 1) return false;
  // In the interstitial roundOrder is already the next round's snapshot, so a
  // rewind always crosses a boundary — and in round 1 there is none to cross.
  if (live.phase === "betweenRounds") return true;

  const retired = new Set(live.retired ?? []);
  const index = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : live.roundOrder.length;
  return nextRunner(live.roundOrder, retired, index - 1, -1) === -1;
}

/** What Start round does: leave the interstitial with the leader up. */
export function projectStartRound(live: LiveState): TurnProjection {
  const retired = new Set(live.retired ?? []);
  const first = nextRunner(live.roundOrder, retired, 0, 1);
  if (first === -1) throw new Error("Every car has retired");

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
