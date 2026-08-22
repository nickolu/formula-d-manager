"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { readableInk } from "@/lib/cars";
import {
  usePlayers,
  useSeasonMembers,
  useStandings,
  useTeamStandings,
  useUid,
} from "@/lib/hooks";
import { teamConfigFor } from "@/lib/teams";
import type { PlayerId, SeasonStanding, Team } from "@/lib/types";

type SortKey = "points" | "wins" | "teamPoints" | "teamRank";
const SORT_KEY = "formulad:standingsSort";

/**
 * Which column the table was last sorted by, remembered per device.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than an effect: the server snapshot is "points",
 * which is what SSR renders, and the client swaps to the stored value during
 * hydration without a cascading re-render or a mismatch. The same shape as
 * `formulad:standingsMode` in the player view.
 */
let sortListeners: (() => void)[] = [];

function subscribeSort(cb: () => void) {
  sortListeners.push(cb);
  return () => {
    sortListeners = sortListeners.filter((l) => l !== cb);
  };
}

function readSort(): SortKey {
  const stored = localStorage.getItem(SORT_KEY);
  return stored === "wins" || stored === "teamPoints" || stored === "teamRank"
    ? stored
    : "points";
}

function writeSort(next: SortKey) {
  localStorage.setItem(SORT_KEY, next);
  sortListeners.forEach((l) => l());
}

/**
 * One season's standings: drivers, and — when the season has teams on —
 * constructors, behind a segmented control.
 *
 * Both tables are derived on every render from listeners already open. Nothing
 * here is stored, which is what lets a scoring change or a team correction
 * re-sort the whole season without touching a race.
 */
