"use client";

import Link from "next/link";
import { usePlayers, useStandings } from "@/lib/hooks";
import { DEFAULT_SEASON_ID } from "@/lib/seasons";

export default function StandingsTable() {
  const { standings, season, loading, racesRun } = useStandings(DEFAULT_SEASON_ID);
  const players = usePlayers();

  if (loading) {
    return <p className="mt-8 text-neutral-500">Loading standings…</p>;
  }

  if (!season) {
    return (
      <p className="mt-8 text-neutral-500">
        No season yet. Run{" "}
        <code className="text-neutral-300">npm run seed-season</code> to create
        one.
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

  return (
    <section className="mt-8">
      {/* Contrast for the Races column: a driver on 0 of 7 missed all seven,
          and a missed race scores nothing at all — deliberately not a DNF. */}
      <p className="mb-3 text-sm text-neutral-500">
        {racesRun === 0
          ? "No races run yet — everyone starts on zero."
          : `${racesRun} race${racesRun === 1 ? "" : "s"} run. "Races" is how many each driver entered.`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Driver</th>
              <th className="py-2 pr-3 text-right font-medium">Pts</th>
              <th className="py-2 pr-3 text-right font-medium">Races</th>
              <th className="py-2 pr-3 text-right font-medium">Wins</th>
              <th className="py-2 pr-3 text-right font-medium">Podiums</th>
              <th className="py-2 pr-3 text-right font-medium">DNF</th>
              <th className="py-2 text-right font-medium">Best</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={row.playerId} className="border-b border-neutral-900">
                <td className="py-2 pr-3 text-neutral-500">{i + 1}</td>
                <td className="py-2 pr-3">
                  {players.get(row.playerId)?.displayName ?? row.playerId}
                </td>
                <td className="py-2 pr-3 text-right font-medium">{row.points}</td>
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
                <td className="py-2 text-right text-neutral-400">
                  {row.bestFinish ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Surfacing the table makes it obvious that scoring is data, not code. */}
      <p className="mt-6 text-xs text-neutral-600">
        {season.name} · points {season.scoringConfig.positionPoints.join("-")}
        {", then "}
        {season.scoringConfig.pointsBeyondTable} · DNF{" "}
        {season.scoringConfig.dnfPoints}
      </p>

      <Link href="/" className="mt-6 inline-block text-sm text-emerald-500">
        ← races
      </Link>
    </section>
  );
}
