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
}

/**
 * There is deliberately no `dnfPoints`. A retirement scores its placing like
 * anyone else's — the finishing order already encodes who broke and when, so
 * the first car out is placed last, the next above it, and so on. A separate
 * DNF value would score that same fact a second time and let a flag override a
 * placing. Seasons written before this carry a stray `dnfPoints` in Firestore;
 * nothing reads it, and there is no migration, as usual.
 */

/** One colour a team can wear. Keys are stable ids, never reused for a different colour. */
export interface TeamColor {
  key: string;
  label: string;
  hex: string;
}

/**
 * Teams, configured per season in Firestore rather than in code — the same
 * precedent as `scoringConfig` and the car status spec. Absent means teams are
 * off, so a season created before teams existed is untouched.
 */
export interface TeamConfig {
  enabled: boolean;
  /**
   * Racers per team. The house rule is that every team is exactly this size,
   * but **nothing enforces it** — that is a season-wide invariant and a
   * transaction cannot check it without a query. It is surfaced in the UI
   * instead. Configurable because 2 today does not mean 2 forever.
   */
  teamSize: number;
  /**
   * Whether players may create, rename, recolour, join and leave. Not security
   * — there is no auth to enforce it with. What `lib/` does enforce is the soft
   * check that actually works at a table: a player may edit the team they are
   * on. Do not mistake this for a permission.
   */
  playerManaged: boolean;
  /** Config, not code: house palettes churn. Seeded from DEFAULT_TEAM_PALETTE. */
  palette: TeamColor[];
  /**
   * How member points make a team score. Kept even though with equal full teams
   * `average` is `sum ÷ teamSize` — a monotone transform with an identical
   * ranking. One field and one branch, and the only case where it matters is
   * the one the house rule forbids and someone will eventually allow.
   */
  scoring?: "sum" | "average";
}

/**
 * A constructor, for one season.
 *
 * `members` is the **capacity authority**: "is there an open slot" is
 * `members.length < teamSize`, answerable from one document read. The matching
 * `SeasonMember.teamId` is the **exclusivity authority**. Both are written in
 * the same transaction — the web SDK cannot query a collection inside one, so
 * each cross-document invariant has to live in a document the transaction can
 * read. Same bargain as `retired` on the live doc.
 */
export interface Team {
  id: string;
  name: string;
  colorKey: string;
  members: PlayerId[];
  createdAt: Timestamp;
}

export interface Season {
  id: string;
  name: string;
  scoringConfig: ScoringConfig;
  startDate: Timestamp;
  /** Absent means teams are off — the same "absent means off" rule as RaceSettings. */
  teamConfig?: TeamConfig;
  /**
   * Which palette colours are taken, and by whom: `{ ferrari: "team_abc" }`.
   *
   * "No two teams share a colour" spans every team in the season, which a
   * transaction cannot query — so the answer is denormalized onto the one
   * document every colour-changing transaction already reads. Written by **dot
   * path**, never as a whole map: writing it whole would clobber a colour
   * claimed a second earlier, exactly the reason `settings` toggles are written
   * by dot path. Released with `deleteField()`.
   */
  teamColors?: Record<string, string>;
  /**
   * Absent means active — the usual "absent is meaningful" rule, so seasons
   * created before archiving existed need no migration. An archived season
   * drops out of pickers and keeps its standings reachable: a finished season
   * is history, not rubbish.
   */
  archived?: boolean;
}

/**
 * `scheduled` is a real state, not a placeholder: createRace leaves the race
 * unstarted with its clock stopped, and an explicit startRace drops the flag.
 * That window is when the roster can be edited — and it is what makes joining
 * a race before it begins coherent.
 */
export type RaceStatus = "scheduled" | "live" | "complete";

/** One tracked property of the car status card. */
export interface CarStatusProperty {
  key: string;
  label: string;
  /**
   * What an untouched car has. Distinct from `max` because upgrades let a car
   * carry more than it starts with — tires start at 6 on a card that holds 14.
   *
   * Optional, and falls back to `max`: specs written before starts existed
   * simply began full. Read it through `startOf`, never directly.
   */
  start?: number;
  /** The most this property can hold. */
  max: number;
}

/**
 * The dice range a gear rolls. Config rather than code for the same reason the
 * spec is: house variants exist and changing one must not need a deploy.
 */
export interface GearRange {
  gear: number;
  min: number;
  max: number;
}

/**
 * Per-race feature toggles. Optional, and absent means off, so races created
 * before a toggle existed keep working untouched.
 */
