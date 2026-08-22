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
import { joinRace, participantDoc, removePlayer } from "./race";
import { playerId as slugFor } from "./setup";
import type {
  Actor,
  PlayerId,
  Race,
  ScoringConfig,
  Season,
  SeasonSettingsPatchShape,
  TeamConfigPatchShape,
} from "./types";

export const seasonsCol = () => collection(db, "seasons");
export const seasonDoc = (seasonId: string) => doc(db, "seasons", seasonId);
export const seasonEventsCol = (seasonId: string) =>
  collection(db, "seasons", seasonId, "events");
export const seasonMembersCol = (seasonId: string) =>
  collection(db, "seasons", seasonId, "members");
export const seasonMemberDoc = (seasonId: string, playerId: PlayerId) =>
  doc(db, "seasons", seasonId, "members", playerId);

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
};

/**
 * The season log's counterpart to `lib/race.ts`'s appendEvent. Same shape, same
 * rule: every mutation writes its document and appends its event in one
 * transaction, and nothing writes a season document from a component.
 *
 * Exported for `lib/teams.ts`, which is the same log written by a different
 * file — teams are season state, so their changes belong in the season's log.
 */
export function appendSeasonEvent(
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
 * Turns teams on, and edits how they work. Written by **dot path**, exactly as
 * `updateRaceSettings` writes race toggles: writing `teamConfig` whole would
 * silently clear whichever field this caller did not mention — the palette,
 * most obviously, which is the one nobody restates.
 *
 * Appends one `seasonSettingsChanged` carrying only what changed, so the log
 * reads as a diff.
 *
 * Two things it deliberately does NOT do:
 *
 * - It does not enforce equal team sizes, or that the roster divides by
 *   `teamSize`. Those span the whole season, so a transaction cannot check them
 *   without a query — and enforcing them would block creating the third team
 *   until the first two are full, which is hostile during the ten minutes the
 *   commissioner spends setting a league up. The admin view flags them.
 * - It does not kick anyone when `teamSize` shrinks below an existing team's
 *   size. That blocks new joins and leaves everyone where they are. Removing
 *   someone from their team because a setting changed is the sort of thing that
 *   ends a game night.
 *
 * It does refuse to drop a palette colour a team currently holds, because the
 * team would be left pointing at a colour that no longer exists.
 */
export async function updateTeamConfig(
  seasonId: string,
  patch: TeamConfigPatchShape,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(seasonDoc(seasonId));
    if (!snap.exists()) throw new Error(`No season ${seasonId}`);
    const season = { id: seasonId, ...snap.data() } as Season;

    const applied: TeamConfigPatchShape = {};
    const fields: Record<string, unknown> = {};

    if (patch.enabled !== undefined) {
      fields["teamConfig.enabled"] = patch.enabled;
      applied.enabled = patch.enabled;
    }
    if (patch.teamSize !== undefined) {
      if (!Number.isInteger(patch.teamSize) || patch.teamSize < 1) {
        throw new Error("Team size must be a whole number, at least 1");
      }
      fields["teamConfig.teamSize"] = patch.teamSize;
      applied.teamSize = patch.teamSize;
    }
    if (patch.playerManaged !== undefined) {
      fields["teamConfig.playerManaged"] = patch.playerManaged;
      applied.playerManaged = patch.playerManaged;
    }
    if (patch.scoring !== undefined) {
      fields["teamConfig.scoring"] = patch.scoring;
      applied.scoring = patch.scoring;
    }
    if (patch.palette !== undefined) {
      if (patch.palette.length === 0) {
        throw new Error("A palette needs at least one colour");
      }
      const keys = new Set(patch.palette.map((c) => c.key));
      if (keys.size !== patch.palette.length) {
        throw new Error("Two palette colours share a key");
      }
      // A team wearing a colour that has just been deleted would point at
      // nothing. Read from the claimed-colours map on this same document.
      for (const [key, teamId] of Object.entries(season.teamColors ?? {})) {
        if (!keys.has(key)) {
          throw new Error(
            `${key} is being worn by a team — recolour or delete team ${teamId} first`,
          );
        }
      }
      fields["teamConfig.palette"] = patch.palette;
      applied.palette = patch.palette;
    }

    if (Object.keys(applied).length === 0) return;

    tx.update(seasonDoc(seasonId), fields);
    appendSeasonEvent(tx, seasonId, who, {
      type: "seasonSettingsChanged",
      patch: { teamConfig: applied },
    });
  });
}

