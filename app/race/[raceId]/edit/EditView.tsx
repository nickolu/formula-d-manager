"use client";

import { useState } from "react";
import { useLiveState, useParticipants, usePlayers } from "@/lib/hooks";
import {
  completeLap,
  finishRace,
  setDnf,
  setPositionOrder,
  uncompleteLap,
} from "@/lib/race";
import type { PlayerId } from "@/lib/types";
import Nav from "@/app/Nav";
import ReorderableList from "@/app/ReorderableList";
import StaleRace from "@/app/StaleRace";

/**
 * Correction surface, built before the chatbot on purpose: Phase 3's chatbot
 * emits these same mutations rather than writing documents itself, so anything
 * it gets wrong is fixable here.
 */
export default function EditView({ raceId }: { raceId: string }) {
  const { live, loading } = useLiveState(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Null until someone reorders, so the list tracks live state right up to the
  // first edit and then pins — no effect, and an incoming turn change can't
  // yank the rows out from under a half-finished edit.
  const [draft, setDraft] = useState<PlayerId[] | null>(null);
  const order = draft ?? live?.positionOrder ?? [];

  // Retirement is live state now, not a local checkbox: the device view and
  // this one read the same list and cannot disagree about who is out.
  const retired = new Set(live?.retired ?? []);

  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
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
      <Nav raceId={raceId} />

      <div>
        <h1 className="text-2xl font-semibold">
          Edit race
          <span className="ml-3 text-base font-normal text-neutral-500">
            round {live.currentRound}
          </span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {order.length} {order.length === 1 ? "player" : "players"}
          {retired.size > 0 && ` · ${retired.size} retired`}
        </p>
      </div>

      <ReorderableList
        items={order}
        disabled={busy}
        onReorder={setDraft}
        renderRow={(id, i) => {
          const laps = participants.get(id)?.lapsCompleted ?? 0;
          const isOut = retired.has(id);

          return (
            <div className="flex items-center gap-2 rounded border border-neutral-800 p-3">
              <span className="w-5 text-neutral-500">{i + 1}</span>
              <span
                className={`flex-1 ${isOut ? "line-through opacity-50" : ""}`}
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
                onClick={() =>
                  run(
                    isOut ? `${nameOf(id)} is back in` : `${nameOf(id)} retired`,
                    () => setDnf(raceId, id, !isOut, { source: "manual" }),
                    false,
                  )
                }
                disabled={busy}
                className={`rounded border px-2 py-1 text-xs disabled:opacity-30 ${
                  isOut
                    ? "border-red-800 bg-red-950/50 text-red-400"
                    : "border-neutral-700 text-neutral-400"
                }`}
              >
                DNF
              </button>
              <button
                onClick={() => move(i, -1)}
                disabled={busy || i === 0}
                className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={busy || i === order.length - 1}
                className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          );
        }}
      />

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
              finishRace(raceId, order, [...retired], { source: "manual" }),
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
