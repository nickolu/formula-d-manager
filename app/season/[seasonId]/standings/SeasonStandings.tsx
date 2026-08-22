"use client";

import Nav from "@/app/Nav";
import SeasonHeader from "@/app/SeasonHeader";
import StandingsTable from "@/app/standings/StandingsTable";
import { useSeason } from "@/lib/hooks";

/**
 * One season's standings, reachable cold from a bookmark — which is why it is a
 * real route and not a mode of `/standings`.
 */
export default function SeasonStandings({ seasonId }: { seasonId: string }) {
  const { season } = useSeason(seasonId);

  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav />
      <h1 className="text-3xl font-semibold">Standings</h1>
      <SeasonHeader season={season} teamsHref={`/season/${seasonId}/teams`} />
      <StandingsTable seasonId={seasonId} />
    </main>
  );
}
