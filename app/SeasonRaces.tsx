"use client";

import RaceList from "./RaceList";
import SeasonShell from "./SeasonShell";
import { useCurrentSeason } from "@/lib/hooks";

/**
 * The player landing: a list of races, inside the current season.
 *
 * `/` only. `/season/:id` reaches the same list through its own layout, which
 * already knows the id — so this one resolves "current" and that one does not.
 * The shell is shared, which is what keeps the two from drifting.
 */
export default function SeasonRaces() {
  const { season } = useCurrentSeason();

  return (
    <SeasonShell>
      <p className="mt-5 text-neutral-500">Tap your race.</p>
      {season && <RaceList variant="player" seasonId={season.id} />}
    </SeasonShell>
  );
}
