import type {
  PlayerId,
  Race,
  RaceResult,
  ScoringConfig,
  SeasonStanding,
} from "./types";

/**
 * Scoring is a PURE function of a finished race plus the season's config. No
 * Firestore, no clock, no I/O — so house rules can be argued about and replayed
 * against past seasons without touching the database.
 *
 * The config lives in seasons.scoringConfig rather than in code because house
 * rules churn; changing them must not require a deploy.
 */
export function pointsFor(
  position: number,
  dnf: boolean,
  config: ScoringConfig,
): number {
  // A DNF is scored as a DNF regardless of where the car sat on track when it
  // retired, so retiring from the lead never out-scores finishing last.
  if (dnf) return config.dnfPoints;
  const table = config.positionPoints;
  // position is 1-based; anything past the end of the table gets the tail value.
  return position <= table.length
    ? table[position - 1]
    : config.pointsBeyondTable;
}

/** Points for every driver in one finished race, keyed by player id. */
export function scoreRace(
  result: RaceResult,
  config: ScoringConfig,
): Map<PlayerId, number> {
  const dnf = new Set(result.dnf);
  return new Map(
    result.order.map((playerId, i) => [
      playerId,
      pointsFor(i + 1, dnf.has(playerId), config),
    ]),
  );
}

/** A race counts toward standings only once it is complete AND has a result. */
export function isScorable(race: Race): race is Race & { result: RaceResult } {
  return race.status === "complete" && !!race.result;
}

/**
 * Season standings, derived rather than stored. Every input is already in
 * memory from the races listener, so this costs no extra reads and can never
 * drift out of sync with the races it summarizes.
 *
 * Ties break on countback: more wins, then more seconds, then more thirds — the
 * usual motorsport convention. A tie surviving all of that is a genuine tie and
 * is left in a stable order by name.
 */
export function computeStandings(
  races: Race[],
  config: ScoringConfig,
  seasonId?: string,
  members?: PlayerId[],
): SeasonStanding[] {
  const table = new Map<PlayerId, SeasonStanding>();

  // Seeding a zero row per season member is the whole of the "+0 for a race you
  // missed" requirement. The alternative — writing the member into a finished
  // race's result.order so the standings can read a zero back out — would
  // mutate the scoring cache of a race they did not run. A lie in the log to
  // produce a number; this produces the same number honestly.
  //
  // Note what it deliberately does NOT do: a member with no entry scores
  // *nothing*, not dnfPoints. Absent is not retired. That is invisible while
  // dnfPoints is 0 and stops being invisible the first time someone argues a
  // DNF should be worth a point.
  for (const playerId of members ?? []) table.set(playerId, emptyRow(playerId));

  const relevant = races
    .filter(isScorable)
    .filter((r) => !seasonId || r.seasonId === seasonId);

  for (const race of relevant) {
    const dnf = new Set(race.result.dnf);

    race.result.order.forEach((playerId, i) => {
      const position = i + 1;
      const retired = dnf.has(playerId);
      // Not filtered to `members`: someone who ran a race and later left the
      // league still scored those points, and dropping them would silently
      // change a past result.
      const row = table.get(playerId) ?? emptyRow(playerId);

      row.points += pointsFor(position, retired, config);
      row.races += 1;
      if (retired) {
        row.dnfs += 1;
      } else {
        if (position === 1) row.wins += 1;
        if (position <= 3) row.podiums += 1;
        // Best finish ignores retirements — a car that broke while running
        // second did not finish second.
        if (row.bestFinish === null || position < row.bestFinish) {
          row.bestFinish = position;
        }
        row.finishCounts[position - 1] =
          (row.finishCounts[position - 1] ?? 0) + 1;
      }

      table.set(playerId, row);
    });
  }

  return [...table.values()].sort(compareStandings);
}

/** A driver who has entered nothing yet — 0 points, 0 races, no best finish. */
function emptyRow(playerId: PlayerId): SeasonStanding {
  return {
    playerId,
    points: 0,
    races: 0,
    wins: 0,
    podiums: 0,
    dnfs: 0,
    bestFinish: null,
    finishCounts: [],
  };
}

/** Points, then countback through finishing positions, then name for stability. */
function compareStandings(a: SeasonStanding, b: SeasonStanding): number {
  if (a.points !== b.points) return b.points - a.points;

  const depth = Math.max(a.finishCounts.length, b.finishCounts.length);
  for (let i = 0; i < depth; i++) {
    const diff = (b.finishCounts[i] ?? 0) - (a.finishCounts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return a.playerId.localeCompare(b.playerId);
}
