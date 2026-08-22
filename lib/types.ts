import type { Timestamp } from "firebase/firestore";

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  displayName: string;
  active: boolean;
}

/**
 * Season scoring lives in Firestore rather than in code because house scoring
 * rules churn between seasons and shouldn't require a deploy to argue about.
 */
export interface ScoringConfig {
  /** Points by finishing position; index 0 is first place. */
  positionPoints: number[];
  /** Awarded to anyone finishing past the end of positionPoints. */
  pointsBeyondTable: number;
  dnfPoints: number;
}

export interface Season {
  id: string;
  name: string;
  scoringConfig: ScoringConfig;
  startDate: Timestamp;
}

export type RaceStatus = "scheduled" | "live" | "complete";

/**
 * The finishing order, denormalized onto the race document by finishRace in the
 * same transaction that appends the raceFinished event.
 *
 * This is a cache of the log, exactly like the live doc: it makes season
 * standings a pure function over the races listener — no per-race participant
 * fan-out and no collectionGroup index — and it stays recoverable because the
 * raceFinished event remains the record of truth.
 */
export interface RaceResult {
  /** Finishing order, winner first. Retired cars are included AND listed in dnf. */
  order: PlayerId[];
  dnf: PlayerId[];
}

export interface Race {
  id: string;
  seasonId: string;
  track: string;
  scheduledAt: Timestamp;
  status: RaceStatus;
  /** Laps required to finish. Each lap spans many rounds. */
  lapCount: number;
  /** Present only once the race is complete. Absent on live/scheduled races. */
  result?: RaceResult;
}

/**
 * One row of derived season standings. Never stored — computeStandings rebuilds
 * it from finished races on every render, so it cannot drift from its inputs.
 */
export interface SeasonStanding {
  playerId: PlayerId;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  dnfs: number;
  /** Best classified finish; null if the driver has never seen the flag. */
  bestFinish: number | null;
  /** Count of finishes by position, index 0 = wins. Used for tie countback. */
  finishCounts: number[];
}

export interface Participant {
  playerId: PlayerId;
  startPosition: number;
  /** Laps this car has completed. Cars cross the line at different rounds. */
  lapsCompleted: number;
  finalPosition: number | null;
  dnf: boolean;
}

/**
 * The single hot document every screen subscribes to. Everything here is
 * derivable by replaying the event log, so a corrupted live doc is recoverable.
 *
 * The timer is state, not a process: clients derive remaining time from
 * turnStartedAt + turnDurationMs. A null turnStartedAt means paused, with
 * turnDurationMs holding whatever time was left at the moment of the pause.
 *
 * Turn order is NOT a fixed player rotation. Formula D plays in track-position
 * order, leader first, re-derived each round — hence two separate lists:
 *
 *   positionOrder  live standings, nudged whenever an overtake happens
 *   roundOrder     snapshot taken when the round began, frozen until it ends
 *
 * Keeping them separate is what makes a mid-round overtake affect the NEXT
 * round rather than reshuffling a round already in progress.
 */
export interface LiveState {
  currentPlayerId: PlayerId | null;
  turnStartedAt: Timestamp | null;
  turnDurationMs: number;
  /**
   * The race's configured turn length. Distinct from turnDurationMs, which
   * pauseTurn overwrites with whatever time was left — so without this there
   * is no record of what a full turn is, and nothing to reset the clock to.
   *
   * Optional: races created before the field existed simply lack it, and every
   * reader falls back to turnDurationMs. There are no migrations here.
   */
  turnDurationDefaultMs?: number;
  /** One round = every car has moved once. Many rounds make a lap. */
  currentRound: number;
  positionOrder: PlayerId[];
  roundOrder: PlayerId[];
  /**
   * Cars that have retired. Mirrored onto participants/{id}.dnf, but kept here
   * too so advanceTurn can skip them from a single document read rather than
   * fanning out over participants — and so every open listener gets the state
   * for free. Same denormalization bargain as `result` on the race doc.
   *
   * Optional: races created before retirement was modelled simply lack it.
   */
  retired?: PlayerId[];
  /**
   * The outgoing roundOrder, saved at each rollover. Rollover overwrites
   * roundOrder with a fresh snapshot of positionOrder, which would otherwise
   * make the first turn of a round impossible to step back from. One round of
   * history is all rewindTurn keeps.
   */
  previousRoundOrder?: PlayerId[] | null;
  updatedAt: Timestamp;
}

export type EventSource = "manual" | "chat" | "system";

interface BaseEvent {
  id: string;
  at: Timestamp;
  /** Chat-sourced entries are the ones most likely to be wrong; keep them labelled. */
  source: EventSource;
  actor: string | null;
}

/** Seeds the log so the opening live state is reconstructable by replay. */
export interface RaceCreatedEvent extends BaseEvent {
  type: "raceCreated";
  track: string;
  lapCount: number;
  order: PlayerId[];
  turnDurationMs: number;
}

export interface TurnAdvancedEvent extends BaseEvent {
  type: "turnAdvanced";
  fromPlayerId: PlayerId | null;
  toPlayerId: PlayerId;
  round: number;
}

/** Emitted when the order wraps and a fresh snapshot of standings is taken. */
export interface RoundStartedEvent extends BaseEvent {
  type: "roundStarted";
  round: number;
  order: PlayerId[];
}

/** An overtake: standings changed, taking effect from the next round. */
export interface PositionOrderChangedEvent extends BaseEvent {
  type: "positionOrderChanged";
  order: PlayerId[];
}

export interface LapCompletedEvent extends BaseEvent {
  type: "lapCompleted";
  playerId: PlayerId;
  /** Which lap this car just finished. */
  lap: number;
  round: number;
}

/**
 * A car retired, or a retirement was reverted. Retirement is live race state,
 * not just a finishing attribute: a car that breaks on lap 1 stops taking turns
 * immediately.
 */
export interface DnfChangedEvent extends BaseEvent {
  type: "dnfChanged";
  playerId: PlayerId;
  dnf: boolean;
}

/** A mis-tapped turn, stepped back. Appended like any other mutation. */
export interface TurnRewoundEvent extends BaseEvent {
  type: "turnRewound";
  fromPlayerId: PlayerId | null;
  toPlayerId: PlayerId;
  round: number;
}

export interface TurnPausedEvent extends BaseEvent {
  type: "turnPaused";
  remainingMs: number;
}

export interface TurnResumedEvent extends BaseEvent {
  type: "turnResumed";
}

export interface RaceFinishedEvent extends BaseEvent {
  type: "raceFinished";
  order: PlayerId[];
  dnf: PlayerId[];
}

/**
 * Corrections append rather than mutate, so the audit trail survives and a bad
 * transcription is one undo instead of a corrupted race.
 */
export interface CorrectionEvent extends BaseEvent {
  type: "correction";
  targetEventId: string;
  note: string;
}

export type RaceEvent =
  | RaceCreatedEvent
  | TurnAdvancedEvent
  | RoundStartedEvent
  | PositionOrderChangedEvent
  | LapCompletedEvent
  | DnfChangedEvent
  | TurnRewoundEvent
  | TurnPausedEvent
  | TurnResumedEvent
  | RaceFinishedEvent
  | CorrectionEvent;
