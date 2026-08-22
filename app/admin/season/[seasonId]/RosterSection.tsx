"use client";

import { useState } from "react";
import AddMember from "@/app/AddMember";
import { usePlayers, useSeasonMembers } from "@/lib/hooks";
import { removeSeasonMember } from "@/lib/seasons";
import type { PlayerId } from "@/lib/types";

/**
 * Who is in the league this season.
 *
 * The roster is not the grid: someone missing a game night stays here and still
 * appears in standings on zero, because the roster is an *input* to
 * `computeStandings` rather than something written into races they did not run.
 */
export default function RosterSection({ seasonId }: { seasonId: string }) {
  const { members, loading } = useSeasonMembers(seasonId);
  const players = usePlayers();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;
  const sorted = [...members].sort((a, b) =>
    nameOf(a.playerId).localeCompare(nameOf(b.playerId)),
  );

  async function remove(playerId: PlayerId) {
    setBusy(true);
    setStatus(null);
    try {
      await removeSeasonMember(seasonId, playerId, { source: "manual" });
      setStatus(`${nameOf(playerId)} left the league`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">
        Adding someone puts them in every race here that has not finished yet.
        Finished races are never touched — a player who joined late shows up in
        the standings on zero instead.
      </p>

      {loading ? (
        <p className="text-neutral-500">Loading the roster…</p>
      ) : sorted.length === 0 ? (
        <p className="rounded border border-neutral-800 p-4 text-sm text-neutral-400">
          Nobody yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((member) => (
            <li
              key={member.playerId}
              className="flex items-center justify-between gap-3 rounded border border-neutral-800 p-3"
            >
              <span className="min-w-0 truncate">{nameOf(member.playerId)}</span>
              <button
                onClick={() => remove(member.playerId)}
                disabled={busy}
                className="shrink-0 rounded border border-red-900 px-3 py-1 text-xs text-red-400 disabled:opacity-30"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddMember seasonId={seasonId} />

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </section>
  );
}
