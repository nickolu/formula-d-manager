import type { LiveState } from "./types";

export interface TimerReading {
  remainingMs: number;
  isPaused: boolean;
  isExpired: boolean;
}

/**
 * Pure arithmetic over a shared anchor: no countdown runs anywhere, so nothing
 * can drift and a reconnecting screen is instantly correct. Callers pass nowMs
 * (usually Date.now()) and repaint on an interval; that interval is a repaint
 * loop, not a clock and not a poll.
 */
export function readTimer(
  live: Pick<LiveState, "turnStartedAt" | "turnDurationMs"> | null,
  nowMs: number,
): TimerReading {
  if (!live) {
    return { remainingMs: 0, isPaused: false, isExpired: false };
  }

  // Paused: the anchor is dropped and turnDurationMs holds what was left.
  if (!live.turnStartedAt) {
    return {
      remainingMs: Math.max(0, live.turnDurationMs),
      isPaused: true,
      isExpired: live.turnDurationMs <= 0,
    };
  }

  const deadline = live.turnStartedAt.toMillis() + live.turnDurationMs;
  const remainingMs = Math.max(0, deadline - nowMs);
  return { remainingMs, isPaused: false, isExpired: remainingMs <= 0 };
}

/** Formats to m:ss, which is all a turn timer ever needs. */
export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
