import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type Transaction,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  EventSource,
  ScoringConfig,
  Season,
  SeasonSettingsPatchShape,
} from "./types";

export const seasonsCol = () => collection(db, "seasons");
export const seasonDoc = (seasonId: string) => doc(db, "seasons", seasonId);
export const seasonEventsCol = (seasonId: string) =>
  collection(db, "seasons", seasonId, "events");

/**
 * Every race created before seasons existed carries seasonId "default", and
 * `seed-season` still creates it. Keep the id stable — races point at it.
 */
export const DEFAULT_SEASON_ID = "default";

/**
 * The starting house rules, used only to seed a season document that does not
 * exist yet. Once seeded, the values in Firestore win — editing scoring must
 * never require a deploy, so nothing reads this as a live fallback.
 */
export const DEFAULT_SCORING: ScoringConfig = {
  positionPoints: [10, 8, 6, 5, 4, 3, 2, 1],
  pointsBeyondTable: 0,
  dnfPoints: 0,
};

interface Actor {
  source: EventSource;
  actor?: string | null;
}

/**
 * The season log's counterpart to `lib/race.ts`'s appendEvent. Same shape, same
 * rule: every mutation writes its document and appends its event in one
 * transaction, and nothing writes a season document from a component.
 */
function appendSeasonEvent(
  tx: Transaction,
  seasonId: string,
  { source, actor = null }: Actor,
  payload: Record<string, unknown>,
) {
  const ref = doc(seasonEventsCol(seasonId));
  tx.set(ref, { ...payload, at: serverTimestamp(), source, actor });
  return ref;
}

/** Rejects a scoring table that would silently score races wrong. */
function validateScoring(config: ScoringConfig) {
  if (!Array.isArray(config.positionPoints) || config.positionPoints.length === 0) {
    throw new Error("Scoring needs points for at least first place");
  }
  if (config.positionPoints.some((n) => !Number.isFinite(n))) {
    throw new Error("Position points must all be numbers");
  }
  if (!Number.isFinite(config.pointsBeyondTable)) {
    throw new Error("Points beyond the table must be a number");
  }
  if (!Number.isFinite(config.dnfPoints)) {
    throw new Error("DNF points must be a number");
  }
}

export interface NewSeasonInput {
  name: string;
  /** Defaults to the house table. Editable afterwards without a deploy. */
  scoringConfig?: ScoringConfig;
  /**
   * When the season began. Settable rather than always `serverTimestamp()`,
   * because a season entered after the fact would otherwise sort to today —
   * the same trap `backfillRace` avoids in item 16.
   */
  startDate?: Date;
}

/**
 * Creates a season and seeds its log. The id is auto-generated: two seasons
 * called "Season 2" is a naming problem, not a collision.
 */
export async function createSeason(
  input: NewSeasonInput,
  who: Actor,
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("A season needs a name");
  const scoringConfig = input.scoringConfig ?? DEFAULT_SCORING;
  validateScoring(scoringConfig);

  const ref = doc(seasonsCol());
  await runTransaction(db, async (tx) => {
    tx.set(ref, {
      name,
      scoringConfig,
      startDate: input.startDate
        ? Timestamp.fromDate(input.startDate)
        : serverTimestamp(),
    });
    appendSeasonEvent(tx, ref.id, who, { type: "seasonCreated", name });
  });

  return ref.id;
}

export interface SeasonPatch {
  name?: string;
  scoringConfig?: ScoringConfig;
  /** True archives, false brings it back. Absent on the document means active. */
  archived?: boolean;
}

/**
 * The one way a season changes. Appends a single seasonSettingsChanged event
 * carrying only the fields the caller actually set, so the log reads as a diff
 * rather than a snapshot — exactly as updateRaceSettings does.
 */
export async function updateSeason(
  seasonId: string,
  patch: SeasonPatch,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(seasonDoc(seasonId));
    if (!snap.exists()) throw new Error(`No season ${seasonId}`);

    // Firestore rejects undefined, and an event carrying keys that did not
    // change would make the log lie about what happened.
    const applied: SeasonSettingsPatchShape = {};
    const fields: Record<string, unknown> = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("A season needs a name");
      fields.name = name;
      applied.name = name;
    }
    if (patch.scoringConfig !== undefined) {
      validateScoring(patch.scoringConfig);
      fields.scoringConfig = patch.scoringConfig;
      applied.scoringConfig = patch.scoringConfig;
    }
    if (patch.archived !== undefined) {
      fields.archived = patch.archived;
      applied.archived = patch.archived;
    }

    if (Object.keys(applied).length === 0) return;

    tx.update(seasonDoc(seasonId), fields);
    appendSeasonEvent(tx, seasonId, who, {
      type: "seasonSettingsChanged",
      patch: applied,
    });
  });
}

/**
 * Deletes a season, and **refuses one that has any race**.
 *
 * Cascading would mean deleting races, and deleteRace already refuses anything
 * that is not complete for good reasons — a season delete must not become the
 * back door around that. Archiving is what people actually want; this exists
 * for the season created by a mis-tap.
 *
 * Like deleteRace, it appends no event: there would be nowhere to append it to.
 * The event log survives orphaned — the rules forbid deleting event documents —
 * and is invisible to the app because nothing queries season events unscoped.
 * Subcollections go before the season document, so a failure part-way leaves a
 * findable season rather than orphaned members and teams.
 */
export async function deleteSeason(seasonId: string) {
  const snap = await getDoc(seasonDoc(seasonId));
  if (!snap.exists()) throw new Error(`No season ${seasonId}`);

  const races = await getDocs(
    query(collection(db, "races"), where("seasonId", "==", seasonId), limit(1)),
  );
  if (!races.empty) {
    throw new Error("This season has races. Archive it instead.");
  }

  // Members and teams belong to items 14 and 17; cleaning them up here means
  // those items cannot forget to, and an empty collection costs one query.
  for (const sub of ["members", "teams"]) {
    const docs = await getDocs(collection(db, "seasons", seasonId, sub));
    await Promise.all(docs.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(seasonDoc(seasonId));
}

/**
 * Creates the season only if it is absent, so re-running this can never clobber
 * a scoring table someone has since tuned in the console.
 *
 * Deliberately not routed through createSeason: it writes a *known* id, is
 * idempotent, and is a migration rather than a mutation. It appends no event —
 * seeding the season that Phase 1's races already claimed to be in is not a
 * thing that happened at the table.
 */
export async function ensureSeason(
  seasonId: string = DEFAULT_SEASON_ID,
  name = "Season 1",
): Promise<Season> {
  const ref = seasonDoc(seasonId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      name,
      scoringConfig: DEFAULT_SCORING,
      startDate: serverTimestamp(),
    });
    const created = await getDoc(ref);
    return { id: seasonId, ...created.data() } as Season;
  }

  return { id: seasonId, ...snap.data() } as Season;
}
