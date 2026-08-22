"use client";

import Link from "next/link";
import { usePlayers, useRaceList } from "@/lib/hooks";
import type { PlayerId, Race, RaceStatus } from "@/lib/types";

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
    if (loading) return <p className="text-neutral-500">Loading races…</p>;
    if (races.length === 0) {
      return (
        <p className="rounded border border-neutral-800 p-4 text-sm text-neutral-400">
          No races in this season yet.
        </p>
      );
    }
    return <AdminRows races={races} />;
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
        <span className="min-w-0">
          <span className="block truncate font-medium">{race.track}</span>
          {race.location && (
            <span className="block truncate text-sm text-neutral-500">
              {race.location}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm text-neutral-500">
          {race.status === "complete" ? "finished" : race.status}
        </span>
      </Link>
    </li>
  );
}

/**
 * The commissioner's rows.
 *
 * A sub-component so `usePlayers` is called once, here, rather than in every
 * row or in RaceList itself — the player landing renders the other variant and
 * has no use for a players listener.
 */
function AdminRows({ races }: { races: Race[] }) {
  const players = usePlayers();
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  return (
    <ul className="flex flex-col gap-2">
      {races.map((race) => (
        <AdminRow key={race.id} race={race} nameOf={nameOf} />
      ))}
    </ul>
  );
}

/**
 * What a race document already carries, and nothing more.
 *
 * Deliberately no round number or whose-turn-it-is: those live in the live doc,
 * and showing them would mean a listener per race on a page that currently
 * opens one. Date, laps, the winner and the retirement count all come off the
 * race document the list is already streaming — `result` is the finishing-order
 * cache finishRace writes, so the winner costs nothing.
 */
function AdminRow({
  race,
  nameOf,
}: {
  race: Race;
  nameOf: (id: PlayerId) => string;
}) {
  // Null until the server acknowledges a just-created race: scheduledAt is a
  // serverTimestamp and the persistent cache surfaces the write first.
  const when = race.scheduledAt?.toDate?.();
  const facts = [
    when ? formatDate(when) : null,
    race.location ? `at ${race.location}` : null,
    `${race.lapCount} ${race.lapCount === 1 ? "lap" : "laps"}`,
    race.result?.order[0] ? `won by ${nameOf(race.result.order[0])}` : null,
    race.result?.dnf.length
      ? `${race.result.dnf.length} retired`
      : null,
    // A race the app never timed. Worth saying, because its history is two
    // events long and its lap counts are all zero by construction.
    race.backfilled ? "entered afterwards" : null,
  ].filter(Boolean);

  return (
    <li className="rounded border border-neutral-800 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateBadge status={race.status} />
        <span className="min-w-0 flex-1 truncate font-medium">{race.track}</span>
      </div>

      <p className="mt-1 text-sm text-neutral-500">{facts.join(" · ")}</p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/race/${race.id}/player`} className="text-emerald-500">
          player
        </Link>
        <Link href={`/race/${race.id}/screen`} className="text-emerald-500">
          screen
        </Link>
        <Link href={`/race/${race.id}/results`} className="text-emerald-500">
          {race.status === "complete" ? "edit result" : "results"}
        </Link>
        <Link href={`/race/${race.id}/settings`} className="text-emerald-500">
          settings
        </Link>
      </div>
    </li>
  );
}

/**
 * The three states, said in words rather than only in colour — a badge that
 * relies on hue alone is unreadable to anyone who cannot rely on hue.
 */
function StateBadge({ status }: { status: RaceStatus }) {
  const style =
    status === "live"
      ? "border-emerald-700 bg-emerald-950/50 text-emerald-300"
      : status === "scheduled"
        ? "border-amber-800 bg-amber-950/30 text-amber-300"
        : "border-neutral-800 text-neutral-500";

  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${style}`}
    >
      {status === "complete" ? "finished" : status}
    </span>
  );
}

/** Year only when it is not this one — on a league page it is usually noise. */
function formatDate(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
