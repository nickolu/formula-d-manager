"use client";

import Nav from "./Nav";
import SeasonHeader from "./SeasonHeader";
import SeasonTabs from "./SeasonTabs";
import { useCurrentSeason, useSeason } from "@/lib/hooks";

/**
 * The frame every season page shares: which season, a way to change it, and the
 * three places a player can be inside it.
 *
 * Used by both `/` (no id — it resolves the current season) and the
 * `/season/:id` layout. One component, because they are the same page furniture
 * and two copies would drift.
 *
 * `/` never redirects, even when there is exactly one live race and even when
 * there is exactly one season. A player arrives cold, on a phone, and the root
 * has to be the same shape every week — which is also why its Races tab points
 * at `/` rather than at the season's own URL.
 */
export default function SeasonShell({
  seasonId,
  children,
}: {
  seasonId?: string;
  children: React.ReactNode;
}) {
  const current = useCurrentSeason();
  const explicit = useSeason(seasonId);

  const season = seasonId ? explicit.season : current.season;
  const loading = seasonId ? explicit.loading : current.loading;
  const id = seasonId ?? season?.id;

  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav standings={false} />
      <h1 className="text-3xl font-semibold">Formula D</h1>
      <SeasonHeader season={season} />
      {id && <SeasonTabs seasonId={id} racesHref={seasonId ? `/season/${id}` : "/"} />}

      {loading ? (
        <p className="mt-8 text-neutral-500">Loading…</p>
      ) : !season ? (
        <p className="mt-8 rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
          {seasonId
            ? "That season is gone."
            : "No season yet. The commissioner makes one from the admin page."}
        </p>
      ) : (
        children
      )}
    </main>
  );
}
