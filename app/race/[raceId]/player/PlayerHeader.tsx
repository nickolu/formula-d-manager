"use client";

import Link from "next/link";
import { useRace } from "@/lib/hooks";

/**
 * Which race this is, and the way out of it.
 *
 * A player lands cold, from a list of races, on a phone — so the view has to
 * say which one they tapped, and it has to be possible to have tapped the
 * wrong one. The paradigm that the player view is self-sufficient is about
 * never sending someone elsewhere to *do* something; leaving is not doing
 * something, and a screen with no exit is a trap.
 *
 * Not app/Nav.tsx, which stays opt-in: nav chrome would put standings and
 * admin links in front of a player mid-game. This is one row — back, track,
 * laps — and nothing else.
 */
export default function PlayerHeader({ raceId }: { raceId: string }) {
  const { race } = useRace(raceId);

  return (
    <header className="flex items-center gap-2 border-b border-neutral-900 px-2 py-2">
      <Link
        href="/"
        aria-label="Back to all races"
        className="shrink-0 px-3 py-2 text-sm text-neutral-500 active:text-white"
      >
        ‹ Races
      </Link>

      <div className="min-w-0 flex-1 text-right">
        <p className="truncate text-sm font-medium">{race?.track ?? "…"}</p>
        {race && (
          <p className="text-xs text-neutral-500">
            {race.lapCount} {race.lapCount === 1 ? "lap" : "laps"}
            {/* "live" is the normal case and would be noise; the other two
                change what the screen below means. */}
            {race.status !== "live" &&
              ` · ${race.status === "complete" ? "finished" : race.status}`}
          </p>
        )}
      </div>
    </header>
  );
}
