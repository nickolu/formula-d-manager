"use client";

import Link from "next/link";

import { Timestamp } from "firebase/firestore";
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
import {
  outOfPlay,
  projectAdvance,
  projectStartRound,
  rewindUnstarts,
  turnKey,
  type TurnProjection,
} from "@/lib/turn";
import type { LiveState } from "@/lib/types";
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

/**
 * A turn change that has been tapped but not yet streamed back.
 *
 * Firestore latency-compensates plain writes but **not transactions**, and
 * every mutation here is one — so the device that taps Next turn is the last
 * one in the room to see it happen. The big screen, a passive listener, gets
 * the push and moves; the tablet that was tapped sits on the old turn with a
 * running clock for the whole round trip, and on house wifi that is long
 * enough to read as a missed tap. Which it then gets: somebody taps again, and
 * because a second advance from a doc that has already moved is a *legal*
 * advance, a car quietly loses its turn.
 *
 * So the tap renders at once, exactly as CarStatusCard holds a tapped peg, and
 * the same release rule applies — the hold is dropped only when keeping it
 * would be wrong. `before`/`after` are turnKeys, which is what makes the three
 * cases separable without waiting on the write: ours landed, or somebody else
 * moved the turn out from under us, or nothing has arrived yet.
 */
interface PendingTurn {
  /** Whose turn it was when the button was tapped. */
  before: string;
  /** Whose turn it should be once the write lands. */
  after: string;
  /** The live-doc fields the projected turn overrides while it is held. */
  state: Pick<
    LiveState,
    | "phase"
    | "currentPlayerId"
    | "currentRound"
    | "roundOrder"
    | "turnStartedAt"
    | "turnDurationMs"
  >;
}

