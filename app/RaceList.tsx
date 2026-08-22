"use client";

import Link from "next/link";
import { useRaceList } from "@/lib/hooks";
import type { Race } from "@/lib/types";

/**
 * One component, two renderings — not two components. `useRaceList`, the
 * ordering and the empty state are shared, and two copies would drift.
 *
 *   player  the whole row is one thumb-sized tap target into the player view
 *   admin   the commissioner's rows: status plus per-view links
 */
export type RaceListVariant = "player" | "admin";

export default function RaceList({
  variant = "admin",
  seasonId,
}: {
  variant?: RaceListVariant;
  /** Scopes the listener to one season. Absent lists every race, which is what
   *  the player landing wants: `/` is a list of races, not a season picker. */
  seasonId?: string;
}) {
  const { races, loading } = useRaceList(seasonId);

  if (variant === "admin") {
    if (races.length === 0) return null;
    return (
      <section className="mt-12">
        <h2 className="text-xl font-medium">Races</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {races.map((race) => (
            <AdminRow key={race.id} race={race} />
          ))}
        </ul>
      </section>
    );
  }

  if (loading) {
    return <p className="mt-8 text-neutral-500">Loading races…</p>;
  }

  // A race is "on" until it is sealed — scheduled races belong up here with the
  // live ones, since a player arriving before the flag drops is the normal case.
  const current = races.filter((r) => r.status !== "complete");
  const past = races.filter((r) => r.status === "complete");

  if (races.length === 0) {
    return (
      <p className="mt-8 rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
        No race yet. Once someone starts one it will show up here.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      {current.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {current.map((race) => (
            <PlayerRow key={race.id} race={race} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
          Nothing running right now.
        </p>
      )}

      {past.length > 0 && (
        // <details> rather than useState: collapsed by default, no client
        // state to get out of sync, and it opens with a tap.
        <details className="rounded-2xl border border-neutral-800">
          <summary className="cursor-pointer select-none p-4 text-sm uppercase tracking-widest text-neutral-500">
            Past races ({past.length})
          </summary>
          <ul className="flex flex-col gap-2 p-3 pt-0">
            {past.map((race) => (
              <PlayerRow key={race.id} race={race} muted />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Deliberately no auto-redirect when exactly one race is live: it would save a
 * tap but make the site root behave differently week to week, and it would
 * strand anyone trying to reach a finished race. The live race is just the
 * obvious target instead.
 */
function PlayerRow({ race, muted = false }: { race: Race; muted?: boolean }) {
  return (
    <li>
      <Link
        href={`/race/${race.id}/player`}
        className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border p-4 text-lg active:bg-neutral-800 ${
          muted
            ? "border-neutral-800 text-neutral-400"
            : "border-emerald-800 bg-emerald-950/30"
        }`}
      >
        <span className="font-medium">{race.track}</span>
        <span className="shrink-0 text-sm text-neutral-500">
          {race.status === "complete" ? "finished" : race.status}
        </span>
      </Link>
    </li>
  );
}

function AdminRow({ race }: { race: Race }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-neutral-800 p-3">
      <span>
        {race.track}
        <span className="ml-2 text-sm text-neutral-500">{race.status}</span>
      </span>
      <span className="flex gap-4 text-sm">
        <Link href={`/race/${race.id}/player`} className="text-emerald-500">
          player
        </Link>
        <Link href={`/race/${race.id}/screen`} className="text-emerald-500">
          screen
        </Link>
        <Link href={`/race/${race.id}/results`} className="text-emerald-500">
          results
        </Link>
        <Link href={`/race/${race.id}/settings`} className="text-emerald-500">
          settings
        </Link>
      </span>
    </li>
  );
}
