"use client";

import Nav from "./Nav";
import RaceList from "./RaceList";
import SeasonHeader from "./SeasonHeader";
import { useCurrentSeason, useSeason } from "@/lib/hooks";

/**
 * The player landing, for one season.
 *
 * Rendered by both `/` (with no id, resolving the current season) and
 * `/season/:id` (explicit). One component, because they are the same page and
 * two copies would drift — the same reasoning as `RaceList`'s `variant`.
 *
 * `/` never redirects, even when there is exactly one live race and even when
 * there is exactly one season. A player arrives cold, on a phone, and the root
 * has to be the same shape every week.
 */
export default function SeasonRaces({ seasonId }: { seasonId?: string }) {
  const current = useCurrentSeason();
  const explicit = useSeason(seasonId);

  const season = seasonId ? explicit.season : current.season;
  const loading = seasonId ? explicit.loading : current.loading;
  const id = seasonId ?? season?.id;

  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav />
      <h1 className="text-3xl font-semibold">Formula D</h1>
      <SeasonHeader
        season={season}
        standingsHref={id ? `/season/${id}/standings` : undefined}
      />

      {loading ? (
        <p className="mt-8 text-neutral-500">Loading…</p>
      ) : !season ? (
        <p className="mt-8 rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
          {seasonId
            ? "That season is gone."
            : "No season yet. The commissioner makes one from the admin page."}
        </p>
      ) : (
        <>
          <p className="mt-4 text-neutral-500">Tap your race.</p>
          <RaceList variant="player" seasonId={season.id} />
        </>
      )}
    </main>
  );
}
