"use client";

import { useLiveState, useNow, useParticipants, usePlayers } from "@/lib/hooks";
import { formatRemaining, readTimer } from "@/lib/timer";
import StaleRace from "@/app/StaleRace";

export default function ScreenView({ raceId }: { raceId: string }) {
  const { live, loading, error } = useLiveState(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const now = useNow();

  const timer = readTimer(live, now);
  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  if (loading) return <Centered>Connecting…</Centered>;
  if (error) return <Centered>Connection error: {error.message}</Centered>;
  if (!live) return <Centered>No live race here yet.</Centered>;
  if (!live.positionOrder || !live.roundOrder) return <StaleRace />;

  // Expiry carries no mechanical consequence — this is pure social pressure.
  const timerColor = timer.isExpired
    ? "text-red-500"
    : timer.remainingMs < 30_000
      ? "text-amber-400"
      : "text-emerald-400";

  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;

  return (
    <main className="flex min-h-screen flex-col justify-between bg-black p-10 text-white">
      <header className="flex items-baseline justify-between text-3xl text-neutral-400">
        <span>Round {live.currentRound}</span>
        {timer.isPaused && (
          <span className="rounded bg-neutral-800 px-4 py-1 text-2xl">PAUSED</span>
        )}
      </header>

      <div className="flex flex-col items-center">
        <p className="text-5xl text-neutral-300">
          {live.currentPlayerId ? nameOf(live.currentPlayerId) : "—"}
        </p>
        <p
          className={`font-mono text-[14rem] leading-none tabular-nums ${timerColor}`}
        >
          {formatRemaining(timer.remainingMs)}
        </p>
      </div>

      <ol className="flex flex-wrap justify-center gap-x-10 gap-y-2 text-3xl text-neutral-400">
        {live.positionOrder.map((id, i) => {
          const roundIdx = live.roundOrder.indexOf(id);
          const alreadyMoved = roundIdx !== -1 && roundIdx < turnIndex;
          const laps = participants.get(id)?.lapsCompleted ?? 0;

          return (
            <li
              key={id}
              className={
                id === live.currentPlayerId
                  ? "text-white"
                  : alreadyMoved
                    ? "text-neutral-600"
                    : undefined
              }
            >
              <span className="text-neutral-600">{i + 1}.</span> {nameOf(id)}
              <span className="ml-2 text-xl text-neutral-600">L{laps}</span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-3xl text-neutral-400">
      {children}
    </main>
  );
}
