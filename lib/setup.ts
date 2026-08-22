import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { CarStatusProperty, GearRange, PlayerId, Race } from "./types";

/** Player ids are slugs of their name so the same human is stable across races. */
export function playerId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The card in use here: what a car starts with, and the most it can hold once
 * upgraded. Config, not code — this is only the seed, and a race keeps whatever
 * spec it was created with, exactly like scoringConfig.
 */
export const DEFAULT_CAR_STATUS_SPEC: CarStatusProperty[] = [
  { key: "tires", label: "Tires", start: 6, max: 14 },
  { key: "brakes", label: "Brakes", start: 3, max: 7 },
  { key: "transmission", label: "Transmission", start: 3, max: 7 },
  { key: "body", label: "Body", start: 3, max: 7 },
  { key: "engine", label: "Engine", start: 3, max: 7 },
  { key: "suspension", label: "Suspension", start: 2, max: 7 },
];

/** The dice range each gear rolls. */
export const DEFAULT_GEARS: GearRange[] = [
  { gear: 1, min: 1, max: 2 },
  { gear: 2, min: 2, max: 4 },
  { gear: 3, min: 4, max: 8 },
  { gear: 4, min: 7, max: 12 },
  { gear: 5, min: 11, max: 20 },
  { gear: 6, min: 21, max: 30 },
];

/**
 * What an untouched car has of a property. Falls back to `max` for specs
 * written before starts existed, where full was the only value there was.
 */
export function startOf(property: CarStatusProperty): number {
  return property.start ?? property.max;
}

/**
 * The spec a race actually uses.
 *
 * Races created before the card existed have no `settings.carStatus` at all,
 * and switching the card on writes only `enabled` — so the spec would be
 * missing and the card would render nothing while every setCarStatus threw.
 * Falling back to the default is the "every reader handles the field's
 * absence" rule: an old race gets the standard card rather than a broken one.
 */
export function carStatusSpecFor(
  race: Pick<Race, "settings"> | null | undefined,
): CarStatusProperty[] {
  const spec = race?.settings?.carStatus?.spec;
  return spec && spec.length > 0 ? spec : DEFAULT_CAR_STATUS_SPEC;
}

/** The gear set a race uses, falling back the same way the spec does. */
export function gearsFor(
  race: Pick<Race, "settings"> | null | undefined,
): GearRange[] {
  const gears = race?.settings?.carStatus?.gears;
  return gears && gears.length > 0 ? gears : DEFAULT_GEARS;
}

export interface NewRaceInput {
  track: string;
  /** Whose house. Optional — absent means nobody said. */
  location?: string;
  lapCount: number;
  /** Starting grid order, front to back. */
  playerNames: string[];
  turnSeconds: number;
  /**
   * Required, and verified to exist. It used to default to "default" against a
   * document that might not be there — which made every race silently a member
   * of a season nothing could enumerate. The season is the unit of identity
   * now; a race is a thing that happens inside one.
   */
  seasonId: string;
  /**
   * When the race is run. Defaults to now, which is right for a race being set
   * up at the table and wrong for anything entered after the fact — see
   * `backfillRace`, where hardcoding `serverTimestamp()` would sort every
   * historical race to today and scramble the season's order.
   */
  scheduledAt?: Date;
}