export interface RaceSettings {
  /** Stop on nobody's turn between rounds so the table can confirm order. */
  betweenRounds?: boolean;
  /**
   * The car status card. Configured per race rather than in code, following
   * the scoringConfig precedent: maxima vary by house variant and changing one
   * must not need a deploy.
   */
  carStatus?: {
    enabled: boolean;
    spec: CarStatusProperty[];
    /** Absent falls back to the default set. */
    gears?: GearRange[];
  };
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
  /**
   * Whose house it was played at.
   *
   * Optional, and absent means nobody recorded one — the usual rule, so races
   * created before the field existed still render. Free text rather than a
   * reference to a player: the venue is often "Nick's" but it is just as often
   * "the pub" or "Sarah's parents'", and modelling it as a player would make
   * the second case unsayable.
   */
  location?: string;
  /**
   * When it was played, or when it is going to be. Settable rather than always
   * the moment of creation — a race entered after the fact would otherwise
   * sort to today and scramble the season's order.
   */
  scheduledAt: Timestamp;
  status: RaceStatus;
  /** Laps required to finish. Each lap spans many rounds. */
  lapCount: number;
  /** Absent on races created before toggles existed; absent means off. */
  settings?: RaceSettings;
  /**
   * True for a race entered after the fact, that the app never timed.
   *
   * A cache flag, so a view can say "entered afterwards" — deliberately NOT a
   * new event variant. `backfillRace` writes an ordinary `raceCreated` followed
   * by an ordinary `raceFinished`, so replaying the log produces the right
   * state with no new logic anywhere.
   */
  backfilled?: boolean;
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

/**
 * One row of derived constructor standings. Never stored, exactly like
 * SeasonStanding — a team change re-derives the whole season on the next render.
 */
export interface TeamStanding {
  teamId: string;
  points: number;
  /** Sum of the members' finishCounts, so the existing countback works unchanged. */
  finishCounts: number[];
  memberIds: PlayerId[];
  /** Race entries across the whole team — two members in one race counts twice. */
  races: number;
  wins: number;
}

export interface Participant {
  playerId: PlayerId;
  startPosition: number;
  /** Laps this car has completed. Cars cross the line at different rounds. */
  lapsCompleted: number;
  finalPosition: number | null;
  dnf: boolean;
  /**
   * Remaining values on the car status card, by property key.
   *
   * A key absent means full — nothing is backfilled, so a participant that
   * predates the feature reads as an undamaged car.
   *
   * This is NOT board state. The app never derives anything from these numbers
   * and never enforces a rule with them: it is a shared counter standing in for
   * a piece of cardboard, the way the standings list stands in for looking at
   * the table. Keep it that way — the moment something validates a move against
   * remaining tires, this becomes a board model and the rejection in AGENTS.md
   * applies.
   */
  carStatus?: Record<string, number>;
  /**
   * Which gear the car is in, or absent for none.
   *
   * Like carStatus, a shared counter and not a board model: nothing derives
   * from it and nothing validates a move against it. It stands in for the gear
   * lever the way the standings list stands in for looking at the table.
   */
  gear?: number | null;
  /**
   * The anonymous auth uid that has claimed this racer, or null/absent.
   *
   * Shared state, not a device preference: "a player cannot pick a racer
   * someone else already picked" is a fact about the race, so it cannot live
   * in localStorage. The uid is stable per device, which is exactly the
   * granularity wanted — one phone, one racer.
   *
   * "My racer" itself is never stored: it is the participant whose claimedBy
   * matches this device's uid, derived the same way standings and car identity
   * are, so the two halves cannot disagree.
   */
  claimedBy?: string | null;
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

/**
 * Who is making a change. Every mutation in `lib/` takes one, so a
 * chat-entered mistake stays traceable to the chatbot rather than looking like
 * something someone tapped.
 */
export interface Actor {
  source: EventSource;
  actor?: string | null;
}

/**
 * Shared by both append-only logs — the race log and the season log. They have
 * the same shape on purpose: `source` and `actor` answer "who said so" the same
 * way whichever log you are reading, and one shape means one set of rules.
 */
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
  /** Absent on races created before the field existed, and when none was given. */
  location?: string;
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
 * The flag drop, undone. Rewinding from the very first car of round 1 has no
 * earlier turn to step back to — the only thing before it is the start itself —
 * so it puts the race back to `scheduled` with the grid editable again.
 *
 * Its own variant rather than a turnRewound, because no turn moved: what
 * changed is the race's status, and a replay has to be able to see that.
 */
export interface RaceUnstartedEvent extends BaseEvent {
  type: "raceUnstarted";
  /** The grid the race goes back to, which is the standings as they stood. */
  order: PlayerId[];
}

/**
 * A partial edit of RaceSettings, one level deeper than Partial<> reaches.
 * Switching car status on must not require restating the spec beside it —
 * updateRaceSettings writes nested settings by dot path precisely so it
 * doesn't.
 */
export interface RaceSettingsPatchShape {
  betweenRounds?: boolean;
  carStatus?: {
    enabled?: boolean;
    spec?: CarStatusProperty[];
    gears?: GearRange[];
  };
}

/**
 * A change to how the race is configured. Carries only the fields that
 * actually changed, so the log reads as a diff rather than a snapshot.
 */
export interface RaceSettingsChangedEvent extends BaseEvent {
  type: "raceSettingsChanged";
  patch: {
    track?: string;
    /** An empty string is a clearing, and is logged as one. */
    location?: string;
    lapCount?: number;
    turnSeconds?: number;
    /** When the race was run. Editable because a backfilled date can be wrong. */
    scheduledAt?: Timestamp;
    settings?: RaceSettingsPatchShape;
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

/**
 * Someone added themselves to the race. Joining mid-race enters positionOrder
 * only — the joiner starts taking turns next round.
 */
export interface PlayerJoinedEvent extends BaseEvent {
  type: "playerJoined";
  playerId: PlayerId;
  name: string;
}

/** A device claimed a racer as its own. */
export interface RacerClaimedEvent extends BaseEvent {
  type: "racerClaimed";
  playerId: PlayerId;
  uid: string;
}

/** A device gave a racer back. */
export interface RacerReleasedEvent extends BaseEvent {
  type: "racerReleased";
  playerId: PlayerId;
  uid: string;
}

/** A car changed gear. Null means the lever was cleared. */
export interface GearChangedEvent extends BaseEvent {
  type: "gearChanged";
  playerId: PlayerId;
  from: number | null;
  to: number | null;
}

/** One property of a car's status card was changed. */
export interface CarStatusChangedEvent extends BaseEvent {
  type: "carStatusChanged";
  playerId: PlayerId;
  key: string;
  from: number;
  to: number;
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
 * A finished race's result was rewritten.
 *
 * This does not break "corrections append, they never mutate", and the reason
 * is worth stating: `result` on the race document is a **cache of the log**,
 * exactly as the live doc is. Rewriting a cache is fine; rewriting history is
 * not. The original raceFinished event is untouched, this event records the new
 * order, and a `correction` pointing at that raceFinished is appended beside it
 * — so the history view shows both, in chronological place.
 */
export interface RaceResultAmendedEvent extends BaseEvent {
  type: "raceResultAmended";
  order: PlayerId[];
  dnf: PlayerId[];
  note: string;
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
  | RaceUnstartedEvent
  | RaceSettingsChangedEvent
  | PlayerRemovedEvent
  | PlayerJoinedEvent
  | TurnAdvancedEvent
  | RoundStartedEvent
  | RoundEndedEvent
  | PositionOrderChangedEvent
  | LapCompletedEvent
  | DnfChangedEvent
  | ParticipantNoteSetEvent
  | CarStatusChangedEvent
  | GearChangedEvent
  | RacerClaimedEvent
  | RacerReleasedEvent
  | TurnRewoundEvent
  | TurnPausedEvent
  | TurnResumedEvent
  | RaceFinishedEvent
  | RaceResultAmendedEvent
  | CorrectionEvent;

/**
 * One racer in a league, for one season.
 *
 * A subcollection under the season rather than an array on the season document:
 * a member carries fields, and item 17's transactions have to read *one* member
 * without reading the whole league.
 *
 * This is NOT the grid. Membership answers "who is in this league"; the grid
 * answers "who is at the table tonight, and in what order". Someone missing a
 * game night is not leaving the season, so a member with no entry in a race
 * scores *nothing* — which is distinct from a DNF, and stays distinct the first
 * time somebody argues that a DNF should be worth a point.
 *
 * `players/{id}` stays global and is what it should always have been: the
 * human's name, stable across seasons.
 */
export interface SeasonMember {
  playerId: PlayerId;
  joinedAt: Timestamp;
  /**
   * Mirror of `teams/{teamId}.members` — the *exclusivity* authority, so "am I
   * already on a team" is one field a transaction can read. Item 17 populates
   * it; the type is declared now so there is one shape to write against.
   */
  teamId?: string | null;
  /**
   * The uid that claims this racer for the whole season, so a phone claims once
   * instead of every game night. `participants/{id}.claimedBy` stays the
   * in-race truth. Item 15 populates it.
   */
  claimedBy?: string | null;
}

/** Someone joined the league for this season. */
export interface MemberAddedEvent extends BaseEvent {
  type: "memberAdded";
  playerId: PlayerId;
  name: string;
}

/** Someone left the league. Their finished races keep their results. */
export interface MemberRemovedEvent extends BaseEvent {
  type: "memberRemoved";
  playerId: PlayerId;
}

/**
 * A patch of season configuration, one level deep. Same shape as the argument
 * to `updateSeason`, so the event carries exactly what the caller asked for.
 */
export interface SeasonSettingsPatchShape {
  name?: string;
  scoringConfig?: ScoringConfig;
  archived?: boolean;
  teamConfig?: TeamConfigPatchShape;
}

/**
 * A partial edit of TeamConfig, written by dot path so switching teams on does
 * not require restating the palette beside it.
 */
export interface TeamConfigPatchShape {
  enabled?: boolean;
  teamSize?: number;
  playerManaged?: boolean;
  palette?: TeamColor[];
  scoring?: "sum" | "average";
}

/** Seeds the season log the way raceCreated seeds a race's. */
export interface SeasonCreatedEvent extends BaseEvent {
  type: "seasonCreated";
  name: string;
}

/**
 * A change to how the season is configured, carrying only the fields that were
 * actually set — the log reads as a diff, exactly like raceSettingsChanged.
 */
export interface SeasonSettingsChangedEvent extends BaseEvent {
  type: "seasonSettingsChanged";
  patch: SeasonSettingsPatchShape;
}

/**
 * A phone claimed a racer for the whole season, so it does not have to claim
 * again every game night. The in-race claim stays authoritative.
 */
export interface SeasonRacerClaimedEvent extends BaseEvent {
  type: "seasonRacerClaimed";
  playerId: PlayerId;
  uid: string;
}

/** A phone gave a season claim back. */
export interface SeasonRacerReleasedEvent extends BaseEvent {
  type: "seasonRacerReleased";
  playerId: PlayerId;
  uid: string;
}

/** A constructor was created. */
export interface TeamCreatedEvent extends BaseEvent {
  type: "teamCreated";
  teamId: string;
  name: string;
  colorKey: string;
}

export interface TeamRenamedEvent extends BaseEvent {
  type: "teamRenamed";
  teamId: string;
  name: string;
}

export interface TeamRecolouredEvent extends BaseEvent {
  type: "teamRecoloured";
  teamId: string;
  colorKey: string;
}

export interface TeamDeletedEvent extends BaseEvent {
  type: "teamDeleted";
  teamId: string;
  name: string;
}

/**
 * A racer joined a team.
 *
 * Under the house rule that nobody switches teams during a season, a change
 * here is not a transfer — it is a **correction of a recording error**, and it
 * silently re-derives the whole season's team standings. This log is the only
 * thing that records the change happened at all.
 */
export interface TeamJoinedEvent extends BaseEvent {
  type: "teamJoined";
  teamId: string;
  playerId: PlayerId;
}

export interface TeamLeftEvent extends BaseEvent {
  type: "teamLeft";
  teamId: string;
  playerId: PlayerId;
}

/**
 * The season's append-only log, under `seasons/{id}/events`.
 *
 * It ships before anything reads it, and that is deliberate. Nothing replays
 * this log the way the race log can be replayed, and Phase 3's chatbot does not
 * write to it — it earns its place on one narrow ground: from item 17 on, a
 * team move silently re-derives the whole season's team standings, and this is
 * the only thing that will record that the move happened. Unrecoverable after
 * the fact, trivial to write now.
 *
 * Items 14 and 17 extend this union with their own variants. There is
 * deliberately no history view yet.
 */
export type SeasonEvent =
  | SeasonCreatedEvent
  | SeasonSettingsChangedEvent
  | MemberAddedEvent
  | MemberRemovedEvent
  | SeasonRacerClaimedEvent
  | SeasonRacerReleasedEvent
  | TeamCreatedEvent
  | TeamRenamedEvent
  | TeamRecolouredEvent
  | TeamDeletedEvent
  | TeamJoinedEvent
  | TeamLeftEvent;
