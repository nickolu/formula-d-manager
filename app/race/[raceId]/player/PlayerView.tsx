"use client";

import { useState, useSyncExternalStore } from "react";
import {
  useLiveState,
  useNow,
  useParticipants,
  usePlayers,
  useRace,
} from "@/lib/hooks";
import {
  advanceTurn,
  completeLap,
  pauseTurn,
  resumeTurn,
  rewindTurn,
  setDnf,
  setPositionOrder,
  startRace,
  startRound,
} from "@/lib/race";
import { formatRemaining, readTimer } from "@/lib/timer";
import ReorderableList from "@/app/ReorderableList";
import StaleRace from "@/app/StaleRace";
import TrackView from "./TrackView";

type StandingsMode = "list" | "track";
const MODE_KEY = "formulad:standingsMode";

/**
 * Which rendering the tablet last used, remembered per device.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than an effect: the server snapshot is "list",
 * which is what SSR renders, and the client swaps to the stored value during
 * hydration without a cascading re-render or a mismatch.
 */
let modeListeners: (() => void)[] = [];

function subscribeMode(cb: () => void) {
  modeListeners.push(cb);
  return () => {
    modeListeners = modeListeners.filter((l) => l !== cb);
  };
}

function readMode(): StandingsMode {
  return localStorage.getItem(MODE_KEY) === "track" ? "track" : "list";
}

function writeMode(next: StandingsMode) {
  localStorage.setItem(MODE_KEY, next);
  modeListeners.forEach((l) => l());
}