export async function createRace(input: NewRaceInput): Promise<string> {
  const names = input.playerNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Add at least one player");

  // Read before the batch rather than inside it: a batch cannot read, and an
  // orphaned race is worse than a slower create. Standings are scoped by
  // seasonId, so a race pointing at nothing scores into nothing.
  if (!input.seasonId) throw new Error("A race needs a season");
  // The reference is built here rather than imported from ./seasons, which
  // imports this module for the id slug — a cycle for one `doc()` call.
  if (!(await getDoc(doc(db, "seasons", input.seasonId))).exists()) {
    throw new Error(`No season ${input.seasonId}`);
  }

  // A phone claims its racer once a season, not every game night. This is a
  // seed and not a second source of truth: participants/{id}.claimedBy is the
  // in-race authority from here on, and it stays re-tappable.
  //
  // Read here rather than imported from ./seasons, which imports this module
  // for the id slug — a cycle for one query. Outside the batch, because a batch
  // cannot read.
  const members = await getDocs(
    collection(db, "seasons", input.seasonId, "members"),
  );
  const claims = new Map<string, string>();
  for (const m of members.docs) {
    const claimedBy = m.data().claimedBy as string | null | undefined;
    if (claimedBy) claims.set(m.id, claimedBy);
  }

  const ids = names.map(playerId);
  const batch = writeBatch(db);
  const raceRef = doc(collection(db, "races"));

  names.forEach((name, i) => {
    // merge so re-entering a returning player doesn't clobber their record
    batch.set(
      doc(db, "players", ids[i]),
      { name, displayName: name, active: true },
      { merge: true },
    );
  });

  const location = input.location?.trim();

  batch.set(raceRef, {
    seasonId: input.seasonId,
    track: input.track,
    // Omitted rather than written empty: Firestore rejects undefined, and
    // absent is the value that means "nobody said".
    ...(location ? { location } : {}),
    scheduledAt: input.scheduledAt
      ? Timestamp.fromDate(input.scheduledAt)
      : serverTimestamp(),
    // Scheduled, not live: the roster stays editable and the clock stays
    // stopped until someone explicitly taps Start race.
    status: "scheduled",
    lapCount: input.lapCount,
    // On for new races, off for races that predate the field. Silently
    // changing the flow of a race already in progress is worse than an old
    // race not getting a new feature.
    settings: {
      betweenRounds: true,
      // Off by default; the spec is seeded so a race can be switched on
      // without anyone having to author one. Edit it in the Firestore console
      // for a house variant — that is the point of it not being in code.
      carStatus: {
        enabled: false,
        spec: DEFAULT_CAR_STATUS_SPEC,
        gears: DEFAULT_GEARS,
      },
    },
  });

  batch.set(doc(db, "races", raceRef.id, "state", "live"), {
    currentPlayerId: ids[0] ?? null,
    // Null is the paused state everywhere else too, so an unstarted race needs
    // no special case in readTimer or any view: the pole sitter is shown with
    // a full clock that isn't running.
    turnStartedAt: null,
    turnDurationMs: input.turnSeconds * 1000,
    turnDurationDefaultMs: input.turnSeconds * 1000,
    currentRound: 1,
    phase: "turn",
    // Mirror of settings.betweenRounds, so advanceTurn reads the toggle from
    // the document it already has.
    betweenRounds: true,
    // The starting grid is both the opening standings and the first round's
    // frozen order; they diverge as soon as anyone overtakes.
    positionOrder: ids,
    roundOrder: ids,
    retired: [],
    previousRoundOrder: null,
    updatedAt: serverTimestamp(),
  });

  // Seed the log so the opening state is reconstructable by replay, same as
  // every later mutation.
  batch.set(doc(collection(db, "races", raceRef.id, "events")), {
    type: "raceCreated",
    at: serverTimestamp(),
    source: "manual",
    actor: null,
    track: input.track,
    ...(location ? { location } : {}),
    lapCount: input.lapCount,
    order: ids,
    turnDurationMs: input.turnSeconds * 1000,
  });

  ids.forEach((id, i) => {
    batch.set(doc(db, "races", raceRef.id, "participants", id), {
      playerId: id,
      startPosition: i + 1,
      lapsCompleted: 0,
      finalPosition: null,
      dnf: false,
      claimedBy: claims.get(id) ?? null,
    });
  });

  await batch.commit();
  return raceRef.id;
}


export interface BackfillRaceInput {
  seasonId: string;
  track: string;
  /** Whose house. Optional — absent means nobody said. */
  location?: string;
  /** The day it was actually run. Required — that is the whole point. */
  scheduledAt: Date;
  /** Finishing order, winner first. Retired cars are included here too. */
  playerNames: string[];
  /** Which of those retired. Must all appear in playerNames. */
  dnfNames?: string[];
  /** Meaningless for a race nobody timed; kept so the doc shape is uniform. */
  lapCount?: number;
  turnSeconds?: number;
}

