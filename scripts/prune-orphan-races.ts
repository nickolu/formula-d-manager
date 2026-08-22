/**
 * Finds races whose `seasonId` resolves to nothing, and optionally deletes them.
 *
 *   npm run prune-orphan-races             # report only
 *   npm run prune-orphan-races -- --delete # actually remove them
 *
 * `createRace` used to write `seasonId: "default"` against a document that might
 * not exist, so a race could belong to a season nothing could enumerate. It
 * verifies the season now, but races created before that stay orphaned:
 * invisible in every season-scoped list, and contributing to no standings.
 *
 * A one-time script rather than a button, deliberately. `deleteRace` refuses
 * anything that is not `complete`, for good reasons, and a UI for this would
 * become the back door around that rule. Here the refusal is reported and the
 * race is left alone — a live orphan is a race someone is playing, and the fix
 * for it is to point it at a season, not to delete it.
 *
 * Reports before it deletes, and re-running finds nothing: idempotent.
 */
import { getAuth, signInAnonymously } from "firebase/auth";
import { collection, getDoc, getDocs } from "firebase/firestore";
import { app, db } from "../lib/firebase";
import { deleteRace } from "../lib/race";
import { seasonDoc } from "../lib/seasons";
import type { Race } from "../lib/types";

async function main() {
  await signInAnonymously(getAuth(app));
  const remove = process.argv.includes("--delete");

  const races = await getDocs(collection(db, "races"));
  const seasons = new Map<string, boolean>();
  const orphans: Race[] = [];

  for (const d of races.docs) {
    const race = { id: d.id, ...d.data() } as Race;
    const seasonId = race.seasonId ?? "";
    if (!seasons.has(seasonId)) {
      seasons.set(
        seasonId,
        seasonId ? (await getDoc(seasonDoc(seasonId))).exists() : false,
      );
    }
    if (!seasons.get(seasonId)) orphans.push(race);
  }

  if (orphans.length === 0) {
    console.log(`${races.size} race(s) checked, none orphaned.`);
    process.exit(0);
  }

  console.log(`${orphans.length} orphaned race(s):\n`);
  for (const race of orphans) {
    console.log(
      `  ${race.id}  ${race.track}  [${race.status}]  season "${race.seasonId ?? "(none)"}"`,
    );
  }

  if (!remove) {
    console.log("\nRe-run with -- --delete to remove them.");
    process.exit(0);
  }

  console.log("");
  for (const race of orphans) {
    try {
      await deleteRace(race.id);
      console.log(`  deleted ${race.id}`);
    } catch (e) {
      // deleteRace refuses anything unfinished, and that rule holds here too.
      console.log(
        `  kept ${race.id} — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("prune-orphan-races failed:", e);
  process.exit(1);
});
