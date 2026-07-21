import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { ScoringConfig, Season } from "./types";

export const seasonDoc = (seasonId: string) => doc(db, "seasons", seasonId);

/**
 * Every race created before seasons existed carries seasonId "default", and
 * createRace still falls back to it. Keep the id stable.
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

/**
 * Creates the season only if it is absent, so re-running this can never clobber
 * a scoring table someone has since tuned in the console.
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
