import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import type { CarStatusProperty, Race } from "./types";

/** Player ids are slugs of their name so the same human is stable across races. */
export function playerId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A sensible starting card. Tires at 30 matches the card in use here; the rest
 * are the usual three. Config, not code — this is only the seed.
 */
export const DEFAULT_CAR_STATUS_SPEC: CarStatusProperty[] = [
  { key: "tires", label: "Tires", max: 30 },
  { key: "brakes", label: "Brakes", max: 3 },
  { key: "gearbox", label: "Gearbox", max: 3 },
  { key: "engine", label: "Engine", max: 3 },
  { key: "body", label: "Body", max: 3 },
  { key: "nitro", label: "Nitro", max: 2 },
];

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

export interface NewRaceInput {
  track: string;
  lapCount: number;
  /** Starting grid order, front to back. */
  playerNames: string[];
  turnSeconds: number;
  seasonId?: string;
}

export async function createRace(input: NewRaceInput): Promise<string> {
  const names = input.playerNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Add at least one player");

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

  batch.set(raceRef, {
    seasonId: input.seasonId ?? "default",
    track: input.track,
    scheduledAt: serverTimestamp(),
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
      carStatus: { enabled: false, spec: DEFAULT_CAR_STATUS_SPEC },
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
    });
  });

  await batch.commit();
  return raceRef.id;
}
