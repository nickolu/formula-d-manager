/**
 * Builds each season's roster from the races that have already been run.
 *
 *   npm run backfill-season-members            # every season
 *   npm run backfill-season-members -- default # one season
 *
 * The roster is new; the races are not. Rather than make anyone retype a league
 * they have been playing in for months, this unions every race's participants
 * into `seasons/{id}/members`.
 *
 * Idempotent, like `seed-season`: a member that already exists is left exactly
 * as it is, so re-running can never clobber a `teamId` or a season claim.
 *
 * It writes the member documents **directly** rather than through
 * `addSeasonMember`, and that is deliberate. `addSeasonMember` fans out over the
 * season's unsealed races to join the new player to them — which is right when
 * somebody actually turns up, and wrong here: these players were already on
 * those grids, and the fan-out would append a `playerJoined` event claiming they
 * arrived today. A migration records that the roster caught up with history, not
 * that history happened again — so it appends no season event either.
 */
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { app, db } from "../lib/firebase";
import { seasonMemberDoc, seasonsCol } from "../lib/seasons";
import type { PlayerId, Race } from "../lib/types";

async function rosterFor(seasonId: string): Promise<Set<PlayerId>> {
  const races = await getDocs(
    query(collection(db, "races"), where("seasonId", "==", seasonId)),
  );
  const ids = new Set<PlayerId>();
  for (const raceDoc of races.docs) {
    const race = { id: raceDoc.id, ...raceDoc.data() } as Race;
    // The result is the sealed record of who was on the grid; participants
    // cover races still running, and a scheduled one that nobody finished.
    for (const id of race.result?.order ?? []) ids.add(id);
    const participants = await getDocs(
      collection(db, "races", raceDoc.id, "participants"),
    );
    for (const p of participants.docs) ids.add(p.id);
  }
  return ids;
}

async function main() {
  await signInAnonymously(getAuth(app));

  const only = process.argv[2];
  const seasons = only
    ? [only]
    : (await getDocs(seasonsCol())).docs.map((d) => d.id);

  for (const seasonId of seasons) {
    const ids = [...(await rosterFor(seasonId))].sort();
    let added = 0;

    for (const playerId of ids) {
      const ref = seasonMemberDoc(seasonId, playerId);
      if ((await getDoc(ref)).exists()) continue;
      await setDoc(ref, { playerId, joinedAt: serverTimestamp() });
      added++;
    }

    console.log(
      `${seasonId}: ${ids.length} racer(s) found in past races, ${added} added`,
    );
  }

  console.log("\nRe-running this is safe — existing members are left alone.");
  process.exit(0);
}

main().catch((e) => {
  console.error("backfill-season-members failed:", e);
  process.exit(1);
});
