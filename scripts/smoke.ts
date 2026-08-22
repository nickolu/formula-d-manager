/**
 * End-to-end smoke test against the real project. Exercises the actual
 * lib/race.ts transactions and a live onSnapshot listener, which unit-level
 * checks can't cover.
 *
 *   npm run smoke
 *
 * Creates a race named SMOKE-TEST and removes it afterwards. Event docs are
 * intentionally undeletable (the rules enforce append-only), so a few orphan
 * events survive under the deleted race; they are invisible to the app.
 */
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { app, db } from "../lib/firebase";
import {
  advanceTurn,
  amendRaceResult,
  claimRacer,
  completeLap,
  deleteRace,
  finishRace,
  joinRace,
  liveDoc,
  participantDoc,
  pauseTurn,
  raceDoc,
  releaseRacer,
  removePlayer,
  resumeTurn,
  rewindTurn,
  setCarStatus,
  setDnf,
  setGear,
  setParticipantNote,
  setPositionOrder,
  startRace,
  startRound,
  uncompleteLap,
  updateRaceSettings,
} from "../lib/race";
import {
  computeStandings,
  computeTeamStandings,
  pointsFor,
} from "../lib/scoring";
import {
  addSeasonMember,
  claimSeasonRacer,
  createSeason,
  DEFAULT_SCORING,
  deleteSeason,
  releaseSeasonRacer,
  removeSeasonMember,
  seasonDoc,
  updateTeamConfig,
  seasonEventsCol,
  seasonMemberDoc,
  updateSeason,
} from "../lib/seasons";
import { backfillRace, createRace, DEFAULT_CAR_STATUS_SPEC } from "../lib/setup";
import {
  assignToTeam,
  createTeam,
  DEFAULT_TEAM_CONFIG,
  deleteTeam,
  joinTeam,
  leaveTeam,
  recolourTeam,
  renameTeam,
  teamDoc,
} from "../lib/teams";
import { readTimer } from "../lib/timer";
import type {
  LiveState,
  Participant,
  Race,
  RaceEvent,
  Season,
  SeasonEvent,
  Team,
} from "../lib/types";

/** The race's configured turn length — what a rewind must reset the clock to. */
const TURN_SECONDS = 90;
const TURN_MS = TURN_SECONDS * 1000;

let failures = 0;
/**
 * Kept so the summary can name what failed. A run that scrolls past 200 lines
 * and ends in "2 CHECK(S) FAILED" is not diagnosable, and an intermittent
 * failure is exactly the one you cannot reproduce to go looking for.
 */
const failed: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Asserts that a guard actually fires, rather than silently writing bad data. */
async function rejects(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
    check(label, false, "call unexpectedly succeeded");
  } catch {
    check(label, true);
  }
}

/**
 * Resolves when the listener reports a state matching the predicate.
 *
 * `fromIndex` skips states seen before the action under test. Rewind revisits
 * earlier positions, so a predicate like "charlie is up" would otherwise match
 * a snapshot from several turns ago and resolve before the write lands.
 */