/**
 * The season's races that a roster change is allowed to touch: everything that
 * has not been sealed. Read outside any transaction, because the web SDK cannot
 * run a collection query inside one.
 */
async function unsealedRaces(seasonId: string): Promise<Race[]> {
  const snap = await getDocs(
    query(
      collection(db, "races"),
      where("seasonId", "==", seasonId),
      where("status", "in", ["scheduled", "live"]),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Race);
}

/**
 * Adds a racer to the league, and to every race in it that has not been sealed.
 *
 * "A player added to a season is added to all races in that season" reads as a
 * fan-out over every race. It must not be one. **A finished race is never
 * written to.** Adding someone to a sealed `result.order` would mutate the
 * scoring cache of a race they did not run so that standings could read a zero
 * back out of it — a lie in the log to produce a number.
 *
 * The +0 falls out for free from the roster being an *input* to
 * `computeStandings`: it seeds a zero row per member, so a player who joined in
 * week five shows 0 points and 0 races entered while `result` still records
 * exactly who was on the grid.
 *
 * So the fan-out covers `scheduled` and `live` races only — usually one, often
 * none — and each is an ordinary `joinRace` appending its own `playerJoined`
 * event to that race's log. A loop of transactions rather than one transaction,
 * because the race list has to be queried first.
 */
export async function addSeasonMember(
  seasonId: string,
  name: string,
  who: Actor,
): Promise<PlayerId> {
  const trimmed = name.trim();
  // Ids are name slugs so the same human is stable across races and seasons —
  // which also means a name of only punctuation slugs to nothing.
  const playerId = slugFor(trimmed);
  if (!trimmed || !playerId) throw new Error("Enter a name");

  await runTransaction(db, async (tx) => {
    const season = await tx.get(seasonDoc(seasonId));
    if (!season.exists()) throw new Error(`No season ${seasonId}`);
    const existing = await tx.get(seasonMemberDoc(seasonId, playerId));
    if (existing.exists()) throw new Error(`${trimmed} is already in this season`);

    // merge so a returning player's record isn't clobbered, matching createRace.
    tx.set(
      doc(db, "players", playerId),
      { name: trimmed, displayName: trimmed, active: true },
      { merge: true },
    );
    tx.set(seasonMemberDoc(seasonId, playerId), {
      playerId,
      joinedAt: serverTimestamp(),
    });
    appendSeasonEvent(tx, seasonId, who, {
      type: "memberAdded",
      playerId,
      name: trimmed,
    });
  });

  for (const race of await unsealedRaces(seasonId)) {
    // Already on that grid is the ordinary case when a race was created from
    // the roster, and joinRace refuses a duplicate. The pre-check keeps the
    // common path quiet; joinRace's own transaction is still the authority.
    if ((await getDoc(participantDoc(race.id, playerId))).exists()) continue;
    await joinRace(race.id, trimmed, null, who);
  }

  return playerId;
}

/**
 * Removes a racer from the league, and from the season's `scheduled` races.
 *
 * **Refuses outright if they are on a live grid.** `removePlayer` refuses there
 * anyway, but failing half way through a fan-out is worse than failing up
 * front: the season would be left having dropped them from two races and not a
 * third. Retiring the car is the in-race answer, and it is reversible.
 *
 * Finished races are untouched — a member who leaves keeps the results of the
 * races they actually ran.
 */
export async function removeSeasonMember(
  seasonId: string,
  playerId: PlayerId,
  who: Actor,
) {
  const races = await unsealedRaces(seasonId);

  // Every reason this could fail is checked before anything is written.
  const scheduled: string[] = [];
  for (const race of races) {
    const live = await getDoc(doc(db, "races", race.id, "state", "live"));
    const grid = (live.data()?.positionOrder ?? []) as PlayerId[];
    if (!grid.includes(playerId)) continue;
    if (race.status !== "scheduled") {
      throw new Error(
        `${playerId} is racing in ${race.track}. Retire the car instead — that is reversible.`,
      );
    }
    if (grid.length <= 1) {
      throw new Error(
        `${race.track} would have no cars left. Delete that race first.`,
      );
    }
    scheduled.push(race.id);
  }

  for (const raceId of scheduled) {
    await removePlayer(raceId, playerId, who);
  }

  await runTransaction(db, async (tx) => {
    const member = await tx.get(seasonMemberDoc(seasonId, playerId));
    if (!member.exists()) throw new Error(`${playerId} is not in this season`);

    tx.delete(seasonMemberDoc(seasonId, playerId));
    appendSeasonEvent(tx, seasonId, who, { type: "memberRemoved", playerId });
  });
}

/**
 * Claims a racer for the whole season, so a phone claims once instead of every
 * game night.
 *
 * This is a **default, not a second source of truth.** `createRace` and
 * `joinRace` seed `participants/{id}.claimedBy` from it, and from then on the
 * in-race claim is authoritative and still re-tappable — which is what makes a
 * stale claim from a borrowed tablet one tap to fix. "My racer" is still
 * *derived*: the participant whose `claimedBy` matches this device's uid.
 * Nothing anywhere stores "which racer is mine".
 *
 * `currentlyHeld` is the racer this device already holds, passed in rather than
 * looked up because **the web SDK cannot run a collection query inside a
 * transaction** — the same problem `claimRacer` solved. It is *verified* before
 * being cleared, so a stale value can never free someone else's claim.
 *
 * Today the uid is a device, not a person. When Phase 2 brings Google accounts
 * this becomes a real person-to-racer link, which is the shape to build toward.
 */
export async function claimSeasonRacer(
  seasonId: string,
  playerId: PlayerId,
  uid: string,
  currentlyHeld: PlayerId | null,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const ref = seasonMemberDoc(seasonId, playerId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`${playerId} is not in this season`);

    const previous =
      currentlyHeld && currentlyHeld !== playerId
        ? await tx.get(seasonMemberDoc(seasonId, currentlyHeld))
        : null;

    const claimedBy = (snap.data().claimedBy ?? null) as string | null;
    if (claimedBy === uid) return; // already ours
    if (claimedBy) throw new Error("Someone else already has that racer");

    if (previous?.exists() && previous.data().claimedBy === uid) {
      tx.update(previous.ref, { claimedBy: null });
      appendSeasonEvent(tx, seasonId, who, {
        type: "seasonRacerReleased",
        playerId: currentlyHeld,
        uid,
      });
    }

    tx.update(ref, { claimedBy: uid });
    appendSeasonEvent(tx, seasonId, who, {
      type: "seasonRacerClaimed",
      playerId,
      uid,
    });
  });
}