/**
 * A race the app never timed, entered after the fact.
 *
 * Creates it **already complete**, and deliberately introduces **no new event
 * variant**: the log gets an ordinary `raceCreated` followed by an ordinary
 * `raceFinished`, so replaying it produces the correct state with zero new
 * logic anywhere. `backfilled: true` on the race document is the cache flag
 * that lets a view say "entered afterwards".
 *
 * It writes a minimal live document — `currentPlayerId: null`, `currentRound:
 * 0`, `positionOrder` equal to the finishing order — so `useLiveState` and
 * every screen reading it keep working instead of each having to special-case a
 * race with no live state.
 *
 * `scheduledAt` is required and is the admin's date, not `serverTimestamp()`.
 * Every backfilled race would otherwise sort to today.
 */
export async function backfillRace(input: BackfillRaceInput): Promise<string> {
  const names = input.playerNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Add at least one player");

  if (!input.seasonId) throw new Error("A race needs a season");
  if (!(await getDoc(doc(db, "seasons", input.seasonId))).exists()) {
    throw new Error(`No season ${input.seasonId}`);
  }

  const order = names.map(playerId);
  if (new Set(order).size !== order.length) {
    throw new Error("Finishing order contains a duplicate");
  }

  const dnf = (input.dnfNames ?? []).map((n) => playerId(n.trim())).filter(Boolean);
  for (const id of dnf) {
    if (!order.includes(id)) {
      throw new Error(`DNF ${id} is not in the finishing order`);
    }
  }

  const members = await getDocs(
    collection(db, "seasons", input.seasonId, "members"),
  );
  const claims = new Map<PlayerId, string>();
  for (const m of members.docs) {
    const claimedBy = m.data().claimedBy as string | null | undefined;
    if (claimedBy) claims.set(m.id, claimedBy);
  }

  const location = input.location?.trim();
  const at = Timestamp.fromDate(input.scheduledAt);
  const lapCount = input.lapCount ?? 1;
  const turnMs = (input.turnSeconds ?? 90) * 1000;
  const batch = writeBatch(db);
  const raceRef = doc(collection(db, "races"));

  names.forEach((name, i) => {
    batch.set(
      doc(db, "players", order[i]),
      { name, displayName: name, active: true },
      { merge: true },
    );
  });

  batch.set(raceRef, {
    seasonId: input.seasonId,
    track: input.track,
    ...(location ? { location } : {}),
    scheduledAt: at,
    status: "complete",
    lapCount,
    backfilled: true,
    // The same denormalized cache finishRace writes, so standings stay a pure
    // function over the races listener and this race needs no special case.
    result: { order, dnf },
  });

  batch.set(doc(db, "races", raceRef.id, "state", "live"), {
    currentPlayerId: null,
    turnStartedAt: null,
    turnDurationMs: turnMs,
    turnDurationDefaultMs: turnMs,
    // Round 0: no round was ever played here, and 1 would claim one was.
    currentRound: 0,
    phase: "turn",
    betweenRounds: false,
    positionOrder: order,
    roundOrder: order,
    retired: dnf,
    previousRoundOrder: null,
    updatedAt: serverTimestamp(),
  });

  // Both events are stamped with the date the race was run rather than now.
  // `at` means "when this happened" everywhere else in the log, and what
  // happened here is a race on that day; stamping them with the moment of data
  // entry would put a race from March at the top of the log.
  batch.set(doc(collection(db, "races", raceRef.id, "events")), {
    type: "raceCreated",
    at,
    source: "manual",
    actor: null,
    track: input.track,
    ...(location ? { location } : {}),
    lapCount,
    order,
    turnDurationMs: turnMs,
  });
  batch.set(doc(collection(db, "races", raceRef.id, "events")), {
    type: "raceFinished",
    // A second later, so the two sort in the order they happened rather than
    // arbitrarily — a shared timestamp would leave the log reading backwards.
    at: Timestamp.fromMillis(at.toMillis() + 1000),
    source: "manual",
    actor: null,
    order,
    dnf,
  });

  order.forEach((id, i) => {
    batch.set(doc(db, "races", raceRef.id, "participants", id), {
      playerId: id,
      startPosition: i + 1,
      // Nobody counted laps in a race the app did not time.
      lapsCompleted: 0,
      finalPosition: i + 1,
      dnf: dnf.includes(id),
      claimedBy: claims.get(id) ?? null,
    });
  });

  await batch.commit();
  return raceRef.id;
}
