import type {
  PlayerId,
  Race,
  RaceResult,
  ScoringConfig,
  SeasonStanding,
  Team,
  TeamConfig,
  TeamStanding,
} from "./types";

/**
 * Scoring is a PURE function of a finished race plus the season's config. No
 * Firestore, no clock, no I/O — so house rules can be argued about and replayed
 * against past seasons without touching the database.
 *
 * The config lives in seasons.scoringConfig rather than in code because house
 * rules churn; changing them must not require a deploy.
 */
export function pointsFor(position: number, config: ScoringConfig): number {
  // Retirement is deliberately NOT a special case. The finishing order already
  // encodes it: the first car to blow up is placed last, the next one above it,
  // and so on, so a retirement's position *is* its ranking. A separate dnfPoints
  // would score the same fact twice and let a flag override a placing.
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
  return new Map(
    result.order.map((playerId, i) => [playerId, pointsFor(i + 1, config)]),
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
  // *nothing*. **Absent is not retired** — a driver who blew up on lap one was
  // there and is placed last, which is worth whatever last is worth; a driver
  // who stayed home was not there at all and scores zero.
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

      // Scored on placing whether or not the car finished — the order already
      // says who broke and when.
      row.points += pointsFor(position, config);
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

/**
 * Constructor standings, derived the same way driver standings are — no
 * Firestore, no clock, no I/O.
 *
 * **Attribution is *current* membership**, and that is not an oversight.
 * The house rule is that nobody switches teams during a season, so there is no
 * historical team to look up and `RaceResult` carries no team snapshot. The
 * interesting case is what happens when someone *is* moved: under that rule it
 * is not a transfer, it is a **correction of a recording error** — the player
 * was always on that team and it was written down wrong. Re-deriving the whole
 * season's team standings is exactly the right behaviour for a correction. The
 * thing that would be a hazard in a transfer model is the desired outcome here.
 * The trail of who moved and when lives in the season log, not in this cache.
 *
 * A team's name and colour are current for the same reason: a constructor that
 * renames itself renames itself in the record books.
 *
 * A driver on no team contributes to no team and still appears in the drivers
 * table. A team whose every member missed a race simply scores nothing that
 * week.
 */
export function computeTeamStandings(
  races: Race[],
  config: ScoringConfig,
  teams: Team[],
  teamConfig?: Pick<TeamConfig, "scoring">,
  seasonId?: string,
): TeamStanding[] {
  // Every member's own row, which is where all the scoring already happens —
  // a team score is an aggregate of driver rows, not a second scoring rule.
  const drivers = new Map(
    computeStandings(
      races,
      config,
      // Scoped, not left open: unscoped races would quietly fold another
      // season's points into this one's team table — wrong rather than broken.
      seasonId,
      teams.flatMap((t) => t.members),
    ).map((row) => [row.playerId, row]),
  );

  const rows = teams.map((team) => {
    const members = team.members
      .map((id) => drivers.get(id))
      .filter((row): row is SeasonStanding => !!row);

    const finishCounts: number[] = [];
    let points = 0;
    let entries = 0;
    let wins = 0;

    for (const member of members) {
      points += member.points;
      entries += member.races;
      wins += member.wins;
      member.finishCounts.forEach((n, i) => {
        finishCounts[i] = (finishCounts[i] ?? 0) + (n ?? 0);
      });
    }

    // "average" divides by the members who actually ENTERED, not by teamSize:
    // dividing by a constant is a monotone transform and would rank identically
    // to "sum", which would make the option pointless. With equal full teams it
    // still changes nothing — it exists for the day the house rule bends.
    if (teamConfig?.scoring === "average") {
      const entered = members.filter((m) => m.races > 0).length;
      points = entered > 0 ? points / entered : 0;
    }

    return {
      teamId: team.id,
      points,
      finishCounts,
      memberIds: team.members,
      races: entries,
      wins,
    };
  });

  return rows.sort(compareTeamStandings);
}

/** Points, then the same countback the drivers table uses, then id for stability. */
function compareTeamStandings(a: TeamStanding, b: TeamStanding): number {
  if (a.points !== b.points) return b.points - a.points;

  const depth = Math.max(a.finishCounts.length, b.finishCounts.length);
  for (let i = 0; i < depth; i++) {
    const diff = (b.finishCounts[i] ?? 0) - (a.finishCounts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return a.teamId.localeCompare(b.teamId);
}
