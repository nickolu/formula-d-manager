"use client";

import { useState } from "react";
import { useLiveState, useParticipants, usePlayers } from "@/lib/hooks";
import {
  completeLap,
  finishRace,
  setPositionOrder,
  uncompleteLap,
} from "@/lib/race";
import type { PlayerId } from "@/lib/types";
import StaleRace from "@/app/StaleRace";

/**
 * Correction surface, built before the chatbot on purpose: Phase 3's chatbot
 * emits these same mutations rather than writing documents itself, so anything
 * it gets wrong is fixable here.
 */
export default function EntryView({ raceId }: { raceId: string }) {
  const { live, loading } = useLiveState(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const [dnf, setDnf] = useState<Set<PlayerId>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Null until someone reorders, so the list tracks live state right up to the
  // first edit and then pins — no effect, and an incoming turn change can't
  // yank the rows out from under a half-finished edit.
  const [draft, setDraft] = useState<PlayerId[] | null>(null);
  const order = draft ?? live?.positionOrder ?? [];

  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  function toggleDnf(id: PlayerId) {
    const next = new Set(dnf);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDnf(next);
  }

  async function run(label: string, action: () => Promise<void>, unpin = true) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      if (unpin) setDraft(null);
      setStatus(label);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-8 text-neutral-400">Connecting…</p>;
  if (!live) return <p className="p-8 text-neutral-400">No live race here yet.</p>;
  if (!live.positionOrder) return <StaleRace />;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">
        Manual entry
        <span className="ml-3 text-base font-normal text-neutral-500">
          round {live.currentRound}
        </span>
      </h1>

      <ol className="flex flex-col gap-2">
        {order.map((id, i) => {
          const laps = participants.get(id)?.lapsCompleted ?? 0;
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded border border-neutral-800 p-3"
            >
              <span className="w-5 text-neutral-500">{i + 1}</span>
              <span
                className={`flex-1 ${dnf.has(id) ? "line-through opacity-50" : ""}`}
              >
                {nameOf(id)}
              </span>

              <button
                onClick={() =>
                  run(`Lap removed for ${nameOf(id)}`, () =>
                    uncompleteLap(raceId, id, { source: "manual" }), false)
                }
                disabled={busy || laps === 0}
                className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
              >
                −
              </button>
              <span className="w-14 text-center text-xs text-neutral-400">
                lap {laps}
              </span>
              <button
                onClick={() =>
                  run(`Lap added for ${nameOf(id)}`, () =>
                    completeLap(raceId, id, { source: "manual" }), false)
                }
                disabled={busy}
                className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
              >
                +
              </button>

              <button
                onClick={() => toggleDnf(id)}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400"
              >
                DNF
              </button>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3">
        <button
          disabled={busy}
          onClick={() =>
            run("Standings saved", () =>
              setPositionOrder(raceId, order, { source: "manual" }),
            )
          }
          className="rounded bg-neutral-800 py-3 disabled:opacity-50"
        >
          Save standings
        </button>

        <button
          disabled={busy}
          onClick={() =>
            run("Race finished", () =>
              finishRace(raceId, order, [...dnf], { source: "manual" }),
            )
          }
          className="rounded border border-red-800 py-3 text-red-400 disabled:opacity-50"
        >
          Finish race — locks in this order as the result
        </button>
      </div>

      {status && <p className="text-center text-sm text-neutral-400">{status}</p>}
    </main>
  );
}