export default function PlayerView({ raceId }: { raceId: string }) {
  const { live: streamed, loading, error } = useLiveState(raceId);
  const { race } = useRace(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "list");

  // Reconciled during render rather than in an effect, exactly as the drag's
  // dropped order is: this is adjusting state because a prop arrived, which
  // React does in place without committing the intermediate pass.
  //
  // Releasing on the write's promise instead would be a flicker — a
  // transaction resolves when the server commits, which is *before* the
  // snapshot carrying that commit arrives, so for one frame the screen would
  // fall back to the turn we just left. So the hold is dropped only when
  // keeping it would be wrong: our turn landed, or somebody else moved the
  // turn out from under us. When the stream merely catches up with what is
  // already on screen, nothing happens at all.
  let held = pending;
  if (
    held &&
    (!streamed ||
      turnKey(streamed) === held.after ||
      turnKey(streamed) !== held.before)
  ) {
    setPending(null);
    held = null;
  }

  const live: LiveState | null =
    held && streamed ? { ...streamed, ...held.state } : streamed;

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

  /**
   * A turn change: projected and shown immediately, then written.
   *
   * No busy flag — dimming the whole screen for the round trip is most of what
   * made a tap feel like it had missed. The primary button disables itself
   * while a change is held instead, which is a fifth of a second and reads as
   * nothing, because the button has already relabelled itself with the turn
   * that is coming.
   *
   * The token passed to the mutation is the turn we were *looking at*, so if
   * another phone got there first this write is a no-op rather than a second
   * advance past a car that never moved.
   */
  async function commitTurn(
    project: (live: LiveState) => TurnProjection | null,
    write: (expect: string) => Promise<boolean>,
  ) {
    if (!live) return;
    setActionError(null);

    const before = turnKey(live);
    let next: TurnProjection | null;
    try {
      next = project(live);
    } catch (e) {
      // projectAdvance throws where advanceTurn throws — an empty round order
      // and friends. Report it and write nothing.
      setActionError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Nowhere for the turn to go: every car has finished or retired, and the
    // write seals the race. There is nothing to project and nothing to hold —
    // what comes back is a different screen entirely, so an optimistic turn
    // would only be a wrong one.
    if (!next) {
      try {
        await write(before);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    setPending({
      before,
      after: turnKey(next),
      state: {
        phase: next.phase,
        currentPlayerId: next.currentPlayerId,
        currentRound: next.currentRound,
        roundOrder: next.roundOrder,
        // The transaction anchors the clock with a server timestamp; the hold
        // has only the local one. Skew is cosmetic for an ambient timer and
        // this lasts a round trip — the streamed anchor replaces it.
        turnStartedAt:
          next.phase === "turn" ? Timestamp.fromMillis(Date.now()) : null,
        turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
      },
    });

    try {
      await write(before);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      // The undo. The streamed turn underneath was never wrong.
      setPending(null);
    }
  }

  if (loading) return <p className="p-8 text-neutral-400">Connecting…</p>;
  if (error) return <p className="p-8 text-red-500">{error.message}</p>;
  // A deleted race leaves every listener with a null snapshot.
  if (!live) return <p className="p-8 text-neutral-400">Race not found.</p>;
  if (!live.positionOrder || !live.roundOrder) return <StaleRace raceId={raceId} />;

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

  // A sealed race is a record, not a game in progress. It used to fall straight
  // through to the live controls below — Next turn, the clock, the reverse gear
  // — all of which happily kept mutating a finished race. Its own screen, for
  // the same reason `scheduled` has one: everything below assumes a race that
  // is actually being played.
  //
  // `lib/race.ts` refuses those mutations too. A screen that merely hides a
  // button is not the same as a rule.
  if (race?.status === "complete") {
    // The sealed result is the record; the live doc's order agrees with it, but
    // an amendment rewrites `result` and this should follow the amendment.
    const order = race.result?.order ?? live.positionOrder;
    const dnf = new Set(race.result?.dnf ?? live.retired ?? []);

    return (
      <main className="flex flex-col gap-6 p-4">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            Final result
          </p>
          <p className="mt-1 text-2xl font-semibold">{race.track}</p>
          <p className="mt-1 text-sm text-neutral-500">
            This race is finished. Nothing here can be changed.
          </p>
        </div>

        <ol className="flex flex-col gap-1">
          {order.map((id, i) => {
            const out = dnf.has(id);
            return (
              <li
                key={id}
                className={`flex items-center gap-3 rounded-2xl border p-3 ${
                  i === 0 && !out
                    ? "border-emerald-800 bg-emerald-950/30"
                    : "border-neutral-800"
                }`}
              >
                <span className="w-6 text-neutral-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-lg">
                  {i === 0 && !out && <span title="Winner">👑 </span>}
                  {nameOf(id)}
                </span>
                <span className="shrink-0 text-sm text-neutral-500">
                  {participants.get(id)?.lapsCompleted ?? 0} laps
                </span>
                {out && (
                  <span className="shrink-0 rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
                    DNF
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {/* Where a finished race actually leads: what it did to the season. */}
        <Link
          href={`/season/${race.seasonId}/standings`}
          className="rounded-2xl border border-neutral-700 py-4 text-center text-lg active:bg-neutral-800"
        >
          Season standings
        </Link>
      </main>
    );
  }

  // Both absent on races created before their features existed.
  const retired = new Set(live.retired ?? []);
  // Cars that have crossed the line. Not retired, and never drawn as if they
  // were — they finished, which is the opposite thing.
  const home = new Set(live.finished ?? []);
  const parked = outOfPlay(live);

  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;
  const nextUp = live.roundOrder
    .slice(turnIndex + 1)
    .find((id) => !parked.has(id));
  // Nowhere for the turn to go: this tap is the last one of the race. The same
  // projection the button writes with, so the label cannot promise a round that
  // is not coming.
  const endsRace = live.roundOrder.length > 0 && projectAdvance(live) === null;

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
  /**
   * Where a failure says so.
   *
   * This used to render at the very bottom of the page, under the standings
   * and the pause button — off-screen on a phone, on the one screen where the
   * question being asked is "did my tap do anything?". A refused turn was
   * indistinguishable from a tap that missed, which is the worst possible
   * answer to that question.
   */
  const problem = actionError && (
    <p
      role="alert"
      className="rounded-2xl border border-red-900 bg-red-950/60 px-4 py-3 text-center text-red-300"
    >
      {actionError}
    </p>
  );

  /*
   * From the first car of round 1 the reverse gear has no earlier turn to go
   * to, so it steps back past the flag drop and returns the race to the grid.
   * The label says so: "back a turn" on a control that un-starts the race is
   * the kind of surprise this view exists to avoid. The condition is
   * `rewindUnstarts` rather than a second copy of the arithmetic here, for the
   * same reason the projected turn is — one function, two callers.
   */
  const backATurn = (
    <div className="-mt-2 flex justify-end">
      <button
        onClick={() => run(() => rewindTurn(raceId, { source: "manual" }))}
        disabled={busy}
        className="px-2 py-1 text-xs uppercase tracking-widest text-neutral-600 underline decoration-neutral-800 underline-offset-4 active:text-neutral-300 disabled:opacity-30"
      >
        {rewindUnstarts(live) ? "↩ back to the grid" : "↩ back a turn"}
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
          const isHome = home.has(id);

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
                    : isHome
                      ? "text-emerald-400"
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
              {/* The flag takes the +lap button's place rather than sitting
                  beside it: a finished car has no lap left to complete, and
                  these rows already overflow a 390px phone. Undoing a
                  mis-tapped last lap is the results view's −, the same place
                  every other mis-tapped lap is undone. */}
              {isHome ? (
                <span
                  title="Finished"
                  className="rounded border border-emerald-800 bg-emerald-950/50 px-2 py-1 text-xs"
                >
                  🏁
                </span>
              ) : (
                <button
                  onClick={() =>
                    run(() => completeLap(raceId, id, { source: "manual" }))
                  }
                  disabled={busy || isOut}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
                >
                  +lap
                </button>
              )}
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
  // between rounds. Discriminate on status, never on the null player — which
  // the `complete` branch above already did, so by here the only remaining
  // reason for nobody to be up is the interstitial.
  const between = live.phase === "betweenRounds";

  if (between) {
    return (
      <main className="flex flex-col gap-4 p-4">
        {problem}

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
          onClick={() =>
            commitTurn(projectStartRound, (expect) =>
              startRound(raceId, { source: "manual" }, expect),
            )
          }
          // Held rather than dimmed: the screen has already moved on, so
          // fading the button would be the only thing suggesting it had not.
          disabled={busy || held !== null}
          className="rounded-3xl bg-emerald-600 py-8 text-3xl font-bold active:bg-emerald-700 disabled:bg-emerald-700"
        >
          Start round {live.currentRound}
        </button>

        {standings}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      {problem}

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
        onClick={() =>
          commitTurn(projectAdvance, (expect) =>
            advanceTurn(raceId, { source: "manual" }, expect),
          )
        }
        // Only while a change is held — a fifth of a second, during which the
        // label already names the turn that is coming. Dimming it is what made
        // the old round trip read as a dead button, so it keeps its colour.
        disabled={busy || held !== null}
        className="rounded-3xl bg-emerald-600 py-10 text-4xl font-bold active:bg-emerald-700 disabled:bg-emerald-700"
      >
        Next turn
        <span className="mt-2 block text-base font-normal opacity-80">
          {endsRace
            ? "ends the race — everyone is home or out"
            : nextUp
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
    </main>
  );
}
