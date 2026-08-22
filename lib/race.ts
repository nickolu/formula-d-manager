import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { carStatusSpecFor, gearsFor, playerId as slugFor, startOf } from "./setup";
import type {
  Actor,
  LiveState,
  Participant,
  PlayerId,
  Race,
  RaceSettingsChangedEvent,
  RaceSettingsPatchShape,
} from "./types";

export const raceDoc = (raceId: string) => doc(db, "races", raceId);
export const liveDoc = (raceId: string) => doc(db, "races", raceId, "state", "live");
export const eventsCol = (raceId: string) => collection(db, "races", raceId, "events");
export const participantDoc = (raceId: string, playerId: PlayerId) =>
  doc(db, "races", raceId, "participants", playerId);

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

async function readRace(tx: Transaction, raceId: string): Promise<Race> {
  const snap = await tx.get(raceDoc(raceId));
  if (!snap.exists()) throw new Error(`No race ${raceId}`);
  return { id: raceId, ...snap.data() } as Race;
}

/**
 * Drops the flag. A race is created `scheduled` with its clock stopped so the
 * roster can be edited and latecomers can join; this is the explicit moment it
 * becomes live.
 *
 * roundOrder is snapshotted from positionOrder here rather than at creation,
 * which is what lets the grid be reordered right up to the start, and the
 * participants' startPosition is rewritten to match — otherwise a grid edit
 * would leave the recorded starting positions describing a race nobody ran.
 *
 * advanceTurn deliberately does NOT check the status. It is the hot path, once
 * per turn per race, and adding a race-doc read to it would double its cost to
 * guard against something the UI does not offer.
 */
export async function startRace(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    const live = await readLive(tx, raceId);
    if (race.status !== "scheduled") throw new Error("Race has already started");
    if (live.positionOrder.length === 0) throw new Error("Nobody is on the grid");

    tx.update(raceDoc(raceId), { status: "live" });
    tx.update(liveDoc(raceId), {
      phase: "turn",
      currentPlayerId: live.positionOrder[0],
      roundOrder: live.positionOrder,
      currentRound: 1,
      turnStartedAt: serverTimestamp(),
      turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
      updatedAt: serverTimestamp(),
    });

    live.positionOrder.forEach((playerId, i) => {
      tx.update(participantDoc(raceId, playerId), { startPosition: i + 1 });
    });

    appendEvent(tx, raceId, who, {
      type: "raceStarted",
      order: live.positionOrder,
    });
  });
}

export interface RaceSettingsPatch {
  track?: string;
  lapCount?: number;
  /** Written to turnDurationDefaultMs; takes effect on the next turn. */
  turnSeconds?: number;
  /**
   * When the race was run. Editable because a backfilled date can be typed
   * wrong, and the season's race order depends on it.
   */
  scheduledAt?: Date;
  settings?: RaceSettingsPatchShape;
}

/**
 * The one way race configuration changes. Writes the race doc and/or the live
 * doc and appends a single raceSettingsChanged event carrying only what
 * actually changed, so the log reads as a diff.
 *
 * Changing the turn length does NOT disturb a running turn: only
 * turnDurationDefaultMs is written, and the new value takes effect next turn.
 * Yanking the clock out from under whoever is mid-move is the kind of thing
 * that starts an argument at the table. If the race is already paused there is
 * nobody to disturb, so turnDurationMs is written too — which is what the
 * operator expects when they change it during a break.
 */