function waitFor(
  states: LiveState[],
  predicate: (s: LiveState) => boolean,
  label: string,
  timeoutMs = 10_000,
  fromIndex = 0,
): Promise<LiveState> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const hit = states.slice(fromIndex).findLast(predicate);
      if (hit) {
        clearInterval(poll);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

async function laps(raceId: string) {
  const snap = await getDocs(collection(db, "races", raceId, "participants"));
  return new Map(
    snap.docs.map((d) => [d.id, (d.data() as Participant).lapsCompleted]),
  );
}

async function seasonEvents(seasonId: string): Promise<SeasonEvent[]> {
  const snap = await getDocs(seasonEventsCol(seasonId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SeasonEvent);
}

async function seasonEventTypes(seasonId: string): Promise<string[]> {
  return (await seasonEvents(seasonId)).map((e) => e.type);
}

async function main() {
  await signInAnonymously(getAuth(app));
  console.log("signed in anonymously\n");

  console.log("the season a race lives in:");
  const seasonId = await createSeason(
    { name: "SMOKE-TEST season" },
    { source: "manual" },
  );
  const seededSeason = (await getDoc(seasonDoc(seasonId))).data() as Season;
  check("the season document exists", !!seededSeason);
  check(
    "it starts from the house scoring table",
    seededSeason.scoringConfig.positionPoints.join(",") ===
      DEFAULT_SCORING.positionPoints.join(","),
  );
  check("a new season is active", seededSeason.archived === undefined);
  check(
    "creating a season seeds its log",
    (await seasonEventTypes(seasonId)).includes("seasonCreated"),
  );
  await rejects(
    () => createSeason({ name: "   " }, { source: "manual" }),
    "a season with no name is refused",
  );
  await rejects(
    () =>
      createSeason(
        {
          name: "SMOKE-TEST bad scoring",
          scoringConfig: { positionPoints: [], pointsBeyondTable: 0 },
        },
        { source: "manual" },
      ),
    "a scoring table with no points at all is refused",
  );

  await updateSeason(seasonId, { name: "SMOKE-TEST season 2" }, { source: "manual" });
  const renamed = (await getDoc(seasonDoc(seasonId))).data() as Season;
  check("a season can be renamed", renamed.name === "SMOKE-TEST season 2", renamed.name);
  const renameEvent = (await seasonEvents(seasonId)).find(
    (e) => e.type === "seasonSettingsChanged",
  );
  check(
    "the settings event carries only what changed",
    renameEvent?.type === "seasonSettingsChanged" &&
      Object.keys(renameEvent.patch).join(",") === "name",
    renameEvent?.type === "seasonSettingsChanged"
      ? Object.keys(renameEvent.patch).join(",")
      : "none",
  );
  await updateSeason(seasonId, { archived: true }, { source: "manual" });
  check(
    "a season can be archived",
    ((await getDoc(seasonDoc(seasonId))).data() as Season).archived === true,
  );
  await updateSeason(seasonId, { archived: false }, { source: "manual" });
  check(
    "and reopened",
    ((await getDoc(seasonDoc(seasonId))).data() as Season).archived === false,
  );
  await rejects(
    () => updateSeason(seasonId, { name: "  " }, { source: "manual" }),
    "renaming a season to nothing is refused",
  );
  await rejects(
    () => updateSeason("no-such-season", { name: "x" }, { source: "manual" }),
    "editing a season that does not exist is refused",
  );

  await rejects(
    () =>
      createRace({
        track: "SMOKE-TEST orphan",
        lapCount: 1,
        turnSeconds: TURN_SECONDS,
        playerNames: ["Alpha"],
        seasonId: "no-such-season",
      }),
    "a race in a season that does not exist is refused",
  );

  const raceId = await createRace({
    track: "SMOKE-TEST",
    lapCount: 2,
    turnSeconds: TURN_SECONDS,
    // Delta is removed below, before the flag drops — the rest of the run is a
    // three-car race, exactly as it was before the roster was editable.
    playerNames: ["Alpha", "Bravo", "Charlie", "Delta"],
    seasonId,
    location: "Smoke House",
    scheduledAt: new Date(2021, 2, 4),
  });
  console.log(`\ncreated race ${raceId}\n`);
  check(
    "the race belongs to the season",
    ((await getDoc(doc(db, "races", raceId))).data() as Race).seasonId === seasonId,
  );
  await rejects(
    () => deleteSeason(seasonId),
    "deleting a season that has races is refused",
  );

  const states: LiveState[] = [];
  const unsubscribe = onSnapshot(liveDoc(raceId), (snap) => {
    if (snap.exists()) states.push(snap.data() as LiveState);
  });

  let mark0 = 0;
  const initial = await waitFor(states, (s) => !!s.currentPlayerId, "initial state");
  check("listener receives initial state", true);
  check("grid seeds both lists", initial.positionOrder.join(",") === "alpha,bravo,charlie,delta" && initial.roundOrder.join(",") === "alpha,bravo,charlie,delta");
  check("starts on round 1", initial.currentRound === 1, `round ${initial.currentRound}`);
  check("pole sitter is up", initial.currentPlayerId === "alpha");
  check("timer derives ~90s", readTimer(initial, Date.now()).remainingMs > 85_000);
  check("the configured turn length is seeded", initial.turnDurationDefaultMs === TURN_MS, `${initial.turnDurationDefaultMs}`);

  const created = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check("a new race is scheduled, not live", created.status === "scheduled", created.status);
  check("whose house is recorded", created.location === "Smoke House", created.location);
  check(
    "the date given is the date stored, not the moment of creation",
    created.scheduledAt.toDate().getFullYear() === 2021,
    created.scheduledAt.toDate().toISOString(),
  );
  check("an unstarted race has a stopped clock", readTimer(initial, Date.now()).isPaused);

  console.log("\nsettings, before the flag drops:");
  mark0 = states.length;
  await updateRaceSettings(raceId, { track: "SMOKE-TEST 2", lapCount: 3, turnSeconds: 45 }, { source: "manual" });
  const configured = await waitFor(states, (s) => s.turnDurationDefaultMs === 45_000, "settings applied", 10_000, mark0);
  const reconfigured = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check("track and laps persist on the race doc", reconfigured.track === "SMOKE-TEST 2" && reconfigured.lapCount === 3, `${reconfigured.track}/${reconfigured.lapCount}`);
  check("a paused race also takes the new clock immediately", configured.turnDurationMs === 45_000, `${configured.turnDurationMs}`);
  await rejects(
    () => updateRaceSettings(raceId, { lapCount: 0 }, { source: "manual" }),
    "a nonsense lap count is refused",
  );
  await rejects(
    () => updateRaceSettings(raceId, { track: "   " }, { source: "manual" }),
    "an empty track name is refused",
  );

  await updateRaceSettings(
    raceId,
    { location: "  Smoke Annex  ", scheduledAt: new Date(2022, 5, 6) },
    { source: "manual" },
  );
  const relocated = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check(
    "whose house is editable, and trimmed",
    relocated.location === "Smoke Annex",
    relocated.location,
  );
  check(
    "so is the date",
    relocated.scheduledAt.toDate().getFullYear() === 2022,
    relocated.scheduledAt.toDate().toISOString(),
  );
  await updateRaceSettings(raceId, { location: "" }, { source: "manual" });
  check(
    "an empty location clears it rather than being refused",
    ((await getDoc(doc(db, "races", raceId))).data() as Race).location === "",
  );

  mark0 = states.length;
  await updateRaceSettings(raceId, { track: "SMOKE-TEST", lapCount: 2, turnSeconds: TURN_SECONDS, settings: { betweenRounds: true } }, { source: "manual" });
  await waitFor(states, (s) => s.turnDurationDefaultMs === TURN_MS, "settings restored", 10_000, mark0);
  const toggled = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check("feature toggles land under settings", toggled.settings?.betweenRounds === true, JSON.stringify(toggled.settings));

  console.log("\nediting the grid while scheduled:");
  mark0 = states.length;
  await removePlayer(raceId, "delta", { source: "manual" });
  const trimmed = await waitFor(states, (s) => !s.positionOrder.includes("delta"), "delta removed", 10_000, mark0);
  check("removal unpicks every ordered list", trimmed.positionOrder.join(",") === "alpha,bravo,charlie" && trimmed.roundOrder.join(",") === "alpha,bravo,charlie", trimmed.roundOrder.join(","));
  check(
    "the participant doc goes with it",
    !(await getDoc(doc(db, "races", raceId, "participants", "delta"))).exists(),
  );

  console.log("\ndropping the flag:");
  mark0 = states.length;
  await startRace(raceId, { source: "manual" });
  const started = await waitFor(states, (s) => s.turnStartedAt !== null, "race started", 10_000, mark0);
  check("the race goes live", ((await getDoc(doc(db, "races", raceId))).data() as Race).status === "live");
  check("starting anchors the clock", !readTimer(started, Date.now()).isPaused);
  check("the round order is snapshotted at the start", started.roundOrder.join(",") === "alpha,bravo,charlie", started.roundOrder.join(","));
  check("leader plays first", started.currentPlayerId === "alpha");
  check(
    "start positions follow the grid as it finally stood",
    (await getDoc(doc(db, "races", raceId, "participants", "charlie"))).data()?.startPosition === 3,
  );
  await rejects(
    () => startRace(raceId, { source: "manual" }),
    "starting a race twice is refused",
  );
  await rejects(
    () => removePlayer(raceId, "charlie", { source: "manual" }),
    "the roster is locked once the race has started",
  );

  console.log("\nthe between-rounds interstitial (on by default):");
  check("new races get the pause between rounds", started.betweenRounds === true);
  mark0 = states.length;
  await advanceTurn(raceId, { source: "manual" }); // alpha -> bravo
  await advanceTurn(raceId, { source: "manual" }); // bravo -> charlie
  await advanceTurn(raceId, { source: "manual" }); // charlie -> nobody
  const interstitial = await waitFor(states, (s) => s.phase === "betweenRounds", "the interstitial", 10_000, mark0);
  check("the round ends on nobody's turn", interstitial.currentPlayerId === null, `${interstitial.currentPlayerId}`);
  check("the interstitial is paused", readTimer(interstitial, Date.now()).isPaused);
  check("the round still rolled over", interstitial.currentRound === 2, `round ${interstitial.currentRound}`);
  check("the next round's order is already snapshotted", interstitial.roundOrder.join(",") === "alpha,bravo,charlie");

  mark0 = states.length;
  await rewindTurn(raceId, { source: "manual" });
  const backIn = await waitFor(states, (s) => s.phase === "turn", "back into round 1", 10_000, mark0);
  check("rewinding out of the interstitial goes back a round", backIn.currentRound === 1, `round ${backIn.currentRound}`);
  check("...and lands on that round's last car", backIn.currentPlayerId === "charlie");

  mark0 = states.length;
  await advanceTurn(raceId, { source: "manual" });
  await waitFor(states, (s) => s.phase === "betweenRounds", "the interstitial again", 10_000, mark0);
  mark0 = states.length;
  await startRound(raceId, { source: "manual" });
  const rolled = await waitFor(states, (s) => s.phase === "turn", "round 2 running", 10_000, mark0);
  check("starting the round selects the leader", rolled.currentPlayerId === "alpha", `${rolled.currentPlayerId}`);
  check("starting the round anchors a fresh clock", !readTimer(rolled, Date.now()).isPaused && rolled.turnDurationMs === TURN_MS, `${rolled.turnDurationMs}`);
  await rejects(
    () => startRound(raceId, { source: "manual" }),
    "starting a round that is already running is refused",
  );

  // Turned off for the rest of the run: everything below was written against
  // the instantaneous rollover, which is exactly the behaviour being asserted.
  mark0 = states.length;
  await updateRaceSettings(raceId, { settings: { betweenRounds: false } }, { source: "manual" });
  await waitFor(states, (s) => s.betweenRounds === false, "interstitial off", 10_000, mark0);
  check("the toggle is mirrored onto the live doc", true);

  // Back to the top of round 1 so the turn-order assertions below start from
  // the state they were written for.
  await rewindTurn(raceId, { source: "manual" }); // alpha -> charlie, round 1
  await rewindTurn(raceId, { source: "manual" }); // charlie -> bravo
  await rewindTurn(raceId, { source: "manual" }); // bravo -> alpha
  const rewound0 = await waitFor(states, (s) => s.currentPlayerId === "alpha" && s.currentRound === 1, "back at the start");
  check("the race is back at the top of round 1", rewound0.roundOrder.join(",") === "alpha,bravo,charlie", rewound0.roundOrder.join(","));

  console.log("\nturns within a round:");
  await advanceTurn(raceId, { source: "manual" });
  const s1 = await waitFor(states, (s) => s.currentPlayerId === "bravo", "bravo");
  check("advance follows round order", true);
  check("round unchanged mid-round", s1.currentRound === 1, `round ${s1.currentRound}`);

  console.log("\nmid-round overtake — charlie passes to the lead:");
  await setPositionOrder(raceId, ["charlie", "alpha", "bravo"], { source: "manual" });
  const overtaken = await waitFor(states, (s) => s.positionOrder[0] === "charlie", "new standings");
  check("standings update", overtaken.positionOrder.join(",") === "charlie,alpha,bravo");
  check(
    "round order stays FROZEN mid-round",
    overtaken.roundOrder.join(",") === "alpha,bravo,charlie",
    overtaken.roundOrder.join(","),
  );
  check("current turn undisturbed", overtaken.currentPlayerId === "bravo");
  check("round not advanced by an overtake", overtaken.currentRound === 1);

  await advanceTurn(raceId, { source: "manual" });
  const s2 = await waitFor(states, (s) => s.currentPlayerId === "charlie" && s.currentRound === 1, "charlie in round 1");
  check("round 1 finishes on the old order", s2.roundOrder.join(",") === "alpha,bravo,charlie");

  console.log("\nwrapping to the next round:");
  await advanceTurn(raceId, { source: "manual" });
  const r2 = await waitFor(states, (s) => s.currentRound === 2, "round 2");
  check("wrap increments the ROUND", r2.currentRound === 2, `round ${r2.currentRound}`);
  check(
    "new round adopts current standings",
    r2.roundOrder.join(",") === "charlie,alpha,bravo",
    r2.roundOrder.join(","),
  );
  check("new leader plays first", r2.currentPlayerId === "charlie", `${r2.currentPlayerId}`);

  console.log("\nper-car laps:");
  await completeLap(raceId, "alpha", { source: "manual" });
  await completeLap(raceId, "alpha", { source: "manual" });
  await completeLap(raceId, "bravo", { source: "manual" });
  const afterLaps = await laps(raceId);
  check("laps count per car, not globally", afterLaps.get("alpha") === 2 && afterLaps.get("bravo") === 1 && afterLaps.get("charlie") === 0, `alpha=${afterLaps.get("alpha")} bravo=${afterLaps.get("bravo")} charlie=${afterLaps.get("charlie")}`);

  await uncompleteLap(raceId, "alpha", { source: "manual" });
  check("a mis-tapped lap can be reverted", (await laps(raceId)).get("alpha") === 1);

  console.log("\npause/resume:");
  await pauseTurn(raceId, { source: "manual" });
  const paused = await waitFor(states, (s) => s.turnStartedAt === null, "paused");
  check("pause drops the anchor", readTimer(paused, Date.now()).isPaused);
  await resumeTurn(raceId, { source: "manual" });
  const resumed = await waitFor(states, (s) => s.turnStartedAt !== null, "resumed");
  check("resume re-anchors the clock", !readTimer(resumed, Date.now()).isPaused);

  console.log("\nchanging the turn length mid-turn:");
  const before = states[states.length - 1];
  mark0 = states.length;
  await updateRaceSettings(raceId, { turnSeconds: 30 }, { source: "manual" });
  const midTurn = await waitFor(states, (s) => s.turnDurationDefaultMs === 30_000, "new default", 10_000, mark0);
  check(
    "a running turn keeps its clock",
    midTurn.turnDurationMs === before.turnDurationMs,
    `${midTurn.turnDurationMs} vs ${before.turnDurationMs}`,
  );
  mark0 = states.length;
  await updateRaceSettings(raceId, { turnSeconds: TURN_SECONDS }, { source: "manual" });
  await waitFor(states, (s) => s.turnDurationDefaultMs === TURN_MS, "default restored", 10_000, mark0);

  console.log("\nevent log:");
  const events = await getDocs(collection(db, "races", raceId, "events"));
  const types = events.docs.map((d) => d.data().type as string);
  check("race creation seeded the log", types.includes("raceCreated"));
  // Two rounds have begun by now: one from startRound leaving the interstitial,
  // one from the inline rollover after the toggle was turned off.
  check("roundStarted logged per round begun", types.filter((t) => t === "roundStarted").length === 2, `${types.filter((t) => t === "roundStarted").length}`);
  // Two rounds ended into the interstitial; the inline rollover ends none.
  check("roundEnded logged only for the interstitial", types.filter((t) => t === "roundEnded").length === 2, `${types.filter((t) => t === "roundEnded").length}`);
  check("overtake logged", types.includes("positionOrderChanged"));
  check("lapCompleted logged 3x", types.filter((t) => t === "lapCompleted").length === 3);
  // Five advances have landed on a car; the two that ended a round into the
  // interstitial landed on nobody and logged roundEnded instead.
  check("turnAdvanced logged per car that got the turn", types.filter((t) => t === "turnAdvanced").length === 5, `${types.filter((t) => t === "turnAdvanced").length}`);
  check("all events carry a source", events.docs.every((d) => !!d.data().source));
  check("the flag drop is logged", types.includes("raceStarted"));
  check("the end of a round is logged", types.includes("roundEnded"));
  check("the removal is logged", types.includes("playerRemoved"));
  check(
    "a settings change logs only what changed",
    events.docs
      .filter((d) => d.data().type === "raceSettingsChanged")
      .some((d) => Object.keys(d.data().patch).join(",") === "turnSeconds"),
  );

  // State here: round 2, roundOrder charlie,alpha,bravo, charlie to play.
  console.log("\nstepping back through the turn order:");
  let mark = states.length;
  await advanceTurn(raceId, { source: "manual" });
  await waitFor(states, (s) => s.currentPlayerId === "alpha", "alpha", 10_000, mark);

  mark = states.length;
  await rewindTurn(raceId, { source: "manual" });
  const rewound = await waitFor(states, (s) => s.currentPlayerId === "charlie", "charlie again", 10_000, mark);
  check("rewind steps back within the round", rewound.currentRound === 2, `round ${rewound.currentRound}`);
  check("rewind leaves the round order alone", rewound.roundOrder.join(",") === "charlie,alpha,bravo");
  // The pause above left turnDurationMs holding a partial turn, so a full
  // duration here can only have come from the reset.
  check("rewind auto-pauses", readTimer(rewound, Date.now()).isPaused);
  check(
    "rewind resets the clock to the configured turn length",
    rewound.turnDurationMs === TURN_MS,
    `${rewound.turnDurationMs}`,
  );

  mark = states.length;
  await rewindTurn(raceId, { source: "manual" });
  const crossed = await waitFor(states, (s) => s.currentRound === 1, "back in round 1", 10_000, mark);
  check(
    "rewind crosses one round boundary",
    crossed.currentRound === 1,
    `round ${crossed.currentRound}`,
  );
  check(
    "the previous round's order is restored",
    crossed.roundOrder.join(",") === "alpha,bravo,charlie",
    crossed.roundOrder.join(","),
  );
  check("rewind lands on the last car of that round", crossed.currentPlayerId === "charlie");
  check("only one round of history is kept", crossed.previousRoundOrder === null);
  check("crossing a round boundary resets the clock too", crossed.turnDurationMs === TURN_MS, `${crossed.turnDurationMs}`);
  check("crossing a round boundary auto-pauses too", readTimer(crossed, Date.now()).isPaused);

  // Races created before turnDurationDefaultMs existed have no value to reset
  // to. There are no migrations here, so the fallback is the behaviour — faked
  // by stripping the field, which is a thing only a test may do directly.
  mark = states.length;
  await updateDoc(liveDoc(raceId), {
    turnDurationDefaultMs: deleteField(),
    turnDurationMs: 12_345,
  });
  await waitFor(states, (s) => s.turnDurationMs === 12_345, "legacy-shaped live doc", 10_000, mark);

  mark = states.length;
  await rewindTurn(raceId, { source: "manual" }); // charlie -> bravo
  const legacy = await waitFor(states, (s) => s.currentPlayerId === "bravo", "bravo", 10_000, mark);
  check("a race with no configured duration rewinds without crashing", legacy.currentPlayerId === "bravo");
  check("...and keeps whatever duration it had", legacy.turnDurationMs === 12_345, `${legacy.turnDurationMs}`);
  check("...and still auto-pauses", readTimer(legacy, Date.now()).isPaused);

  mark = states.length;
  await updateDoc(liveDoc(raceId), {
    turnDurationDefaultMs: TURN_MS,
    turnDurationMs: TURN_MS,
  });
  await waitFor(states, (s) => s.turnDurationDefaultMs === TURN_MS, "duration restored", 10_000, mark);

  await rewindTurn(raceId, { source: "manual" }); // bravo -> alpha
  await rejects(
    () => rewindTurn(raceId, { source: "manual" }),
    "rewinding past the start of the race is refused",
  );

  // State here: round 1, roundOrder alpha,bravo,charlie, alpha to play.
  console.log("\nretirement:");
  await rejects(
    () => setDnf(raceId, "delta", true, { source: "manual" }),
    "retiring a car that isn't in the race is refused",
  );

  mark = states.length;
  await setDnf(raceId, "bravo", true, { source: "manual" });
  const out = await waitFor(states, (s) => (s.retired ?? []).includes("bravo"), "bravo retired", 10_000, mark);
  check("retirement is cached on the live doc", out.retired?.join(",") === "bravo");
  check(
    "retirement mirrors onto the participant",
    (await getDoc(doc(db, "races", raceId, "participants", "bravo"))).data()?.dnf === true,
  );

  mark = states.length;
  await advanceTurn(raceId, { source: "manual" });
  const skipped = await waitFor(states, (s) => s.currentPlayerId === "charlie", "charlie", 10_000, mark);
  check("advanceTurn skips a retired car", skipped.currentRound === 1, `round ${skipped.currentRound}`);
  check(
    "the round order still holds the retired car",
    skipped.roundOrder.join(",") === "alpha,bravo,charlie",
    skipped.roundOrder.join(","),
  );

  mark = states.length;
  await rewindTurn(raceId, { source: "manual" });
  await waitFor(states, (s) => s.currentPlayerId === "alpha", "alpha", 10_000, mark);
  check("rewind skips a retired car too", true);

  mark = states.length;
  await setDnf(raceId, "bravo", false, { source: "manual" });
  await waitFor(states, (s) => (s.retired ?? []).length === 0, "bravo un-retired", 10_000, mark);
  await advanceTurn(raceId, { source: "manual" });
  const restored = await waitFor(states, (s) => s.currentPlayerId === "bravo", "bravo", 10_000, mark);
  check("un-retiring puts the car back in the order", restored.currentPlayerId === "bravo");

  // Left retired on purpose: the finish below passes an EMPTY dnf array, so the
  // result proves finishRace unions in retirements it wasn't told about.
  await setDnf(raceId, "bravo", true, { source: "manual" });

  await rejects(
    () => deleteRace(raceId),
    "a race that hasn't been finished cannot be deleted",
  );

  console.log("\njoining a race already in progress:");
  mark0 = states.length;
  const roundBefore = states[states.length - 1].roundOrder.join(",");
  const echoId = await joinRace(raceId, "  Echo  ", "smoke-uid-late", { source: "manual" });
  const joined = await waitFor(states, (s) => s.positionOrder.includes("echo"), "echo joined", 10_000, mark0);
  check("the name slugs to a stable id", echoId === "echo", echoId);
  check("a joiner goes to the back of the standings", joined.positionOrder.at(-1) === "echo", joined.positionOrder.join(","));
  // The whole point: the round in progress is untouched, exactly like an
  // overtake. Echo starts taking turns next round.
  check("the round in progress is not disturbed", joined.roundOrder.join(",") === roundBefore, joined.roundOrder.join(","));
  check(
    "the joiner holds their own claim",
    ((await getDoc(doc(db, "races", raceId, "participants", "echo"))).data() as Participant)
      .claimedBy === "smoke-uid-late",
  );
  check(
    "the joiner starts at the back of the grid",
    ((await getDoc(doc(db, "races", raceId, "participants", "echo"))).data() as Participant)
      .startPosition === joined.positionOrder.length,
  );
  await rejects(
    () => joinRace(raceId, "Echo", "smoke-uid-other", { source: "manual" }),
    "a duplicate name is refused",
  );
  await rejects(
    () => joinRace(raceId, "   ", null, { source: "manual" }),
    "an empty name is refused",
  );
  await rejects(
    () => joinRace(raceId, "!!!", null, { source: "manual" }),
    "a name that slugs to nothing is refused",
  );

  // Removed again so the finishing order below is still the three-car race the
  // scoring assertions were written for.
  await setPositionOrder(raceId, joined.positionOrder.filter((id) => id !== "echo"), { source: "manual" });
  await deleteDoc(doc(db, "races", raceId, "participants", "echo"));

  console.log("\nclaiming a racer:");
  const claimOf = async (id: string) =>
    ((await getDoc(doc(db, "races", raceId, "participants", id))).data() as Participant)
      .claimedBy ?? null;
  const PHONE_A = "smoke-uid-a";
  const PHONE_B = "smoke-uid-b";

  await claimRacer(raceId, "alpha", PHONE_A, { source: "manual" });
  check("a claim sticks to the participant", (await claimOf("alpha")) === PHONE_A);
  await claimRacer(raceId, "alpha", PHONE_A, { source: "manual" });
  check("re-claiming your own racer is a no-op", (await claimOf("alpha")) === PHONE_A);
  await rejects(
    () => claimRacer(raceId, "alpha", PHONE_B, { source: "manual" }),
    "a second device cannot take a claimed racer",
  );

  // Changing racer releases the old claim in the SAME transaction, so there is
  // never a moment where one device holds two.
  await claimRacer(raceId, "charlie", PHONE_A, { source: "manual" }, "alpha");
  check("changing racer frees the old one", (await claimOf("alpha")) === null);
  check("...and holds the new one", (await claimOf("charlie")) === PHONE_A);
  check(
    "the freed racer is claimable by the other device",
    await claimRacer(raceId, "alpha", PHONE_B, { source: "manual" }).then(() => true, () => false),
  );

  // A stale previousPlayerId must never release someone else's claim.
  await claimRacer(raceId, "bravo", PHONE_A, { source: "manual" }, "alpha").catch(() => {});
  check("a stale hand-back cannot free another device's racer", (await claimOf("alpha")) === PHONE_B);

  await releaseRacer(raceId, "alpha", PHONE_A, { source: "manual" });
  check("releasing a racer you don't hold is a no-op", (await claimOf("alpha")) === PHONE_B);
  await releaseRacer(raceId, "alpha", PHONE_B, { source: "manual" });
  check("releasing your own racer frees it", (await claimOf("alpha")) === null);

  console.log("\ncar status:");
  const statusOf = async (id: string) =>
    ((await getDoc(doc(db, "races", raceId, "participants", id))).data() as Participant)
      .carStatus ?? {};
  // The toggle governs display, not data: setCarStatus validates against the
  // spec, which exists whether or not the card is being shown. Turning it off
  // and back on therefore keeps the values, rather than throwing them away.
  await setCarStatus(raceId, "alpha", "brakes", 1, { source: "manual" });
  check("the spec, not the toggle, is what a value is validated against", (await statusOf("alpha")).brakes === 1);

  mark0 = states.length;
  await updateRaceSettings(raceId, { settings: { carStatus: { enabled: true } } }, { source: "manual" });
  const withCard = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check("switching it on leaves the spec beside it alone", (withCard.settings?.carStatus?.spec?.length ?? 0) > 0, `${withCard.settings?.carStatus?.spec?.length}`);
  check("the between-rounds toggle is untouched by it", withCard.settings?.betweenRounds === false, `${withCard.settings?.betweenRounds}`);

  await setCarStatus(raceId, "alpha", "tires", 10, { source: "manual" });
  check("a value persists", (await statusOf("alpha")).tires === 10, `${(await statusOf("alpha")).tires}`);
  // Clamped HERE, not only in the UI — the limit on the card is the only rule
  // there is, and every caller has to hit it. The ceiling is `max`, not the
  // starting value: upgrades let a car carry more than it starts with.
  await setCarStatus(raceId, "alpha", "tires", 999, { source: "manual" });
  check("a value clamps to max, above the starting value", (await statusOf("alpha")).tires === 14, `${(await statusOf("alpha")).tires}`);
  await setCarStatus(raceId, "alpha", "tires", -5, { source: "manual" });
  check("a negative value clamps to zero", (await statusOf("alpha")).tires === 0, `${(await statusOf("alpha")).tires}`);
  check("an untouched property stays absent, meaning its starting value", (await statusOf("alpha")).engine === undefined);
  // Proves absent reads as `start` rather than `max`: setting brakes to its
  // start is a no-op, so nothing is written and no event is appended.
  await setCarStatus(raceId, "charlie", "brakes", 3, { source: "manual" });
  check("setting a property to its starting value writes nothing", (await statusOf("charlie")).brakes === undefined);
  await rejects(
    () => setCarStatus(raceId, "alpha", "wings", 1, { source: "manual" }),
    "an unknown property is refused",
  );

  // A race created before the card existed has no spec at all, and switching
  // the card on writes only `enabled` — so the spec has to fall back, or the
  // toggle silently does nothing. Faked by stripping it, which only a test may
  // do directly.
  mark0 = states.length;
  await updateDoc(raceDoc(raceId), { "settings.carStatus.spec": deleteField() });
  await setCarStatus(raceId, "bravo", "tires", 7, { source: "manual" });
  check("a race with no spec falls back to the default one", (await statusOf("bravo")).tires === 7, `${(await statusOf("bravo")).tires}`);
  await rejects(
    () => setCarStatus(raceId, "bravo", "gearbox", 1, { source: "manual" }),
    "a property the default spec dropped is refused",
  );
  await updateDoc(raceDoc(raceId), { "settings.carStatus.spec": DEFAULT_CAR_STATUS_SPEC });

  console.log("\nthe gear lever:");
  const gearOf = async (id: string) =>
    ((await getDoc(doc(db, "races", raceId, "participants", id))).data() as Participant)
      .gear ?? null;
  check("a car starts in no gear", (await gearOf("alpha")) === null);
  await setGear(raceId, "alpha", 4, { source: "manual" });
  check("a gear persists", (await gearOf("alpha")) === 4, `${await gearOf("alpha")}`);
  await setGear(raceId, "alpha", null, { source: "manual" });
  check("the lever clears", (await gearOf("alpha")) === null);
  await rejects(
    () => setGear(raceId, "alpha", 9, { source: "manual" }),
    "a gear the car doesn't have is refused",
  );
  await rejects(
    () => setGear(raceId, "delta", 1, { source: "manual" }),
    "a gear on a car that isn't in the race is refused",
  );

  console.log("\nnotes:");
  const noteOf = async (id: string) =>
    ((await getDoc(doc(db, "races", raceId, "participants", id))).data() as Participant)
      .note;
  await setParticipantNote(raceId, "bravo", "  blew the engine on lap 1  ", { source: "manual" });
  check("a note saves, trimmed", (await noteOf("bravo")) === "blew the engine on lap 1", `${await noteOf("bravo")}`);
  // bravo is retired at this point; un-retiring must not take the note with it.
  await setDnf(raceId, "bravo", false, { source: "manual" });
  check("a note survives un-retiring", (await noteOf("bravo")) === "blew the engine on lap 1");
  await setDnf(raceId, "bravo", true, { source: "manual" });
  check("...and re-retiring", (await noteOf("bravo")) === "blew the engine on lap 1");
  await setParticipantNote(raceId, "bravo", "", { source: "manual" });
  check("an empty note clears it", (await noteOf("bravo")) === "");
  await setParticipantNote(raceId, "bravo", "engine, lap 1", { source: "manual" });
  await rejects(
    () => setParticipantNote(raceId, "delta", "nope", { source: "manual" }),
    "a note on a car that isn't in the race is refused",
  );

  console.log("\nscoring is pure — no Firestore involved:");
  check("winner takes the top of the table", pointsFor(1, DEFAULT_SCORING) === 10);
  check("past the table scores the tail value", pointsFor(99, DEFAULT_SCORING) === DEFAULT_SCORING.pointsBeyondTable);
  // Retirement is not a special case: the order already says who went out and
  // when, so the placing is the score.
  check(
    "a retirement scores its placing like any other result",
    pointsFor(3, DEFAULT_SCORING) === DEFAULT_SCORING.positionPoints[2],
  );

  console.log("\nfinishing the race:");
  await rejects(
    () => finishRace(raceId, ["charlie", "alpha"], [], { source: "manual" }),
    "a partial finishing order is refused",
  );
  await rejects(
    () => finishRace(raceId, ["charlie", "alpha", "delta"], [], { source: "manual" }),
    "a stranger in the finishing order is refused",
  );

  // Empty dnf: bravo retired mid-race and must survive a finish form that
  // doesn't mention them.
  await finishRace(raceId, ["charlie", "alpha", "bravo"], [], {
    source: "manual",
  });

  const finished = (await getDoc(doc(db, "races", raceId))).data() as Race;
  check("race is marked complete", finished.status === "complete", finished.status);
  check(
    "finishing order is denormalized onto the race",
    finished.result?.order.join(",") === "charlie,alpha,bravo",
    finished.result?.order.join(","),
  );
  check(
    "a mid-race retirement survives a finish that omits it",
    finished.result?.dnf.join(",") === "bravo",
    finished.result?.dnf.join(","),
  );

  const finalParticipants = await getDocs(
    collection(db, "races", raceId, "participants"),
  );
  const byId = new Map(
    finalParticipants.docs.map((d) => [d.id, d.data() as Participant]),
  );
  check(
    "participants get their final positions",
    byId.get("charlie")?.finalPosition === 1 &&
      byId.get("alpha")?.finalPosition === 2 &&
      byId.get("bravo")?.finalPosition === 3,
  );
  check("the retired car is flagged", byId.get("bravo")?.dnf === true);

  const finishEvents = await getDocs(collection(db, "races", raceId, "events"));
  const finalTypes = finishEvents.docs.map((d) => d.data().type as string);
  check(
    "raceFinished logged once",
    finalTypes.filter((t) => t === "raceFinished").length === 1,
  );
  check("setting and clearing a note are both logged", finalTypes.filter((t) => t === "participantNoteSet").length === 3, `${finalTypes.filter((t) => t === "participantNoteSet").length}`);
  await setParticipantNote(raceId, "alpha", "won it on the last corner", { source: "manual" });
  check(
    "notes are editable on a sealed race",
    ((await getDoc(doc(db, "races", raceId, "participants", "alpha"))).data() as Participant)
      .note === "won it on the last corner",
  );
  check(
    "every rewind is logged",
    finalTypes.filter((t) => t === "turnRewound").length === 9,
    `${finalTypes.filter((t) => t === "turnRewound").length}`,
  );
  // Three from the retirement section, two more from the note test proving a
  // note survives the flag going off and back on.
  check(
    "every retirement change is logged",
    finalTypes.filter((t) => t === "dnfChanged").length === 5,
    `${finalTypes.filter((t) => t === "dnfChanged").length}`,
  );

  console.log("\nstandings derive from the finished race:");
  const standings = computeStandings([finished], DEFAULT_SCORING, seasonId);
  const points = new Map(standings.map((s) => [s.playerId, s.points]));
  check(
    "points follow the finishing order",
    points.get("charlie") === 10 && points.get("alpha") === 8,
    `charlie=${points.get("charlie")} alpha=${points.get("alpha")}`,
  );
  check(
    "the retirement scores third place, because that is where it was placed",
    points.get("bravo") === DEFAULT_SCORING.positionPoints[2],
    `bravo=${points.get("bravo")}`,
  );
  check("the winner leads the standings", standings[0]?.playerId === "charlie");
  check(
    "a retirement is not counted as a podium",
    standings.find((s) => s.playerId === "bravo")?.podiums === 0,
  );
  check(
    "a retirement leaves bestFinish unset",
    standings.find((s) => s.playerId === "bravo")?.bestFinish === null,
  );

  unsubscribe();

  console.log("\nthe season roster — the league is not the grid:");
  const rosterRaceId = await createRace({
    track: "SMOKE-TEST roster",
    lapCount: 1,
    turnSeconds: TURN_SECONDS,
    playerNames: ["Alpha", "Bravo"],
    seasonId,
  });

  const echo = await addSeasonMember(seasonId, "Echo", { source: "manual" });
  check(
    "the member document is written",
    (await getDoc(seasonMemberDoc(seasonId, echo))).exists(),
  );
  check(
    "adding a member is logged",
    (await seasonEventTypes(seasonId)).includes("memberAdded"),
  );
  check(
    "they join the race that has not started",
    (
      (await getDoc(liveDoc(rosterRaceId))).data() as LiveState
    ).positionOrder.includes(echo),
  );
  // The whole point of item 14: the sealed race is never written to. Adding
  // them to result.order would mutate the scoring cache of a race they did not
  // run so the standings could read a zero back out of it.
  const sealed = (await getDoc(raceDoc(raceId))).data() as Race;
  check(
    "...and the finished race is left alone",
    !sealed.result?.order.includes(echo),
    sealed.result?.order.join(","),
  );
  await rejects(
    () => addSeasonMember(seasonId, "Echo", { source: "manual" }),
    "adding the same member twice is refused",
  );
  await rejects(
    () => addSeasonMember(seasonId, "   ", { source: "manual" }),
    "a member with no name is refused",
  );

  const seeded = computeStandings([finished], DEFAULT_SCORING, seasonId, [
    "alpha",
    "bravo",
    "charlie",
    echo,
  ]);
  const echoRow = seeded.find((r) => r.playerId === echo);
  check(
    "a member who missed the race still has a row",
    echoRow?.points === 0 && echoRow?.races === 0,
    `${echoRow?.points}pts/${echoRow?.races} races`,
  );
  check("the roster does not disturb the finishers", seeded[0]?.playerId === "charlie");
  // Absent is not retired, and the difference is no longer subtle: a car that
  // went out was there and is placed for it; a driver who stayed home was not.
  check(
    "a missed race scores nothing, a retirement scores its placing",
    seeded.find((r) => r.playerId === echo)?.points === 0 &&
      seeded.find((r) => r.playerId === "bravo")?.points ===
        DEFAULT_SCORING.positionPoints[2],
  );
  check(
    "...and a missed race is not counted as an entry",
    seeded.find((r) => r.playerId === echo)?.races === 0 &&
      seeded.find((r) => r.playerId === "bravo")?.races === 1,
  );

  await removeSeasonMember(seasonId, echo, { source: "manual" });
  check(
    "removing a member takes them off the unstarted grid",
    !(
      (await getDoc(liveDoc(rosterRaceId))).data() as LiveState
    ).positionOrder.includes(echo),
  );
  check(
    "the member document goes with them",
    !(await getDoc(seasonMemberDoc(seasonId, echo))).exists(),
  );
  check(
    "leaving is logged",
    (await seasonEventTypes(seasonId)).includes("memberRemoved"),
  );
  await rejects(
    () => removeSeasonMember(seasonId, echo, { source: "manual" }),
    "removing someone who is not in the season is refused",
  );

  await startRace(rosterRaceId, { source: "manual" });
  const foxtrot = await addSeasonMember(seasonId, "Foxtrot", { source: "manual" });
  const joinedLive = (await getDoc(liveDoc(rosterRaceId))).data() as LiveState;
  check(
    "a member joins a live race in standings only, racing from next round",
    joinedLive.positionOrder.includes(foxtrot) &&
      !joinedLive.roundOrder.includes(foxtrot),
    joinedLive.roundOrder.join(","),
  );
  await rejects(
    () => removeSeasonMember(seasonId, foxtrot, { source: "manual" }),
    "removing a member who is racing right now is refused",
  );

  console.log("\nthe season claim — claim once, not every game night:");
  await claimSeasonRacer(seasonId, foxtrot, "uid-smoke-1", null, {
    source: "manual",
  });
  check(
    "the claim lands on the member",
    (await getDoc(seasonMemberDoc(seasonId, foxtrot))).data()?.claimedBy ===
      "uid-smoke-1",
  );
  await rejects(
    () =>
      claimSeasonRacer(seasonId, foxtrot, "uid-smoke-2", null, {
        source: "manual",
      }),
    "a second phone cannot take a claimed racer",
  );
  await claimSeasonRacer(seasonId, foxtrot, "uid-smoke-1", null, {
    source: "manual",
  });
  check("re-claiming your own racer is a no-op, not an error", true);
  await rejects(
    () =>
      claimSeasonRacer(seasonId, "nobody", "uid-smoke-1", null, {
        source: "manual",
      }),
    "claiming someone who is not in the season is refused",
  );

  // The whole point: a new race seeds its participants from the season claim,
  // so the phone does not have to claim again.
  const seededRaceId = await createRace({
    track: "SMOKE-TEST seeded",
    lapCount: 1,
    turnSeconds: TURN_SECONDS,
    playerNames: ["Foxtrot", "Alpha"],
    seasonId,
  });
  check(
    "a new race seeds the claim from the season",
    ((await getDoc(participantDoc(seededRaceId, foxtrot))).data() as Participant)
      ?.claimedBy === "uid-smoke-1",
  );
  check(
    "...and leaves an unclaimed racer unclaimed",
    ((await getDoc(participantDoc(seededRaceId, "alpha"))).data() as Participant)
      ?.claimedBy === null,
  );
  // The other half of the seeding: a player who joins a race that already
  // exists picks the claim up too, which is what makes "claim once a season"
  // true for a latecomer and not only for a race created afterwards.
  const golf = await addSeasonMember(seasonId, "Golf", { source: "manual" });
  await claimSeasonRacer(seasonId, golf, "uid-smoke-3", null, {
    source: "manual",
  });
  await removePlayer(seededRaceId, golf, { source: "manual" });
  await joinRace(seededRaceId, "Golf", null, { source: "manual" });
  check(
    "joining an existing race seeds the claim too",
    ((await getDoc(participantDoc(seededRaceId, golf))).data() as Participant)
      ?.claimedBy === "uid-smoke-3",
  );

  await finishRace(seededRaceId, [foxtrot, "alpha", golf], [], {
    source: "manual",
  });
  await deleteRace(seededRaceId);

  await releaseSeasonRacer(seasonId, foxtrot, "uid-smoke-2", {
    source: "manual",
  });
  check(
    "a phone that does not hold the claim cannot release it",
    (await getDoc(seasonMemberDoc(seasonId, foxtrot))).data()?.claimedBy ===
      "uid-smoke-1",
  );
  await releaseSeasonRacer(seasonId, foxtrot, "uid-smoke-1", {
    source: "manual",
  });
  check(
    "the holder can give it back",
    (await getDoc(seasonMemberDoc(seasonId, foxtrot))).data()?.claimedBy === null,
  );
  check(
    "season claims are logged",
    (await seasonEventTypes(seasonId)).includes("seasonRacerClaimed") &&
      (await seasonEventTypes(seasonId)).includes("seasonRacerReleased"),
  );

  await finishRace(rosterRaceId, ["alpha", "bravo", foxtrot, golf], [], {
    source: "manual",
  });
  await deleteRace(rosterRaceId);
  await removeSeasonMember(seasonId, foxtrot, { source: "manual" });
  check(
    "...and allowed again once no race is running",
    !(await getDoc(seasonMemberDoc(seasonId, foxtrot))).exists(),
  );

  console.log("\nteams — two invariants Firestore cannot query for:");
  await updateTeamConfig(
    seasonId,
    { ...DEFAULT_TEAM_CONFIG, enabled: true, teamSize: 2 },
    { source: "manual" },
  );
  const withTeams = (await getDoc(seasonDoc(seasonId))).data() as Season;
  check("teams can be switched on", withTeams.teamConfig?.enabled === true);
  check(
    "switching on writes a usable config, not a lone flag",
    (withTeams.teamConfig?.palette?.length ?? 0) > 0,
  );

  const teamA = await createTeam(seasonId, "Smoke Red", "ferrari", {
    source: "manual",
  });
  check(
    "the colour is claimed on the season doc",
    ((await getDoc(seasonDoc(seasonId))).data() as Season).teamColors?.ferrari ===
      teamA,
  );
  await rejects(
    () => createTeam(seasonId, "Smoke Red II", "ferrari", { source: "manual" }),
    "a second team cannot take a claimed colour",
  );
  await rejects(
    () => createTeam(seasonId, "Smoke Nope", "not-a-colour", { source: "manual" }),
    "a colour outside the palette is refused",
  );

  const teamB = await createTeam(seasonId, "Smoke Blue", "mercedes", {
    source: "manual",
  });

  // The whole reason the colour map is denormalized onto the season document:
  // two phones picking the same colour at the same moment.
  const colourRace = await Promise.allSettled([
    recolourTeam(seasonId, teamA, "redbull", { source: "manual" }),
    recolourTeam(seasonId, teamB, "redbull", { source: "manual" }),
  ]);
  check(
    "two concurrent colour claims: exactly one wins",
    colourRace.filter((r) => r.status === "fulfilled").length === 1,
    colourRace.map((r) => r.status).join(","),
  );
  const afterColourRace = (await getDoc(seasonDoc(seasonId))).data() as Season;
  check(
    "the loser's old colour is not left claimed by nobody",
    Object.keys(afterColourRace.teamColors ?? {}).length === 2,
    JSON.stringify(afterColourRace.teamColors),
  );

  await rejects(
    () =>
      updateTeamConfig(
        seasonId,
        { palette: DEFAULT_TEAM_CONFIG.palette.filter((c) => c.key !== "redbull") },
        { source: "manual" },
      ),
    "a palette colour a team is wearing cannot be removed",
  );

  await renameTeam(seasonId, teamA, "Smoke Scarlet", { source: "manual" });
  check(
    "a team can be renamed",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).name ===
      "Smoke Scarlet",
  );

  // The other denormalized invariant: capacity lives on the team document so a
  // transaction can read it, and exclusivity lives on the member document.
  await addSeasonMember(seasonId, "Hotel", { source: "manual" });
  await addSeasonMember(seasonId, "India", { source: "manual" });
  await addSeasonMember(seasonId, "Juliet", { source: "manual" });
  await joinTeam(seasonId, teamA, "hotel", { source: "manual" });
  check(
    "membership is written twice — the team's array",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).members.join(",") ===
      "hotel",
  );
  check(
    "...and the member's teamId",
    (await getDoc(seasonMemberDoc(seasonId, "hotel"))).data()?.teamId === teamA,
  );
  await rejects(
    () => joinTeam(seasonId, teamB, "hotel", { source: "manual" }),
    "a racer cannot be on two teams",
  );

  const slotRace = await Promise.allSettled([
    joinTeam(seasonId, teamA, "india", { source: "manual" }),
    joinTeam(seasonId, teamA, "juliet", { source: "manual" }),
  ]);
  check(
    "two concurrent joins to the last slot: exactly one wins",
    slotRace.filter((r) => r.status === "fulfilled").length === 1,
    slotRace.map((r) => r.status).join(","),
  );
  check(
    "the team is not overfilled",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).members.length === 2,
  );

  // The admin path shares the invariants but is allowed to make an uneven team.
  const leftover = (await getDoc(seasonMemberDoc(seasonId, "india"))).data()
    ?.teamId
    ? "juliet"
    : "india";
  await assignToTeam(seasonId, teamA, leftover, { source: "manual" });
  check(
    "the admin may overfill a team — equal sizes are a house rule, not a check",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).members.length === 3,
  );

  // The soft check the player path passes. Not security — there is no auth to
  // enforce one with — but it is the constraint that holds at a table.
  await rejects(
    () =>
      renameTeam(seasonId, teamB, "Not mine", { source: "manual" }, leftover),
    "a racer cannot rename a team they are not on",
  );
  await renameTeam(
    seasonId,
    teamA,
    "Smoke Crimson",
    { source: "manual" },
    leftover,
  );
  check(
    "...but can rename their own",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).name ===
      "Smoke Crimson",
  );

  // Shrinking teamSize must not kick anyone out.
  await updateTeamConfig(seasonId, { teamSize: 1 }, { source: "manual" });
  check(
    "lowering team size kicks nobody",
    ((await getDoc(teamDoc(seasonId, teamA))).data() as Team).members.length === 3,
  );
  await updateTeamConfig(seasonId, { teamSize: 2 }, { source: "manual" });

  await leaveTeam(seasonId, "hotel", { source: "manual" });
  check(
    "leaving clears both halves",
    !((await getDoc(teamDoc(seasonId, teamA))).data() as Team).members.includes(
      "hotel",
    ) && (await getDoc(seasonMemberDoc(seasonId, "hotel"))).data()?.teamId === null,
  );

  const teamAColour = ((await getDoc(teamDoc(seasonId, teamA))).data() as Team)
    .colorKey;
  await deleteTeam(seasonId, teamA, { source: "manual" });
  check(
    "deleting a team frees its colour",
    ((await getDoc(seasonDoc(seasonId))).data() as Season).teamColors?.[
      teamAColour
    ] === undefined,
  );
  check(
    "...and clears its members' teamId",
    (await getDoc(seasonMemberDoc(seasonId, leftover))).data()?.teamId === null,
  );
  // Team standings are derived the same way driver standings are — pure, and
  // re-derived from current membership, so a team correction re-scores the
  // whole season on the next render rather than needing a stored snapshot.
  const teamTable = computeTeamStandings(
    [finished],
    DEFAULT_SCORING,
    [
      {
        id: teamA,
        name: "Smoke Crimson",
        colorKey: "redbull",
        members: ["charlie", "alpha"],
        createdAt: finished.scheduledAt,
      },
      {
        id: teamB,
        name: "Smoke Blue",
        colorKey: "mercedes",
        members: ["bravo"],
        createdAt: finished.scheduledAt,
      },
    ],
    { scoring: "sum" },
    seasonId,
  );
  check(
    "a team scores the sum of its drivers",
    teamTable[0]?.teamId === teamA && teamTable[0]?.points === 18,
    `${teamTable[0]?.teamId}=${teamTable[0]?.points}`,
  );
  check(
    "a team whose only driver retired still scores that driver's placing",
    teamTable[1]?.points === DEFAULT_SCORING.positionPoints[2],
    `${teamTable[1]?.points}`,
  );
  const emptyTeam = computeTeamStandings(
    [finished],
    DEFAULT_SCORING,
    [
      {
        id: "ghost",
        name: "Ghost",
        colorKey: "haas",
        members: [],
        createdAt: finished.scheduledAt,
      },
    ],
    { scoring: "sum" },
    seasonId,
  );
  check(
    "a team with nobody in it renders on zero rather than throwing",
    emptyTeam[0]?.points === 0 && emptyTeam[0]?.races === 0,
  );
  const averaged = computeTeamStandings(
    [finished],
    DEFAULT_SCORING,
    [
      {
        id: teamA,
        name: "Smoke Crimson",
        colorKey: "redbull",
        members: ["charlie", "alpha"],
        createdAt: finished.scheduledAt,
      },
    ],
    { scoring: "average" },
    seasonId,
  );
  check(
    "average divides by the drivers who entered, not by team size",
    averaged[0]?.points === 9,
    `${averaged[0]?.points}`,
  );

  const seasonTypes = await seasonEventTypes(seasonId);
  check(
    "every team change is logged",
    ["teamCreated", "teamRenamed", "teamRecoloured", "teamJoined", "teamLeft", "teamDeleted"].every(
      (t) => seasonTypes.includes(t),
    ),
    seasonTypes.filter((t) => t.startsWith("team")).join(","),
  );
  await deleteTeam(seasonId, teamB, { source: "manual" });
  for (const id of ["hotel", "india", "juliet"]) {
    await removeSeasonMember(seasonId, id, { source: "manual" });
  }

  console.log("\nbackfilling a race the app never timed:");
  const runOn = new Date(2020, 4, 17);
  const backfilledId = await backfillRace({
    seasonId,
    track: "SMOKE-TEST backfill",
    scheduledAt: runOn,
    playerNames: ["Bravo", "Alpha", "Charlie"],
    dnfNames: ["Charlie"],
  });
  const backfilled = (await getDoc(raceDoc(backfilledId))).data() as Race;
  check("it is created already complete", backfilled.status === "complete");
  check("it is flagged as entered afterwards", backfilled.backfilled === true);
  check(
    "it sorts by the date given, not by today",
    backfilled.scheduledAt.toDate().getFullYear() === 2020,
    backfilled.scheduledAt.toDate().toISOString(),
  );
  check(
    "the result is denormalized like any finished race",
    backfilled.result?.order.join(",") === "bravo,alpha,charlie" &&
      backfilled.result?.dnf.join(",") === "charlie",
  );
  // The minimal live doc is what keeps every screen from special-casing a race
  // the app never timed.
  const backfilledLive = (await getDoc(liveDoc(backfilledId))).data() as LiveState;
  check(
    "a live doc exists so every screen still renders",
    backfilledLive.currentPlayerId === null &&
      backfilledLive.currentRound === 0 &&
      backfilledLive.positionOrder.join(",") === "bravo,alpha,charlie",
  );
  const backfilledParticipant = (
    await getDoc(participantDoc(backfilledId, "charlie"))
  ).data() as Participant;
  check(
    "participants carry their finishing position and flag",
    backfilledParticipant.finalPosition === 3 && backfilledParticipant.dnf === true,
  );
  const backfilledEvents = (
    await getDocs(collection(db, "races", backfilledId, "events"))
  ).docs.map((d) => (d.data() as RaceEvent).type);
  check(
    "the log gets ordinary raceCreated and raceFinished — no new variant",
    backfilledEvents.sort().join(",") === "raceCreated,raceFinished",
    backfilledEvents.join(","),
  );
  const backfilledStandings = computeStandings(
    [{ ...backfilled, id: backfilledId } as Race],
    DEFAULT_SCORING,
    seasonId,
  );
  check(
    "it scores like any other race",
    backfilledStandings[0]?.playerId === "bravo" &&
      backfilledStandings[0]?.points === 10,
  );
  await rejects(
    () =>
      backfillRace({
        seasonId,
        track: "SMOKE-TEST bad backfill",
        scheduledAt: runOn,
        playerNames: ["Alpha", "Alpha"],
      }),
    "a backfill with a duplicate in the order is refused",
  );
  await rejects(
    () =>
      backfillRace({
        seasonId,
        track: "SMOKE-TEST bad backfill",
        scheduledAt: runOn,
        playerNames: ["Alpha"],
        dnfNames: ["Bravo"],
      }),
    "a backfilled DNF who is not in the order is refused",
  );

  console.log("\namending a finished race — a cache is rewritten, not history:");
  await rejects(
    () =>
      amendRaceResult(backfilledId, ["alpha", "bravo"], [], "partial", {
        source: "manual",
      }),
    "a partial amended order is refused",
  );
  await rejects(
    () =>
      amendRaceResult(
        backfilledId,
        ["alpha", "bravo", "charlie", "delta"],
        [],
        "stranger",
        { source: "manual" },
      ),
    "a stranger in the amended order is refused",
  );

  await amendRaceResult(
    backfilledId,
    ["alpha", "bravo", "charlie"],
    [],
    "Bravo was second, not first",
    { source: "manual" },
  );
  const amended = (await getDoc(raceDoc(backfilledId))).data() as Race;
  check(
    "the result cache is rewritten",
    amended.result?.order.join(",") === "alpha,bravo,charlie",
    amended.result?.order.join(","),
  );
  check(
    "an amendment can un-retire a car — that is a legitimate correction",
    amended.result?.dnf.length === 0,
  );
  check(
    "participants follow the new order",
    ((await getDoc(participantDoc(backfilledId, "alpha"))).data() as Participant)
      .finalPosition === 1,
  );
  const amendedEvents = (
    await getDocs(collection(db, "races", backfilledId, "events"))
  ).docs.map((d) => ({ id: d.id, ...d.data() }) as RaceEvent);
  const amendedTypes = amendedEvents.map((e) => e.type);
  check(
    "the original raceFinished is still there, untouched",
    amendedTypes.filter((t) => t === "raceFinished").length === 1,
  );
  check("the amendment is logged", amendedTypes.includes("raceResultAmended"));
  const correction = amendedEvents.find((e) => e.type === "correction");
  const originalFinish = amendedEvents.find((e) => e.type === "raceFinished");
  check(
    "a correction points at the original finish",
    correction?.type === "correction" &&
      correction.targetEventId === originalFinish?.id,
  );
  check(
    "standings follow the amendment, having never been stored",
    computeStandings(
      [{ ...amended, id: backfilledId } as Race],
      DEFAULT_SCORING,
      seasonId,
    )[0]?.playerId === "alpha",
  );
  await deleteRace(backfilledId);

  console.log("\ndeleting the race — which is also the cleanup:");
  await deleteRace(raceId);
  check("the race document is gone", !(await getDoc(doc(db, "races", raceId))).exists());
  check("the live state is gone", !(await getDoc(liveDoc(raceId))).exists());
  check(
    "the participants are gone",
    (await getDocs(collection(db, "races", raceId, "participants"))).empty,
  );
  check(
    "the event log survives, orphaned by design",
    !(await getDocs(collection(db, "races", raceId, "events"))).empty,
  );
  await rejects(
    () => deleteRace(raceId),
    "deleting a race that is already gone is refused",
  );

  console.log("\na race that can never be finished is still deletable:");
  const staleId = await createRace({
    track: "SMOKE-TEST stale",
    lapCount: 1,
    turnSeconds: TURN_SECONDS,
    playerNames: ["Alpha"],
    seasonId,
  });
  await rejects(
    () => deleteRace(staleId),
    "an unfinished race is refused, as it always was",
  );
  // What a race predating the positionOrder/roundOrder split looks like. Every
  // screen that could finish it renders StaleRace, so without the carve-out it
  // would be undeletable forever.
  await updateDoc(liveDoc(staleId), { positionOrder: deleteField() });
  await deleteRace(staleId);
  check(
    "...but one with no usable live state is not",
    !(await getDoc(raceDoc(staleId))).exists(),
  );

  console.log("\ncleaning up the season:");
  await deleteSeason(seasonId);
  check("the season document is gone", !(await getDoc(seasonDoc(seasonId))).exists());
  check(
    "its log survives, orphaned by design",
    (await seasonEvents(seasonId)).length > 0,
  );
  await rejects(
    () => deleteSeason(seasonId),
    "deleting a season that is already gone is refused",
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  for (const label of failed) console.log(`  FAIL  ${label}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nsmoke test threw:", e);
  process.exit(1);
});
