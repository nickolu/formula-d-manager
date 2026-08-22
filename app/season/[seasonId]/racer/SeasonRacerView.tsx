"use client";

import { useState } from "react";
import TeamPanel from "@/app/TeamPanel";
import { assignCars, readableInk } from "@/lib/cars";
import {
  usePlayers,
  useSeasonMembers,
  useStandings,
  useUid,
} from "@/lib/hooks";
import {
  addSeasonMember,
  claimSeasonRacer,
  releaseSeasonRacer,
} from "@/lib/seasons";
import type { PlayerId } from "@/lib/types";

/**
 * Who you are, for the whole season.
 *
 * The claim moved to the season in item 15 — `createRace` and `joinRace` seed
 * `participants/{id}.claimedBy` from it — but the only screen that could make
 * one was inside a race, so a player still had to open a race to say which
 * racer was theirs. That was backwards: the race-level claim is a *derived,
 * re-tappable* override, not the place identity is established.
 *
 * So: claim here, once, and every race the season creates afterwards already
 * knows you. The in-race screen still wins in a race, and still re-tappable —
 * a borrowed tablet is one tap to fix — which is exactly what a default should
 * be.
 *
 * "My racer" is still never stored. It is the member whose `claimedBy` matches
 * this device's uid, derived the same way it is in a race.
 */
export default function SeasonRacerView({ seasonId }: { seasonId: string }) {
  const uid = useUid();
  const { members, loading } = useSeasonMembers(seasonId);
  const { standings } = useStandings(seasonId);
  const players = usePlayers();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");

  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;
  const roster = [...members]
    .map((m) => m.playerId)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  // Car identity is derived from the ids, exactly as it is in a race, so a
  // driver looks the same colour here as they do on the track view.
  const cars = assignCars(roster, players);
  const mine = uid
    ? (members.find((m) => m.claimedBy === uid)?.playerId ?? null)
    : null;
  const row = mine ? standings.find((r) => r.playerId === mine) : undefined;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="mt-8 text-neutral-500">Loading…</p>;

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        {mine ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-neutral-800 p-4">
              {cars.get(mine) && (
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold"
                  style={{
                    background: cars.get(mine)!.colour,
                    color: readableInk(cars.get(mine)!.colour),
                  }}
                >
                  {cars.get(mine)!.label}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xl font-semibold">
                  {nameOf(mine)}
                </span>
                <span className="block text-sm text-neutral-500">
                  {row
                    ? `${row.points} ${row.points === 1 ? "point" : "points"} · ${row.races} ${
                        row.races === 1 ? "race" : "races"
                      }${row.wins > 0 ? ` · ${row.wins} won` : ""}`
                    : "No races yet"}
                </span>
              </span>
            </div>

            <button
              onClick={() =>
                run(() =>
                  releaseSeasonRacer(seasonId, mine, uid!, { source: "manual" }),
                )
              }
              disabled={busy}
              className="rounded-2xl border border-neutral-700 py-4 text-lg active:bg-neutral-800 disabled:opacity-50"
            >
              Change racer
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-400">
              Which racer is yours? Pick once and every race this season will
              already know — you won&rsquo;t have to do it again at the table.
            </p>

            <ul className="flex flex-col gap-2">
              {roster.map((id) => {
                const car = cars.get(id);
                const taken = members.some(
                  (m) => m.playerId === id && m.claimedBy,
                );
                return (
                  <li key={id}>
                    {/* Claimed racers stay visible but unselectable. Hiding
                        them makes a player think their friend is missing. */}
                    <button
                      onClick={() =>
                        run(() =>
                          claimSeasonRacer(seasonId, id, uid!, null, {
                            source: "manual",
                          }),
                        )
                      }
                      disabled={busy || taken || !uid}
                      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left ${
                        taken
                          ? "border-neutral-900 text-neutral-600"
                          : "border-neutral-800 active:bg-neutral-800"
                      }`}
                    >
                      {car && (
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                          style={{
                            background: car.colour,
                            color: readableInk(car.colour),
                            opacity: taken ? 0.35 : 1,
                          }}
                        >
                          {car.label}
                        </span>
                      )}
                      <span className="flex-1 text-lg">{nameOf(id)}</span>
                      {taken && (
                        <span className="shrink-0 text-xs uppercase tracking-wide">
                          taken
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Alongside the list, and in place of it when the league is empty
                — a list with no way to act is a dead end, and for a new player
                this is the first screen that means anything. */}
            <div className="flex flex-col gap-2 rounded-2xl border border-neutral-800 p-4">
              {roster.length === 0 && (
                <p className="text-sm text-neutral-400">
                  Nobody in the league yet. Put your name in.
                </p>
              )}
              <input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-lg"
              />
              <button
                onClick={() =>
                  run(async () => {
                    // Joining the league and claiming yourself are one act
                    // here: nobody types their own name in to then watch
                    // somebody else take it.
                    const id = await addSeasonMember(seasonId, joinName, {
                      source: "manual",
                    });
                    setJoinName("");
                    if (uid) {
                      await claimSeasonRacer(seasonId, id, uid, null, {
                        source: "manual",
                      });
                    }
                  })
                }
                disabled={busy || !joinName.trim()}
                className="rounded-2xl bg-emerald-600 py-4 text-lg font-semibold active:bg-emerald-700 disabled:opacity-40"
              >
                Join the league
              </button>
            </div>
          </>
        )}

        {error && <p className="text-center text-red-500">{error}</p>}
      </section>

      {/* Below the racer, not in a tab of its own: the panel has to know who
          you are, and that is the claim above. */}
      <TeamPanel seasonId={seasonId} playerId={mine} />
    </div>
  );
}
