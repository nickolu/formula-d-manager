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

/**
 * `scheduled` is a real state, not a placeholder: createRace leaves the race
 * unstarted with its clock stopped, and an explicit startRace drops the flag.
 * That window is when the roster can be edited — and it is what makes joining
 * a race before it begins coherent.
 */
export type RaceStatus = "scheduled" | "live" | "complete";

/**
 * Per-race feature toggles. Optional, and absent means off, so races created
 * before a toggle existed keep working untouched.
 */
export interface RaceSettings {
  /** Stop on nobody's turn between rounds so the table can confirm order. */
  betweenRounds?: boolean;
  /** Show the per-car status counter. */
  carStatus?: boolean;
}

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
  /** Absent on races created before toggles existed; absent means off. */
  settings?: RaceSettings;
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
  /**
   * Free text about this car's race — usually why it didn't finish.
   *
   * Deliberately NOT a DNF-only reason field: "blew the engine on lap 3" and
   * "won it on the last corner" are the same shape of data, so one note avoids
   * a second schema later. It also survives un-retiring, where a reason tied to
   * the flag would either be orphaned or silently destroyed.
   *
   * Not on RaceResult: that is a scoring cache, and notes are not scoring
   * input — computeStandings stays a pure function of finishes.
   */
  note?: string;
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
   * Which half of the loop the race is in. Absent means "turn", so races that
   * predate the between-rounds interstitial behave exactly as they did.
   *
   * "betweenRounds" is nobody's turn on purpose: every car has moved, the next
   * round's order has been snapshotted, and the table is looking at it before
   * the clock starts again.
   */
  phase?: "turn" | "betweenRounds";
  /**
   * Mirror of races/{id}.settings.betweenRounds, kept here so advanceTurn can
   * read the toggle from the document it already has. Same denormalization
   * bargain as `retired` below: the race doc stays the place it is edited,
   * updateRaceSettings writes both in one transaction, and the hot path keeps
   * costing one read.
   */
  betweenRounds?: boolean;
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
  /**
   * NULL until the server acknowledges the write. `at` is a serverTimestamp and
   * the persistent local cache surfaces the write immediately, so every event
   * this device appends renders once with no timestamp. Typed nullable so a
   * reader that forgets fails the typecheck rather than at the table.
   */
  at: Timestamp | null;
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

/**
 * Emitted when a round actually begins — the clock starts and the leader is up.
 * With the between-rounds interstitial on, that is a separate moment from the
 * previous round ending, which is why roundEnded exists.
 */
export interface RoundStartedEvent extends BaseEvent {
  type: "roundStarted";
  round: number;
  order: PlayerId[];
}

/**
 * Every car has moved and the race has stopped on nobody's turn so the table
 * can confirm the order. Only ever emitted when the interstitial is on —
 * without it, a round ends and the next begins in the same instant.
 */
export interface RoundEndedEvent extends BaseEvent {
  type: "roundEnded";
  /** The round that just finished. */
  round: number;
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

/** The flag drops: the race leaves `scheduled` and the clock is anchored. */
export interface RaceStartedEvent extends BaseEvent {
  type: "raceStarted";
  /** The grid as it stood at the start, after any roster edits. */
  order: PlayerId[];
}

/**
 * A change to how the race is configured. Carries only the fields that
 * actually changed, so the log reads as a diff rather than a snapshot.
 */
export interface RaceSettingsChangedEvent extends BaseEvent {
  type: "raceSettingsChanged";
  patch: {
    track?: string;
    lapCount?: number;
    turnSeconds?: number;
    settings?: RaceSettings;
  };
}

/**
 * A car taken off the grid before the start. Only possible while `scheduled` —
 * unpicking a player from a race in progress means rewriting three ordered
 * lists and possibly the current turn, which is why it is locked rather than
 * merely discouraged.
 */
export interface PlayerRemovedEvent extends BaseEvent {
  type: "playerRemoved";
  playerId: PlayerId;
}

/** Commentary on one car's race. An empty note is a clearing, and is logged. */
export interface ParticipantNoteSetEvent extends BaseEvent {
  type: "participantNoteSet";
  playerId: PlayerId;
  note: string;
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
  | RaceStartedEvent
  | RaceSettingsChangedEvent
  | PlayerRemovedEvent
  | TurnAdvancedEvent
  | RoundStartedEvent
  | RoundEndedEvent
  | PositionOrderChangedEvent
  | LapCompletedEvent
  | DnfChangedEvent
  | ParticipantNoteSetEvent
  | TurnRewoundEvent
  | TurnPausedEvent
  | TurnResumedEvent
  | RaceFinishedEvent
  | CorrectionEvent;
