"use client";

import { useState } from "react";
import AddMember from "@/app/AddMember";
import { usePlayers, useSeasonMembers } from "@/lib/hooks";
import { clearSeasonClaim, removeSeasonMember } from "@/lib/seasons";
import type { PlayerId } from "@/lib/types";

/**
 * Who is in the league this season.
 *
 * The roster is not the grid: someone missing a game night stays here and still
 * appears in standings on zero, because the roster is an *input* to
 * `computeStandings` rather than something written into races they did not run.
 *
 * It is also where a stuck claim gets unstuck. A racer claimed on a phone is
 * unpickable from any other device — that is the point of the claim being
 * shared state — so when the phone that made it is not here, somebody has to be
 * able to hand the racer back. That somebody is the commissioner, here.
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

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(label);
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
      <p className="text-sm text-neutral-400">
        A racer picked on somebody&rsquo;s phone can&rsquo;t be picked on
        another device. Free one here when the phone that took it isn&rsquo;t
        around — a race already running keeps its own claim, which is freed from
        that race&rsquo;s settings.
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
              <span className="min-w-0 flex-1">
                <span className="block truncate">{nameOf(member.playerId)}</span>
                {member.claimedBy && (
                  <span className="block text-xs text-neutral-500">
                    Claimed on a device
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* Only when there is a claim to free: a control that does
                    nothing most of the time trains people to ignore it. Quiet
                    next to Remove, which is the destructive one. */}
                {member.claimedBy && (
                  <button
                    onClick={() =>
                      run(`${nameOf(member.playerId)} is free to pick again`, () =>
                        clearSeasonClaim(seasonId, member.playerId, {
                          source: "manual",
                        }),
                      )
                    }
                    disabled={busy}
                    className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 disabled:opacity-30"
                  >
                    Free racer
                  </button>
                )}
                <button
                  onClick={() =>
                    run(`${nameOf(member.playerId)} left the league`, () =>
                      removeSeasonMember(seasonId, member.playerId, {
                        source: "manual",
                      }),
                    )
                  }
                  disabled={busy}
                  className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 disabled:opacity-30"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <AddMember seasonId={seasonId} />

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </section>
  );
}
