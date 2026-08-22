"use client";

import Nav from "@/app/Nav";
import SeasonHeader from "@/app/SeasonHeader";
import TeamPanel from "@/app/TeamPanel";
import { useSeason, useSeasonMembers, useUid } from "@/lib/hooks";

/**
 * The team panel standing alone, for between game nights when there is no race
 * to reach it through.
 *
 * The same component as the one under My racer — the join, leave and rename
 * paths are the same paths, so this is a second placement rather than a second
 * screen. The racer is resolved from the *season* claim here, because there is
 * no race to derive it from; in a race the participant's claim still wins.
 */
export default function SeasonTeams({ seasonId }: { seasonId: string }) {
  const { season } = useSeason(seasonId);
  const { members } = useSeasonMembers(seasonId);
  const uid = useUid();

  const mine = uid
    ? (members.find((m) => m.claimedBy === uid)?.playerId ?? null)
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav />
      <h1 className="text-3xl font-semibold">Teams</h1>
      <SeasonHeader season={season} standingsHref={`/season/${seasonId}/standings`} />

      <div className="mt-6">
        {season?.teamConfig?.enabled ? (
          <TeamPanel seasonId={seasonId} playerId={mine} />
        ) : (
          <p className="rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
            Teams are off for this season.
          </p>
        )}
      </div>
    </main>
  );
}