export default function PlayerView({ raceId }: { raceId: string }) {
  const { live, loading, error } = useLiveState(raceId);
  const { race } = useRace(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "list");

  const timer = readTimer(live, now);
  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  /**
   * For a standings nudge, which the list and the track both render
   * optimistically: no busy flag, so nothing dims for the round-trip after a
   * drop. Reports the failure and rethrows — the drag undoes itself by
   * catching this, and swallowing it would strand the list on an order that
   * was never written.
   */
  async function runReported(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

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
  // A deleted race leaves every listener with a null snapshot.
  if (!live) return <p className="p-8 text-neutral-400">Race not found.</p>;
  if (!live.positionOrder || !live.roundOrder) return <StaleRace />;

  // A scheduled race has a grid and a stopped clock but no turn order yet.
  // Everything below assumes a race in progress, so this is its own screen
  // rather than a pile of conditionals threaded through one.
  if (race?.status === "scheduled") {
    return (
      <main className="flex flex-col gap-6 p-4">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            Starting grid
          </p>
          <p className="mt-1 text-2xl font-semibold">{race.track}</p>
        </div>

        <ol className="flex flex-col gap-1">
          {live.positionOrder.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded border border-neutral-800 p-3"
            >
              <span className="w-5 text-neutral-500">{i + 1}</span>
              <span>{nameOf(id)}</span>
            </li>
          ))}
        </ol>

        <button
          onClick={() => run(() => startRace(raceId, { source: "manual" }))}
          disabled={busy}
          className="rounded-3xl bg-emerald-600 py-10 text-4xl font-bold active:bg-emerald-700 disabled:opacity-50"
        >
          Start race
          <span className="mt-2 block text-base font-normal opacity-80">
            drops the flag and starts the clock
          </span>
        </button>

        <p className="text-center text-sm text-neutral-500">
          The grid can still be changed from race settings.
        </p>

        {actionError && <p className="text-center text-red-500">{actionError}</p>}
      </main>
    );
  }

  // Absent on races created before retirement was modelled.
  const retired = new Set(live.retired ?? []);

  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;
  const nextUp = live.roundOrder
    .slice(turnIndex + 1)
    .find((id) => !retired.has(id));

  // Standings are what the next round will be built from, so this is the list
  // to nudge when someone overtakes.
  function swap(index: number, delta: number) {
    const next = [...live!.positionOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    return run(() => setPositionOrder(raceId, next, { source: "manual" }));
  }

  /**
   * The reverse gear, deliberately kept OUT of the row with the primary
   * button and made quiet.
   *
   * Next turn is tapped a few hundred times a night; this is tapped almost
   * never, and tapping it by mistake un-does a move and stops the clock. Small
   * and adjacent was the wrong trade — anything beside a target that big gets
   * caught by a thumb eventually. It lives at the top of the screen instead,
   * the hardest place to hit by accident one-handed, and looks like a link
   * rather than a control you are meant to reach for.
   */
  const backATurn = (
    <div className="-mt-2 flex justify-end">
      <button
        onClick={() => run(() => rewindTurn(raceId, { source: "manual" }))}
        disabled={busy}
        className="px-2 py-1 text-xs uppercase tracking-widest text-neutral-600 underline decoration-neutral-800 underline-offset-4 active:text-neutral-300 disabled:opacity-30"
      >
        ↩ back a turn
      </button>
    </div>
  );

  // Rendered in both the running-turn view and the between-rounds
  // interstitial — the order is exactly what the table is checking there.
  const standings = (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          Standings — drag to reorder when someone overtakes
        </h2>
        {/* Both modes are the same data and the same mutation; this only
            changes how it is drawn. */}
        <div className="flex shrink-0 overflow-hidden rounded-full border border-neutral-700 text-xs">
          {(["list", "track"] as const).map((m) => (
            <button
              key={m}
              onClick={() => writeMode(m)}
              aria-pressed={mode === m}
              className={`px-3 py-1.5 capitalize ${
                mode === m
                  ? "bg-neutral-700 text-white"
                  : "text-neutral-400"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "track" ? (
        <TrackView
          live={live}
          players={players}
          participants={participants}
          disabled={busy}
          onReorder={(next) =>
            runReported(() =>
              setPositionOrder(raceId, next, { source: "manual" }),
            )
          }
          onCompleteLap={(id) =>
            run(() => completeLap(raceId, id, { source: "manual" }))
          }
          onToggleDnf={(id, dnf) =>
            run(() => setDnf(raceId, id, dnf, { source: "manual" }))
          }
        />
      ) : (
      <ReorderableList
        items={live.positionOrder}
        disabled={busy}
        onReorder={(next) =>
          runReported(() =>
            setPositionOrder(raceId, next, { source: "manual" }),
          )
        }
        renderRow={(id, i) => {
          const roundIdx = live.roundOrder.indexOf(id);
          const alreadyMoved = roundIdx !== -1 && roundIdx < turnIndex;
          const laps = participants.get(id)?.lapsCompleted ?? 0;
          const isOut = retired.has(id);

          return (
            <div
              className={`flex items-center gap-2 rounded border p-2 ${
                id === live.currentPlayerId
                  ? "border-emerald-600 bg-emerald-950/40"
                  : "border-neutral-800"
              }`}
            >
              <span className="w-5 text-neutral-500">{i + 1}</span>
              <span
                className={`flex-1 ${
                  isOut
                    ? "text-neutral-600 line-through"
                    : alreadyMoved
                      ? "text-neutral-500"
                      : ""
                }`}
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
                disabled={busy || isOut}
                className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
              >
                +lap
              </button>
              <button
                onClick={() =>
                  run(() => setDnf(raceId, id, !isOut, { source: "manual" }))
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
            </div>
          );
        }}
      />
      )}
    </section>
  );

  // Nobody's turn means two different things: the race is over, or it is
  // between rounds. Discriminate on status, never on the null player.
  const finished = race?.status === "complete";
  const between = !finished && live.phase === "betweenRounds";

  if (between) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            Round {live.currentRound - 1} done
          </p>
          <p className="mt-1 text-3xl font-semibold">Check the order</p>
          <p className="mt-1 text-sm text-neutral-500">
            Drag anyone who is out of place, then start the round.
          </p>
        </div>

        {backATurn}

        <button
          onClick={() => run(() => startRound(raceId, { source: "manual" }))}
          disabled={busy}
          className="rounded-3xl bg-emerald-600 py-8 text-3xl font-bold active:bg-emerald-700 disabled:opacity-50"
        >
          Start round {live.currentRound}
        </button>

        {standings}

        {actionError && <p className="text-center text-red-500">{actionError}</p>}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex items-baseline justify-between text-neutral-400">
        <span className="text-xl">Round {live.currentRound}</span>
        <span className="font-mono text-2xl tabular-nums">
          {formatRemaining(timer.remainingMs)}
          {timer.isPaused && " (paused)"}
        </span>
      </div>

      {backATurn}

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
          {nextUp
            ? `up next: ${nameOf(nextUp)}`
            : `ends round ${live.currentRound} — next order comes from standings`}
        </span>
      </button>

      {standings}

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
