"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSeasons } from "@/lib/hooks";
import type { Season } from "@/lib/types";

/**
 * Which season you are looking at, and a way to change it.
 *
 * **A control on the page, not a door in front of it.** `/` stays a list of
 * races — the root is the one URL anyone has to know and it must not behave
 * differently week to week, which is the same reasoning that already forbids
 * auto-redirecting to a single live race. A picker page would make the root a
 * different page at every season rollover and add a tap to every game night for
 * a league that has one active season.
 *
 * Archived seasons drop out of the switcher but keep their standings: a link
 * or a bookmark to `/season/:id` still works.
 */
export default function SeasonHeader({
  season,
  standingsHref,
  teamsHref,
}: {
  season: Season | null;
  /** Where "standings" goes. Absent hides the link — an unknown season has none. */
  standingsHref?: string;
  /** Where "teams" goes. Hidden when the season has teams off. */
  teamsHref?: string;
}) {
  const { seasons } = useSeasons();
  const router = useRouter();

  const choices = seasons.filter((s) => !s.archived || s.id === season?.id);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {choices.length > 1 ? (
        // A native select, so it is one tap and the phone renders its own
        // picker — a custom menu here would be a worse version of that.
        <select
          value={season?.id ?? ""}
          onChange={(e) => router.push(`/season/${e.target.value}`)}
          aria-label="Season"
          className="rounded border border-neutral-800 bg-transparent py-1 pl-1 pr-2 text-neutral-400"
        >
          {choices.map((s) => (
            <option key={s.id} value={s.id} className="bg-neutral-950">
              {s.name}
              {s.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-neutral-500">{season?.name ?? "No season yet"}</span>
      )}

      {standingsHref && (
        <Link href={standingsHref} className="text-sm text-emerald-500">
          standings
        </Link>
      )}

      {/* Only when there is something behind it — a link to a page that says
          "teams are off" is worse than no link. */}
      {teamsHref && season?.teamConfig?.enabled && (
        <Link href={teamsHref} className="text-sm text-emerald-500">
          teams
        </Link>
      )}
    </div>
  );
}
