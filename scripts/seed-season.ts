/**
 * Creates the default season document if it is missing.
 *
 *   npm run seed-season
 *
 * The seasons collection did not exist through Phase 1 — createRace has always
 * written seasonId "default" against nothing. Standings need a scoringConfig to
 * read, so this seeds one. It is a no-op if the season already exists, and will
 * never overwrite a scoring table that has since been tuned in the console.
 */
import { getAuth, signInAnonymously } from "firebase/auth";
import { app } from "../lib/firebase";
import { DEFAULT_SEASON_ID, ensureSeason } from "../lib/seasons";

async function main() {
  await signInAnonymously(getAuth(app));
  const season = await ensureSeason(DEFAULT_SEASON_ID);

  console.log(`season "${season.id}" (${season.name})`);
  console.log(`  positions      ${season.scoringConfig.positionPoints.join(", ")}`);
  console.log(`  beyond table   ${season.scoringConfig.pointsBeyondTable}`);
  console.log("\nEdit these in the Firestore console — scoring is data, not code.");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-season failed:", e);
  process.exit(1);
});
