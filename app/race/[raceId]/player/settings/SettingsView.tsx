"use client";

import { useState } from "react";
import { useLiveState, usePlayers, useRace } from "@/lib/hooks";
import { removePlayer, setPositionOrder, updateRaceSettings } from "@/lib/race";
import ReorderableList from "@/app/ReorderableList";
import type { PlayerId } from "@/lib/types";

/**
 * How this race is configured, and — while it is still `scheduled` — who is on
 * the grid.
 *
 * Every change goes through updateRaceSettings / removePlayer in lib/race.ts,
 * which append an event in the same transaction. Nothing here writes a document
 * directly.
 *
 * This is the container items 7, 9 and 11 hang their toggles off.
 */
export default function SettingsView({ raceId }: { raceId: string }) {
  const { race, loading } = useRace(raceId);
  const { live } = useLiveState(raceId);
  const players = usePlayers();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Null until touched, so each field tracks the live document right up to the
  // first keystroke and then pins — the same trick the results view uses, and
  // it keeps an incoming write from yanking a half-typed value away.
  const [track, setTrack] = useState<string | null>(null);
  const [laps, setLaps] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<string | null>(null);

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

  if (loading) return <p className="p-4 text-neutral-400">Connecting…</p>;
  if (!race) return <p className="p-4 text-neutral-400">No race here.</p>;

  const scheduled = race.status === "scheduled";
  const grid = live?.positionOrder ?? [];
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  const trackValue = track ?? race.track;
  const lapsValue = laps ?? String(race.lapCount);
  const secondsValue =
    seconds ??
    String(
      Math.round(
        (live?.turnDurationDefaultMs ?? live?.turnDurationMs ?? 0) / 1000,
      ),
    );

  return (
    <main className="flex flex-col gap-6 p-4">
      <h1 className="text-xs uppercase tracking-widest text-neutral-500">
        Race settings
      </h1>

      <section className="flex flex-col gap-4">
        <Field label="Track">
          <input
            value={trackValue}
            onChange={(e) => setTrack(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-lg"
          />
        </Field>

        <div className="flex gap-4">
          <Field label="Laps">
            <input
              inputMode="numeric"
              value={lapsValue}
              onChange={(e) => setLaps(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-lg"
            />
          </Field>
          <Field label="Turn seconds">
            <input
              inputMode="numeric"
              value={secondsValue}
              onChange={(e) => setSeconds(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-lg"
            />
          </Field>
        </div>

        {/* A new turn length takes effect on the NEXT turn. Resetting the clock
            under whoever is mid-move starts arguments. */}
        <p className="text-xs text-neutral-500">
          A new turn length applies from the next turn — a turn already running
          keeps its clock.
        </p>

        <button
          disabled={busy}
          onClick={() =>
            run("Saved", async () => {
              await updateRaceSettings(
                raceId,
                {
                  track: trackValue,
                  lapCount: Number(lapsValue),
                  turnSeconds: Number(secondsValue),
                },
                { source: "manual" },
              );
              setTrack(null);
              setLaps(null);
              setSeconds(null);
            })
          }
          className="rounded-2xl bg-neutral-800 py-4 text-lg active:bg-neutral-700 disabled:opacity-50"
        >
          Save settings
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
          During the race
        </h2>
        <Toggle
          label="Pause between rounds"
          hint="After every car has moved, stop on nobody's turn so the table can check the order before the next round starts."
          // Absent means off, which is how races predating the toggle behave.
          value={race.settings?.betweenRounds ?? false}
          disabled={busy}
          onChange={(next) =>
            run(next ? "Between-rounds pause on" : "Between-rounds pause off", () =>
              updateRaceSettings(
                raceId,
                { settings: { betweenRounds: next } },
                { source: "manual" },
              ),
            )
          }
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
          Grid
        </h2>

        {scheduled ? (
          <>
            <p className="mb-3 text-sm text-neutral-400">
              Drag to set the starting order, or take a car off the grid. This
              closes when the race starts.
            </p>
            <ReorderableList
              items={grid}
              disabled={busy}
              onReorder={(next) =>
                run("Grid saved", () =>
                  setPositionOrder(raceId, next, { source: "manual" }),
                )
              }
              renderRow={(id, i) => (
                <div className="flex items-center gap-2 rounded border border-neutral-800 p-3">
                  <span className="w-5 text-neutral-500">{i + 1}</span>
                  <span className="flex-1">{nameOf(id)}</span>
                  <button
                    onClick={() =>
                      run(`${nameOf(id)} removed`, () =>
                        removePlayer(raceId, id, { source: "manual" }),
                      )
                    }
                    disabled={busy || grid.length <= 1}
                    className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              )}
            />
          </>
        ) : (
          <>
            {/* Explained, not merely disabled: a control that does nothing with
                no reason given reads as a bug. */}
            <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
              The roster is locked — this race has started. Removing a car now
              would mean rewriting a round already in progress. Retire it on the
              turn-order tab instead; that is reversible and leaves a trail.
            </p>
            <ol className="mt-3 flex flex-col gap-1">
              {grid.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded border border-neutral-800 p-3 text-neutral-400"
                >
                  <span className="w-5 text-neutral-600">{i + 1}</span>
                  <span>{nameOf(id)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {status && <p className="text-center text-sm text-neutral-400">{status}</p>}
    </main>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left disabled:opacity-50 ${
        value ? "border-emerald-800 bg-emerald-950/30" : "border-neutral-800"
      }`}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs ${
          value
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-neutral-700 text-transparent"
        }`}
      >
        ✓
      </span>
      <span>
        <span className="block">{label}</span>
        <span className="mt-1 block text-xs text-neutral-500">{hint}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}