export default function StandingsTable({ seasonId }: { seasonId: string }) {
  const { standings, season, loading, racesRun } = useStandings(seasonId);
  const { teamStandings, teams } = useTeamStandings(seasonId);
  const { members } = useSeasonMembers(seasonId);
  const players = usePlayers();
  const uid = useUid();

  // Derived from the season claim, never stored — the same rule "my racer"
  // follows everywhere else. A table of a dozen names is hard to find yourself
  // in, and yours is the row you came to look at.
  const mine = uid
    ? (members.find((m) => m.claimedBy === uid)?.playerId ?? null)
    : null;
  const sort = useSyncExternalStore(
    subscribeSort,
    readSort,
    () => "points" as SortKey,
  );
  const [tab, setTab] = useState<"drivers" | "constructors">("drivers");

  const config = teamConfigFor(season);
  const teamsOn = config.enabled && teams.length > 0;

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamOfPlayer = useMemo(() => {
    const map = new Map<PlayerId, Team>();
    for (const team of teams) {
      for (const id of team.members) map.set(id, team);
    }
    return map;
  }, [teams]);
  const teamRank = useMemo(
    () => new Map(teamStandings.map((row, i) => [row.teamId, i])),
    [teamStandings],
  );
  const teamPoints = useMemo(
    () => new Map(teamStandings.map((row) => [row.teamId, row.points])),
    [teamStandings],
  );

  const colourOf = (team: Team | undefined) =>
    team
      ? (config.palette.find((c) => c.key === team.colorKey)?.hex ?? "#666")
      : undefined;

  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  const sorted = useMemo(() => {
    const rows = [...standings];
    const teamOf = (row: SeasonStanding) => teamOfPlayer.get(row.playerId);
    // Only the primary key changes; ties keep the order computeStandings put
    // them in, which is already points-then-countback-then-name.
    if (sort === "wins") {
      rows.sort((a, b) => b.wins - a.wins);
    } else if (sort === "teamPoints") {
      rows.sort(
        (a, b) =>
          (teamPoints.get(teamOf(b)?.id ?? "") ?? -1) -
          (teamPoints.get(teamOf(a)?.id ?? "") ?? -1),
      );
    } else if (sort === "teamRank") {
      // Sorting by team rank groups teammates together — the constructors view
      // in disguise, and worth having beside the drivers' own numbers.
      rows.sort(
        (a, b) =>
          (teamRank.get(teamOf(a)?.id ?? "") ?? 99) -
          (teamRank.get(teamOf(b)?.id ?? "") ?? 99),
      );
    }
    return rows;
  }, [standings, sort, teamOfPlayer, teamPoints, teamRank]);

  if (loading) {
    return <p className="mt-8 text-neutral-500">Loading standings…</p>;
  }

  if (!season) {
    return (
      <p className="mt-8 text-neutral-500">
        That season is gone. Its races may still be listed on{" "}
        <Link href="/" className="text-emerald-500">
          the race list
        </Link>
        .
      </p>
    );
  }

  // Empty means an empty league, not an unraced one: the roster seeds a row per
  // member, so a season with members shows them all on zero before a flag drops.
  if (standings.length === 0) {
    return (
      <p className="mt-8 text-neutral-500">
        Nobody in the league yet. Add a roster on the season page and the table
        fills in, on zero, before anyone has raced.
      </p>
    );
  }

  // The leader by points, which keeps the crown regardless of the sort in
  // force — sorting by team rank must not decorate whoever floats to the top.
  const leader = standings[0]?.playerId;
  const leadingTeam = teamStandings[0]?.teamId;

  const uneven = teamsOn
    ? teams.some((t) => t.members.length !== config.teamSize)
    : false;
  const remainder = teamsOn ? members.length % config.teamSize : 0;

  return (
    <section className="mt-6">
      {/* No control at all when teams are off — an empty tab is worse than
          none, the same rule PlayerTabs follows. */}
      {teamsOn && (
        <div className="mb-4 flex gap-1 rounded-xl border border-neutral-800 p-1">
          {(["drivers", "constructors"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`flex-1 rounded-lg py-2 text-sm capitalize ${
                tab === key ? "bg-neutral-800" : "text-neutral-400"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Contrast for the Races column: a driver on 0 of 7 missed all seven,
          and a missed race scores nothing at all — deliberately not a DNF. */}
      <p className="mb-3 text-sm text-neutral-500">
        {racesRun === 0
          ? "No races run yet — everyone starts on zero."
          : `${racesRun} race${racesRun === 1 ? "" : "s"} run. "Races" is how many each driver entered.`}
        {(uneven || remainder !== 0) && (
          // The unfairness shows up here, so it is said here as well as on the
          // admin page — flagged, never blocked.
          <span className="mt-1 block text-amber-400">
            {uneven && `Teams are not all ${config.teamSize}. `}
            {remainder !== 0 &&
              `${remainder} ${remainder === 1 ? "driver is" : "drivers are"} left over.`}
          </span>
        )}
      </p>

      {tab === "constructors" && teamsOn ? (
        <ol className="flex flex-col gap-2">
          {teamStandings.map((row, i) => {
            const team = teamById.get(row.teamId);
            const colour = colourOf(team) ?? "#666";
            return (
              <li
                key={row.teamId}
                className="rounded-2xl border border-neutral-800 p-3"
                style={{ borderLeft: `4px solid ${colour}` }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-neutral-500">{i + 1}</span>
                  {/* A different mark from the driver's crown on purpose: two
                      crowns on one row reads as one thing being doubly first. */}
                  {row.teamId === leadingTeam && (
                    <span
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{ background: colour, color: readableInk(colour) }}
                      title="Leading constructor"
                    >
                      🏆
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-lg">
                    {team?.name ?? row.teamId}
                  </span>
                  <span className="shrink-0 font-medium">{row.points}</span>
                </div>
                <ul className="mt-2 flex flex-col gap-1 pl-8">
                  {row.memberIds.map((id) => (
                    <li
                      key={id}
                      className={`flex justify-between gap-3 text-sm ${
                        id === mine ? "text-emerald-400" : "text-neutral-400"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        {nameOf(id)}
                        {id === mine && (
                          <span className="ml-2 text-xs uppercase tracking-wide">
                            you
                          </span>
                        )}
                      </span>
                      <span className="shrink-0">
                        {standings.find((s) => s.playerId === id)?.points ?? 0}
                      </span>
                    </li>
                  ))}
                  {row.memberIds.length === 0 && (
                    <li className="text-sm text-neutral-600">No drivers yet.</li>
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
      ) : (
        // The table scrolls, not the page — a horizontal scrollbar on the body
        // at phone width puts every other column out of reach.
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Driver</th>
                <SortHeader label="Pts" value="points" sort={sort} />
                <th className="py-2 pr-3 text-right font-medium">Races</th>
                <SortHeader label="Wins" value="wins" sort={sort} />
                <th className="py-2 pr-3 text-right font-medium">Podiums</th>
                <th className="py-2 pr-3 text-right font-medium">DNF</th>
                <th className="py-2 pr-3 text-right font-medium">Best</th>
                {teamsOn && (
                  <>
                    <SortHeader
                      label="Team"
                      value="teamRank"
                      sort={sort}
                      align="left"
                    />
                    <SortHeader label="Team pts" value="teamPoints" sort={sort} />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const team = teamOfPlayer.get(row.playerId);
                const colour = colourOf(team);
                return (
                  <tr
                    key={row.playerId}
                    className={`border-b border-neutral-900 ${
                      row.playerId === mine ? "bg-emerald-950/40" : ""
                    }`}
                    // Grouping you can read without a legend. Colour is never
                    // the only signal — the Team column names it too, so this
                    // works for anyone who cannot rely on hue.
                    style={
                      colour ? { borderLeft: `4px solid ${colour}` } : undefined
                    }
                  >
                    <td className="py-2 pl-2 pr-3 text-neutral-500">{i + 1}</td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {row.playerId === leader && (
                        <span title="Leading driver">👑 </span>
                      )}
                      {nameOf(row.playerId)}
                      {/* Said as well as shaded: the tint alone is invisible to
                          anyone who cannot rely on colour, and it is also the
                          one row someone scrolls looking for. */}
                      {row.playerId === mine && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-emerald-500">
                          you
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {row.points}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-400">
                      {row.races}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-400">
                      {row.wins}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-400">
                      {row.podiums}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-400">
                      {row.dnfs}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-400">
                      {row.bestFinish ?? "—"}
                    </td>
                    {teamsOn && (
                      <>
                        <td className="whitespace-nowrap py-2 pr-3 text-neutral-400">
                          {team?.name ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-neutral-400">
                          {team ? (teamPoints.get(team.id) ?? 0) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Surfacing the table makes it obvious that scoring is data, not code. */}
      <p className="mt-6 text-xs text-neutral-600">
        {season.name} · points {season.scoringConfig.positionPoints.join("-")}
        {", then "}
        {season.scoringConfig.pointsBeyondTable} · retirements score their
        placing
        {teamsOn && ` · teams score by ${config.scoring}`}
      </p>

      <Link href="/" className="mt-6 inline-block text-sm text-emerald-500">
        ← races
      </Link>
    </section>
  );
}

function SortHeader({
  label,
  value,
  sort,
  align = "right",
}: {
  label: string;
  value: SortKey;
  sort: SortKey;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : ""}`}
    >
      <button
        onClick={() => writeSort(value)}
        aria-pressed={sort === value}
        className={sort === value ? "text-neutral-200 underline" : ""}
      >
        {label}
      </button>
    </th>
  );
}