export async function updateRaceSettings(
  raceId: string,
  patch: RaceSettingsPatch,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);

    // Firestore rejects undefined, and an event carrying keys that did not
    // change would make the log lie about what happened.
    // Typed off the *event*, not off the patch: the caller passes a Date and
    // the log stores a Timestamp, so they are not the same shape.
    const applied: RaceSettingsChangedEvent["patch"] = {};
    const raceFields: Record<string, unknown> = {};

    if (patch.track !== undefined) {
      const track = patch.track.trim();
      if (!track) throw new Error("Track cannot be empty");
      raceFields.track = track;
      applied.track = track;
    }
    if (patch.lapCount !== undefined) {
      if (!Number.isInteger(patch.lapCount) || patch.lapCount < 1) {
        throw new Error("Laps must be a whole number, at least 1");
      }
      raceFields.lapCount = patch.lapCount;
      applied.lapCount = patch.lapCount;
    }
    if (patch.scheduledAt !== undefined) {
      const at = Timestamp.fromDate(patch.scheduledAt);
      raceFields.scheduledAt = at;
      applied.scheduledAt = at;
    }
    if (patch.settings !== undefined) {
      // Dot paths rather than a nested object: writing `settings` whole would
      // silently clear whichever toggle this caller didn't mention. Nested
      // plain objects flatten too, so switching carStatus on cannot wipe the
      // spec sitting beside it. Arrays are values, not paths.
      const flatten = (prefix: string, value: unknown) => {
        if (
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v);
        } else if (value !== undefined) {
          raceFields[prefix] = value;
        }
      };
      flatten("settings", patch.settings);
      applied.settings = patch.settings;
    }

    if (Object.keys(raceFields).length > 0) {
      tx.update(raceDoc(raceId), raceFields);
    }

    // Mirrored so advanceTurn can read the toggle from the live doc it already
    // has, in the same transaction that edits the race doc — the two cannot
    // disagree.
    const liveFields: Record<string, unknown> = {};
    if (patch.settings?.betweenRounds !== undefined) {
      liveFields.betweenRounds = patch.settings.betweenRounds;
    }
    if (Object.keys(liveFields).length > 0) {
      tx.update(liveDoc(raceId), { ...liveFields, updatedAt: serverTimestamp() });
    }

    if (patch.turnSeconds !== undefined) {
      if (!Number.isFinite(patch.turnSeconds) || patch.turnSeconds < 1) {
        throw new Error("Turn seconds must be at least 1");
      }
      const ms = Math.round(patch.turnSeconds * 1000);
      tx.update(liveDoc(raceId), {
        turnDurationDefaultMs: ms,
        ...(live.turnStartedAt ? {} : { turnDurationMs: ms }),
        updatedAt: serverTimestamp(),
      });
      applied.turnSeconds = patch.turnSeconds;
    }

    if (Object.keys(applied).length === 0) return;

    appendEvent(tx, raceId, who, { type: "raceSettingsChanged", patch: applied });
  });
}

/**
 * Adds someone to a race that already exists — the cold-start path for a player
 * who isn't on the grid yet, and the only path when the grid is empty.
 *
 * **Does not touch roundOrder.** A joiner enters `positionOrder` only and
 * starts taking turns next round, when the rollover snapshots it. This is the
 * same rule as an overtake: mid-round changes to standings affect the next
 * round, never the one in progress. Splicing a car into a round already
 * underway would break the turnIndex/alreadyMoved arithmetic in the views and
 * hand the joiner a turn out of nowhere.
 *
 * Item 6 locks roster *editing* once a race starts but deliberately leaves
 * adding open — a late arrival is normal. Only removal locks.
 */
export async function joinRace(
  raceId: string,
  name: string,
  uid: string | null,
  who: Actor,
): Promise<PlayerId> {
  const trimmed = name.trim();
  // Ids are name slugs so the same human is stable across races — which also
  // means a name of only punctuation slugs to nothing and cannot be an id.
  const id = slugFor(trimmed);
  if (!trimmed || !id) throw new Error("Enter a name");

  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    const live = await readLive(tx, raceId);
    if (race.status === "complete") throw new Error("This race is over");
    if (live.positionOrder.includes(id)) {
      throw new Error(`${trimmed} is already racing — claim them from the list`);
    }

    // A caller with a uid is a phone putting its own name in, so that wins.
    // Otherwise fall back to the season claim, which is how a member added to
    // the league mid-season arrives already belonging to the right phone. Read
    // before any write, as every transaction here must.
    const seasonClaim = uid
      ? null
      : (((
          await tx.get(doc(db, "seasons", race.seasonId, "members", id))
        ).data()?.claimedBy ?? null) as string | null);

    // merge so a returning player's record isn't clobbered, matching createRace.
    tx.set(
      doc(db, "players", id),
      { name: trimmed, displayName: trimmed, active: true },
      { merge: true },
    );
    tx.set(participantDoc(raceId, id), {
      playerId: id,
      startPosition: live.positionOrder.length + 1,
      lapsCompleted: 0,
      finalPosition: null,
      dnf: false,
      claimedBy: uid ?? seasonClaim,
    });
    tx.update(liveDoc(raceId), {
      positionOrder: [...live.positionOrder, id],
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, {
      type: "playerJoined",
      playerId: id,
      name: trimmed,
    });
  });

  return id;
}

