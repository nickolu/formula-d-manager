"use client";

import { useState } from "react";
import { useLiveState, useNow, useParticipants, usePlayers } from "@/lib/hooks";
import {
  advanceTurn,
  completeLap,
  pauseTurn,
  resumeTurn,
  setPositionOrder,
} from "@/lib/race";
import { formatRemaining, readTimer } from "@/lib/timer";
import StaleRace from "@/app/StaleRace";

export default function TableView({ raceId }: { raceId: string }) {
  const { live, loading, error } = useLiveState(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const timer = readTimer(live, now);
  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-8 text-neutral-400">Connecting…</p>;
  if (error) return <p className="p-8 text-red-500">{error.message}</p>;
  if (!live) return <p className="p-8 text-neutral-400">No live race here yet.</p>;
  if (!live.positionOrder || !live.roundOrder) return <StaleRace />;

  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;
  const roundEndsAfterThis = turnIndex === live.roundOrder.length - 1;

  // Standings are what the next round will be built from, so this is the list
  // to nudge when someone overtakes.
  function swap(index: number, delta: number) {
    const next = [...live!.positionOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    return run(() => setPositionOrder(raceId, next, { source: "manual" }));
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-neutral-950 p-4 text-white">
      <div className="flex items-baseline justify-between text-neutral-400">
        <span className="text-xl">Round {live.currentRound}</span>
        <span className="font-mono text-2xl tabular-nums">
          {formatRemaining(timer.remainingMs)}
          {timer.isPaused && " (paused)"}
        </span>
      </div>

      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          Current turn
        </p>
        <p className="text-4xl font-semibold">
          {live.currentPlayerId ? nameOf(live.currentPlayerId) : "—"}
        </p>
      </div>

      <button
        onClick={() => run(() => advanceTurn(raceId, { source: "manual" }))}
        disabled={busy}
        className="rounded-3xl bg-emerald-600 py-10 text-4xl font-bold active:bg-emerald-700 disabled:opacity-50"
      >
        Next turn
        <span className="mt-2 block text-base font-normal opacity-80">
          {roundEndsAfterThis
            ? `ends round ${live.currentRound} — next order comes from standings`
            : `up next: ${nameOf(live.roundOrder[turnIndex + 1] ?? "—")}`}
        </span>
      </button>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
          Standings — reorder when someone overtakes
        </h2>
        <ol className="flex flex-col gap-1">
          {live.positionOrder.map((id, i) => {
            const roundIdx = live.roundOrder.indexOf(id);
            const alreadyMoved = roundIdx !== -1 && roundIdx < turnIndex;
            const laps = participants.get(id)?.lapsCompleted ?? 0;

            return (
              <li
                key={id}
                className={`flex items-center gap-2 rounded border p-2 ${
                  id === live.currentPlayerId
                    ? "border-emerald-600 bg-emerald-950/40"
                    : "border-neutral-800"
                }`}
              >
                <span className="w-5 text-neutral-500">{i + 1}</span>
                <span
                  className={`flex-1 ${alreadyMoved ? "text-neutral-500" : ""}`}
                >
                  {nameOf(id)}
                </span>
                <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                  lap {laps}
                </span>
                <button
                  onClick={() =>
                    run(() => completeLap(raceId, id, { source: "manual" }))
                  }
                  disabled={busy}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
                >
                  +lap
                </button>
                <button
                  onClick={() => swap(i, -1)}
                  disabled={busy || i === 0}
                  className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => swap(i, 1)}
                  disabled={busy || i === live.positionOrder.length - 1}
                  className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <button
        onClick={() =>
          run(() =>
            timer.isPaused
              ? resumeTurn(raceId, { source: "manual" })
              : pauseTurn(raceId, { source: "manual" }),
          )
        }
        disabled={busy}
        className="rounded-2xl bg-neutral-800 py-4 text-xl active:bg-neutral-700 disabled:opacity-50"
      >
        {timer.isPaused ? "Resume" : "Pause"}
      </button>

      {actionError && <p className="text-center text-red-500">{actionError}</p>}
    </main>
  );
}