/** Gives a season claim back. A uid that doesn't hold it is a no-op, not an error. */
export async function releaseSeasonRacer(
  seasonId: string,
  playerId: PlayerId,
  uid: string,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const ref = seasonMemberDoc(seasonId, playerId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    if (snap.data().claimedBy !== uid) return;

    tx.update(ref, { claimedBy: null });
    appendSeasonEvent(tx, seasonId, who, {
      type: "seasonRacerReleased",
      playerId,
      uid,
    });
  });
}

/**
 * The commissioner's override for the season claim — `clearRacerClaim`'s
 * counterpart, and it exists for the same reason.
 *
 * The season claim is the one that follows a player from week to week, so a
 * stale one is the worse of the two: it seeds every race created afterwards,
 * which means a phone that claimed once and then died keeps taking that racer
 * on grids it will never sit at. `releaseSeasonRacer` needs the holder's uid;
 * the holder is exactly who is not here.
 *
 * Clearing this does **not** clear the claim inside a race that has already
 * started — those were seeded from here and are authoritative once written, so
 * they are freed from race settings. Two claims, two places, the same rule as
 * everywhere else in this file.
 */
export async function clearSeasonClaim(
  seasonId: string,
  playerId: PlayerId,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const ref = seasonMemberDoc(seasonId, playerId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`${playerId} is not in this season`);

    const uid = (snap.data().claimedBy ?? null) as string | null;
    if (!uid) return; // nobody holds it — nothing happened, so nothing is logged

    tx.update(ref, { claimedBy: null });
    appendSeasonEvent(tx, seasonId, who, {
      type: "seasonRacerReleased",
      playerId,
      uid,
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