/**
 * Takes a car off the grid. Only while the race is `scheduled`.
 *
 * Removal is not deletion of history — the events stay — but it does have to
 * unpick the player from every ordered list in one transaction. That fiddliness
 * is exactly why it is locked after the start rather than merely discouraged:
 * mid-race it would also have to re-anchor the current turn and reconcile a
 * round already in progress.
 */
export async function removePlayer(
  raceId: string,
  playerId: PlayerId,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    const live = await readLive(tx, raceId);
    if (race.status !== "scheduled") {
      throw new Error("The roster is locked once the race has started");
    }
    if (!live.positionOrder.includes(playerId)) {
      throw new Error(`${playerId} is not on this grid`);
    }
    if (live.positionOrder.length <= 1) {
      throw new Error("A race needs at least one car");
    }

    const without = (ids: PlayerId[]) => ids.filter((id) => id !== playerId);
    const positionOrder = without(live.positionOrder);

    tx.delete(participantDoc(raceId, playerId));
    tx.update(liveDoc(raceId), {
      positionOrder,
      roundOrder: without(live.roundOrder),
      retired: without(live.retired ?? []),
      previousRoundOrder: live.previousRoundOrder
        ? without(live.previousRoundOrder)
        : null,
      // The grid's first car is up first, and only startRace anchors the clock.
      currentPlayerId: positionOrder[0],
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, { type: "playerRemoved", playerId });
  });
}

/**
 * Retired cars are skipped at selection time rather than being filtered out of
 * roundOrder itself. Keeping the snapshot faithful to the round that was
 * actually started is what makes un-retiring reversible mid-round, and it keeps
 * the turnIndex/alreadyMoved arithmetic in the views working unchanged.
 */
function nextRunner(
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

    const retired = new Set(live.retired ?? []);
    const index = live.currentPlayerId
      ? live.roundOrder.indexOf(live.currentPlayerId)
      : -1;

    const withinRound = nextRunner(live.roundOrder, retired, index + 1, 1);
    const roundOver = withinRound === -1;

    const nextRound = roundOver ? live.currentRound + 1 : live.currentRound;
    const nextOrder = roundOver ? live.positionOrder : live.roundOrder;
    const nextIndex = roundOver
      ? nextRunner(nextOrder, retired, 0, 1)
      : withinRound;

    // Without this the loop would either spin or park the turn on nobody.
    if (nextIndex === -1) throw new Error("Every car has retired");

    // Every car has moved and the table wants to look at the order before the
    // clock starts again. Stop on nobody's turn: the snapshot and the round
    // increment still happen here, only the selection waits for startRound.
    if (roundOver && live.betweenRounds) {
      tx.update(liveDoc(raceId), {
        phase: "betweenRounds",
        currentPlayerId: null,
        turnStartedAt: null,
        turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
        currentRound: nextRound,
        roundOrder: nextOrder,
        previousRoundOrder: live.roundOrder,
        updatedAt: serverTimestamp(),
      });
      appendEvent(tx, raceId, who, {
        type: "roundEnded",
        round: live.currentRound,
      });
      return;
    }

    tx.update(liveDoc(raceId), {
      currentPlayerId: nextOrder[nextIndex],
      turnStartedAt: serverTimestamp(),
      currentRound: nextRound,
      roundOrder: nextOrder,
      // Rollover destroys the outgoing order; keep one round of it so a
      // mis-tap on a round's first car is still recoverable.
      ...(roundOver ? { previousRoundOrder: live.roundOrder } : {}),
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
      toPlayerId: nextOrder[nextIndex],
      round: nextRound,
    });
  });
}

/**
 * Leaves the between-rounds interstitial: the leader is up and the clock runs.
 *
 * roundStarted is emitted from here rather than from advanceTurn's rollover so
 * that it marks the round actually beginning rather than the previous one
 * ending — which, with the interstitial on, are minutes apart. With it off,
 * advanceTurn still emits it inline and the two moments are the same instant.
 */
export async function startRound(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    if (live.phase !== "betweenRounds") throw new Error("Not between rounds");

    const retired = new Set(live.retired ?? []);
    const first = nextRunner(live.roundOrder, retired, 0, 1);
    if (first === -1) throw new Error("Every car has retired");

    tx.update(liveDoc(raceId), {
      phase: "turn",
      currentPlayerId: live.roundOrder[first],
      turnStartedAt: serverTimestamp(),
      turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, {
      type: "roundStarted",
      round: live.currentRound,
      order: live.roundOrder,
    });
  });
}

