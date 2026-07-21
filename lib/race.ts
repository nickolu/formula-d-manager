import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type Transaction,
} from "firebase/firestore";
import { db } from "./firebase";
import type { EventSource, LiveState, Participant, PlayerId } from "./types";

export const raceDoc = (raceId: string) => doc(db, "races", raceId);
export const liveDoc = (raceId: string) => doc(db, "races", raceId, "state", "live");
export const eventsCol = (raceId: string) => collection(db, "races", raceId, "events");
export const participantDoc = (raceId: string, playerId: PlayerId) =>
  doc(db, "races", raceId, "participants", playerId);

interface Actor {
  source: EventSource;
  actor?: string | null;
}

/**
 * Every mutation appends to the event log in the same transaction that touches
 * the live doc. The live doc is a denormalized cache for fast listener reads;
 * the log is the record of truth. Keep this the ONLY way state changes — the
 * chatbot in Phase 3 gets these functions as its tool surface and never writes
 * raw documents.
 */
function appendEvent(
  tx: Transaction,
  raceId: string,
  { source, actor = null }: Actor,
  payload: Record<string, unknown>,
) {
  const ref = doc(eventsCol(raceId));
  tx.set(ref, { ...payload, at: serverTimestamp(), source, actor });
  return ref;
}

async function readLive(tx: Transaction, raceId: string): Promise<LiveState> {
  const snap = await tx.get(liveDoc(raceId));
  if (!snap.exists()) throw new Error(`No live state for race ${raceId}`);
  return snap.data() as LiveState;
}

/**
 * Steps through the current round's frozen order. Running off the end means
 * every car has moved once: the round ends, and the next round's order is
 * snapshotted from current standings — which is how a mid-round overtake
 * correctly affects the next round instead of the one in progress.
 *
 * A round is NOT a lap. Laps are per-car and recorded via completeLap.
 */
export async function advanceTurn(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    if (live.roundOrder.length === 0) throw new Error("Round order is empty");

    const index = live.currentPlayerId
      ? live.roundOrder.indexOf(live.currentPlayerId)
      : -1;
    const nextIndex = index + 1;
    const roundOver = nextIndex >= live.roundOrder.length;

    const nextRound = roundOver ? live.currentRound + 1 : live.currentRound;
    const nextOrder = roundOver ? live.positionOrder : live.roundOrder;
    const nextPlayer = nextOrder[roundOver ? 0 : nextIndex];

    tx.update(liveDoc(raceId), {
      currentPlayerId: nextPlayer,
      turnStartedAt: serverTimestamp(),
      currentRound: nextRound,
      roundOrder: nextOrder,
      updatedAt: serverTimestamp(),
    });

    if (roundOver) {
      appendEvent(tx, raceId, who, {
        type: "roundStarted",
        round: nextRound,
        order: nextOrder,
      });
    }

    appendEvent(tx, raceId, who, {
      type: "turnAdvanced",
      fromPlayerId: live.currentPlayerId,
      toPlayerId: nextPlayer,
      round: nextRound,
    });
  });
}

/**
 * Records an overtake. Deliberately does not touch roundOrder: the change takes
 * effect when the current round ends.
 */
export async function setPositionOrder(
  raceId: string,
  order: PlayerId[],
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    await readLive(tx, raceId);
    tx.update(liveDoc(raceId), {
      positionOrder: order,
      updatedAt: serverTimestamp(),
    });
    appendEvent(tx, raceId, who, { type: "positionOrderChanged", order });
  });
}

/** One car crossed the line. Cars complete laps at different rounds. */
export async function completeLap(
  raceId: string,
  playerId: PlayerId,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    const lap = ((snap.data() as Participant).lapsCompleted ?? 0) + 1;
    tx.update(participantDoc(raceId, playerId), { lapsCompleted: increment(1) });
    appendEvent(tx, raceId, who, {
      type: "lapCompleted",
      playerId,
      lap,
      round: live.currentRound,
    });
  });
}

/** Undoes a mis-tapped lap, keeping the correction in the log. */
export async function uncompleteLap(
  raceId: string,
  playerId: PlayerId,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);
    const current = (snap.data() as Participant).lapsCompleted ?? 0;
    if (current <= 0) return;

    tx.update(participantDoc(raceId, playerId), { lapsCompleted: increment(-1) });
    appendEvent(tx, raceId, who, {
      type: "correction",
      targetEventId: "",
      note: `Reverted a lap for ${playerId} (now ${current - 1})`,
    });
  });
}

/**
 * Pause freezes what's left into turnDurationMs and drops the anchor, so the
 * render path stays identical everywhere and needs no extra fields.
 * Remaining is computed against the client clock, which is fine for a timer
 * with no mechanical consequence.
 */
export async function pauseTurn(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    if (!live.turnStartedAt) return; // already paused

    const elapsed = Date.now() - live.turnStartedAt.toMillis();
    const remainingMs = Math.max(0, live.turnDurationMs - elapsed);

    tx.update(liveDoc(raceId), {
      turnStartedAt: null,
      turnDurationMs: remainingMs,
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, { type: "turnPaused", remainingMs });
  });
}

export async function resumeTurn(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    if (live.turnStartedAt) return; // already running

    tx.update(liveDoc(raceId), {
      turnStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, { type: "turnResumed" });
  });
}

/** Restarts the current player's turn with a fresh clock. */
export async function resetTurnClock(
  raceId: string,
  durationMs: number,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    await readLive(tx, raceId);
    tx.update(liveDoc(raceId), {
      turnStartedAt: serverTimestamp(),
      turnDurationMs: durationMs,
      updatedAt: serverTimestamp(),
    });
    appendEvent(tx, raceId, who, { type: "turnResumed" });
  });
}

/**
 * Seals the race. The finishing order is written onto the race doc as `result`
 * in this same transaction, which is what lets season standings be a pure
 * function over the races listener rather than a fan-out over participants.
 * The raceFinished event remains the record of truth; `result` is a cache of it.
 */
export async function finishRace(
  raceId: string,
  order: PlayerId[],
  dnf: PlayerId[],
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);

    // Standings are derived from `order`, so a partial order would silently
    // under-count a season. Fail loudly instead.
    const expected = new Set(live.positionOrder);
    const got = new Set(order);
    if (got.size !== order.length) {
      throw new Error("Finishing order contains a duplicate");
    }
    for (const playerId of expected) {
      if (!got.has(playerId)) {
        throw new Error(`Finishing order is missing ${playerId}`);
      }
    }
    for (const playerId of got) {
      if (!expected.has(playerId)) {
        throw new Error(`${playerId} is not in this race`);
      }
    }
    for (const playerId of dnf) {
      if (!got.has(playerId)) {
        throw new Error(`DNF ${playerId} is not in the finishing order`);
      }
    }

    tx.update(raceDoc(raceId), {
      status: "complete",
      result: { order, dnf },
    });
    tx.update(liveDoc(raceId), {
      currentPlayerId: null,
      turnStartedAt: null,
      positionOrder: order,
      updatedAt: serverTimestamp(),
    });

    order.forEach((playerId, i) => {
      tx.update(participantDoc(raceId, playerId), {
        finalPosition: i + 1,
        dnf: dnf.includes(playerId),
      });
    });

    appendEvent(tx, raceId, who, { type: "raceFinished", order, dnf });
  });
}

/** Corrections append rather than mutate, preserving the audit trail. */
export async function recordCorrection(
  raceId: string,
  targetEventId: string,
  note: string,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    appendEvent(tx, raceId, who, { type: "correction", targetEventId, note });
  });
}