/**
 * The reverse gear for a mis-tapped turn. Steps back one car, crossing at most
 * one round boundary — that is the whole reason advanceTurn saves
 * previousRoundOrder.
 *
 * Leaves the race PAUSED with a full clock: turnStartedAt null (which is what
 * readTimer already reads as paused — do not add a pause flag) and
 * turnDurationMs reset to the configured turn length. Rewinding means
 * something went wrong at the table and people are talking about it; starting
 * a clock on that argument would be the wrong thing to do, and handing back
 * the four seconds that were left would be worse.
 *
 * Only turnRewound is emitted. "A rewind leaves the race paused with a fresh
 * clock" is a rule of the system, not a separate thing that happened, so a
 * replay applies it without a second event.
 *
 * It makes no attempt to restore positionOrder as it was: standings are
 * human-nudged and the operator is looking straight at the board.
 */
export async function rewindTurn(raceId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);

    const retired = new Set(live.retired ?? []);
    const index = live.currentPlayerId
      ? live.roundOrder.indexOf(live.currentPlayerId)
      : live.roundOrder.length;

    // In the interstitial roundOrder is already the NEXT round's snapshot and
    // nobody has moved in it, so stepping back within it would be meaningless.
    // Fall straight through to the cross-a-boundary branch, which is exactly
    // the move that is wanted.
    const withinRound =
      live.phase === "betweenRounds"
        ? -1
        : nextRunner(live.roundOrder, retired, index - 1, -1);

    if (withinRound !== -1) {
      const target = live.roundOrder[withinRound];
      tx.update(liveDoc(raceId), {
        currentPlayerId: target,
        turnStartedAt: null,
        turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
        updatedAt: serverTimestamp(),
      });
      appendEvent(tx, raceId, who, {
        type: "turnRewound",
        fromPlayerId: live.currentPlayerId,
        toPlayerId: target,
        round: live.currentRound,
      });
      return;
    }

    // Crossing back into the previous round. Only one round is kept.
    const previous = live.previousRoundOrder;
    if (live.currentRound <= 1 || !previous || previous.length === 0) {
      throw new Error("Nothing to rewind to");
    }

    const lastIndex = nextRunner(previous, retired, previous.length - 1, -1);
    if (lastIndex === -1) throw new Error("Every car has retired");

    tx.update(liveDoc(raceId), {
      phase: "turn",
      currentPlayerId: previous[lastIndex],
      turnStartedAt: null,
      turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
      currentRound: live.currentRound - 1,
      roundOrder: previous,
      previousRoundOrder: null,
      updatedAt: serverTimestamp(),
    });

    appendEvent(tx, raceId, who, {
      type: "turnRewound",
      fromPlayerId: live.currentPlayerId,
      toPlayerId: previous[lastIndex],
      round: live.currentRound - 1,
    });
  });
}

/**
 * Retirement is live state, not just a finishing attribute — a car that breaks
 * on lap 1 should stop taking turns immediately. Writes both the participant
 * doc and the live doc's cached list in one transaction; the event stays the
 * record of truth.
 *
 * Deliberately does NOT move the turn on when the current player retires. The
 * human taps Next turn and the skip logic takes it from there; auto-advancing
 * would fight the person holding the tablet.
 */
export async function setDnf(
  raceId: string,
  playerId: PlayerId,
  dnf: boolean,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const live = await readLive(tx, raceId);
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    const retired = new Set(live.retired ?? []);
    if (retired.has(playerId) === dnf) return; // already there

    if (dnf) retired.add(playerId);
    else retired.delete(playerId);

    tx.update(participantDoc(raceId, playerId), { dnf });
    tx.update(liveDoc(raceId), {
      retired: [...retired],
      updatedAt: serverTimestamp(),
    });
    appendEvent(tx, raceId, who, { type: "dnfChanged", playerId, dnf });
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

/**
 * Sets one property of a car's status card.
 *
 * Clamped to 0..max **here**, not only in the UI: "any new value within the
 * limit on the card" is the only rule there is, and it belongs where every
 * caller hits it — including the Phase 3 chatbot. An unknown key is refused
 * rather than quietly stored, so a typo can't invent a property.
 *
 * There are deliberately no permissions and no cheat prevention. Anyone can
 * change anyone's values, exactly as anyone can reach across the table and move
 * your pegs. The claim from My Racer decides whose card shows under "My car",
 * and nothing more.
 */
export async function setCarStatus(
  raceId: string,
  playerId: PlayerId,
  key: string,
  value: number,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    // Falls back to the default spec, so a race that predates the card still
    // validates against something rather than refusing every key.
    const property = carStatusSpecFor(race).find((p) => p.key === key);
    if (!property) throw new Error(`No car status property "${key}"`);

    const current = snap.data() as Participant;
    // Absent means the property's starting value — nothing is backfilled.
    const from = current.carStatus?.[key] ?? startOf(property);
    const to = Math.max(0, Math.min(property.max, Math.round(value)));
    if (from === to) return;

    tx.update(participantDoc(raceId, playerId), { [`carStatus.${key}`]: to });
    appendEvent(tx, raceId, who, {
      type: "carStatusChanged",
      playerId,
      key,
      from,
      to,
    });
  });
}

/**
 * Puts a car in a gear, or clears the lever with null.
 *
 * Same bargain as the status card: a shared counter standing in for the gear
 * lever, never something the app derives from or validates a move against. The
 * gear set is per-race config, so a house variant needs no deploy.
 */
export async function setGear(
  raceId: string,
  playerId: PlayerId,
  gear: number | null,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    if (gear !== null && !gearsFor(race).some((g) => g.gear === gear)) {
      throw new Error(`No gear ${gear} on this car`);
    }

    const from = (snap.data() as Participant).gear ?? null;
    if (from === gear) return;

    tx.update(participantDoc(raceId, playerId), { gear });
    appendEvent(tx, raceId, who, { type: "gearChanged", playerId, from, to: gear });
  });
}

/**
 * Claims a racer for this device.
 *
 * A transaction that re-reads `claimedBy` and refuses if it belongs to someone
 * else: two phones tapping the same racer at the same moment is a real race at
 * a table, not a theoretical one.
 *
 * `previousPlayerId` is the racer this device already holds, if any — passed in
 * rather than looked up because the web SDK cannot run a collection query
 * inside a transaction. It is *verified* before being cleared, so a stale value
 * from the caller can never release someone else's claim.
 */
export async function claimRacer(
  raceId: string,
  playerId: PlayerId,
  uid: string,
  who: Actor,
  previousPlayerId?: PlayerId | null,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    const previous =
      previousPlayerId && previousPlayerId !== playerId
        ? await tx.get(participantDoc(raceId, previousPlayerId))
        : null;

    const claimedBy = (snap.data() as Participant).claimedBy ?? null;
    if (claimedBy === uid) return; // already ours
    if (claimedBy) throw new Error("Someone just took that racer");

    if (previous?.exists() && (previous.data() as Participant).claimedBy === uid) {
      tx.update(previous.ref, { claimedBy: null });
      appendEvent(tx, raceId, who, {
        type: "racerReleased",
        playerId: previousPlayerId,
        uid,
      });
    }

    tx.update(participantDoc(raceId, playerId), { claimedBy: uid });
    appendEvent(tx, raceId, who, { type: "racerClaimed", playerId, uid });
  });
}

/** Gives a racer back. A uid that doesn't hold the claim is a no-op, not an error. */
export async function releaseRacer(
  raceId: string,
  playerId: PlayerId,
  uid: string,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) return;
    if ((snap.data() as Participant).claimedBy !== uid) return;

    tx.update(participantDoc(raceId, playerId), { claimedBy: null });
    appendEvent(tx, raceId, who, { type: "racerReleased", playerId, uid });
  });
}

/**
 * Records why a car's race went the way it did. Usually a retirement reason,
 * but any car can have one.
 *
 * An empty string CLEARS the note rather than deleting the field, so the
 * clearing still appends an event and the history shows it happening.
 *
 * Notes stay editable after the race is sealed: they are commentary, not
 * results, and finishRace's validation of `order` is untouched by them.
 */
export async function setParticipantNote(
  raceId: string,
  playerId: PlayerId,
  note: string,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(participantDoc(raceId, playerId));
    if (!snap.exists()) throw new Error(`${playerId} is not in this race`);

    const trimmed = note.trim();
    if (((snap.data() as Participant).note ?? "") === trimmed) return;

    tx.update(participantDoc(raceId, playerId), { note: trimmed });
    appendEvent(tx, raceId, who, {
      type: "participantNoteSet",
      playerId,
      note: trimmed,
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

    // Cars that retired mid-race are already retired; a finishing form must not
    // be able to silently un-retire one by omitting it. Un-retiring goes
    // through setDnf, which leaves a trail.
    const retirements = [...new Set([...dnf, ...(live.retired ?? [])])];

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
    for (const playerId of retirements) {
      if (!got.has(playerId)) {
        throw new Error(`DNF ${playerId} is not in the finishing order`);
      }
    }

    tx.update(raceDoc(raceId), {
      status: "complete",
      result: { order, dnf: retirements },
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
        dnf: retirements.includes(playerId),
      });
    });

    appendEvent(tx, raceId, who, {
      type: "raceFinished",
      order,
      dnf: retirements,
    });
  });
}

/**
 * Rewrites a finished race's result.
 *
 * This is the mutation that looks like it breaks the project's central rule, so
 * here is precisely why it does not. **`result` on the race document is a cache
 * of the log**, exactly as the live doc is — `finishRace` writes it in the same
 * transaction that appends `raceFinished`, purely so standings can be a pure
 * function over the races listener. Rewriting a cache is fine. Rewriting
 * history is not, and nothing here does: the original `raceFinished` event is
 * untouched, a `raceResultAmended` event records the new order, and a
 * `correction` pointing at that original is appended beside it. The history
 * view shows both, in chronological place.
 *
 * Standings recompute on the next snapshot because they were never stored.
 *
 * The target event is looked up *before* the transaction, because the web SDK
 * cannot query a collection inside one. A race that has somehow never had a
 * raceFinished event gets `targetEventId: ""`, which is a legitimate value
 * meaning "no specific target" — the same one `uncompleteLap` writes.
 */
export async function amendRaceResult(
  raceId: string,
  order: PlayerId[],
  dnf: PlayerId[],
  note: string,
  who: Actor,
) {
  const finishes = await getDocs(
    query(eventsCol(raceId), where("type", "==", "raceFinished"), limit(1)),
  );
  const targetEventId = finishes.docs[0]?.id ?? "";

  await runTransaction(db, async (tx) => {
    const race = await readRace(tx, raceId);
    if (race.status !== "complete" || !race.result) {
      throw new Error("This race has not been finished yet");
    }

    // Validated against the sealed result rather than the live doc: the sealed
    // order is the record of who was actually in this race. A partial order
    // would silently under-count the season, exactly as it would in finishRace.
    const expected = new Set(race.result.order);
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

    // Unlike finishRace, retirements are NOT unioned with what is already
    // there. Un-retiring a car is a legitimate amendment — "we wrote down that
    // he retired and he did not" is exactly the kind of mistake this exists to
    // fix — and a union would make it the one correction that cannot be made.
    tx.update(raceDoc(raceId), { result: { order, dnf } });
    tx.update(liveDoc(raceId), {
      positionOrder: order,
      retired: dnf,
      updatedAt: serverTimestamp(),
    });

    order.forEach((playerId, i) => {
      tx.update(participantDoc(raceId, playerId), {
        finalPosition: i + 1,
        dnf: dnf.includes(playerId),
      });
    });

    appendEvent(tx, raceId, who, {
      type: "raceResultAmended",
      order,
      dnf,
      note: note.trim(),
    });
    appendEvent(tx, raceId, who, {
      type: "correction",
      targetEventId,
      note: note.trim() || "Result amended",
    });
  });
}

/**
 * Removes a race: its participants, its live state, and the race document.
 *
 * **This is the one mutation here that appends no event** — there would be
 * nowhere to append it to. That is a deliberate exception to the project's
 * central rule, not an oversight.
 *
 * The event log survives. `firestore.rules` sets `allow update, delete: if
 * false` on event documents on purpose, so the events are left orphaned under
 * a race that no longer exists — invisible to the app, since nothing queries
 * events except scoped to a race. This is the same bargain scripts/smoke.ts
 * makes when it cleans up after itself. Do not loosen the rules to "fix" it.
 *
 * Refuses anything that is not complete. "You have to end it first" is a data
 * rule, not a button state, so it is enforced here rather than only in the UI.
 *
 * Not a transaction: Firestore has no client-side recursive delete, so the
 * subcollection has to be enumerated. The race document goes LAST, so a
 * failure part-way leaves a findable race rather than orphaned subcollections.
 */
export async function deleteRace(raceId: string) {
  const snap = await getDoc(raceDoc(raceId));
  if (!snap.exists()) throw new Error(`No race ${raceId}`);
  const status = (snap.data() as { status?: string }).status;
  if (status !== "complete") {
    throw new Error("Finish the race before deleting it");
  }

  const participants = await getDocs(collection(db, "races", raceId, "participants"));
  await Promise.all(participants.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(liveDoc(raceId));
  await deleteDoc(raceDoc(raceId));
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
