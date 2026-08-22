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
  claimRacer,
  completeLap,
  deleteRace,
  finishRace,
  joinRace,
  liveDoc,
  pauseTurn,
  releaseRacer,
  removePlayer,
  resumeTurn,
  rewindTurn,
  setDnf,
  setParticipantNote,
  setPositionOrder,
  startRace,
  startRound,
  uncompleteLap,
  updateRaceSettings,
} from "../lib/race";
import { computeStandings, pointsFor } from "../lib/scoring";
import { DEFAULT_SCORING } from "../lib/seasons";
import { createRace } from "../lib/setup";
import { readTimer } from "../lib/timer";
import type { LiveState, Participant, Race } from "../lib/types";

/** The race's configured turn length — what a rewind must reset the clock to. */
const TURN_SECONDS = 90;
const TURN_MS = TURN_SECONDS * 1000;

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
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

async function main() {
  await signInAnonymously(getAuth(app));
  console.log("signed in anonymously\n");

  const raceId = await createRace({
    track: "SMOKE-TEST",
    lapCount: 2,
    turnSeconds: TURN_SECONDS,
    // Delta is removed below, before the flag drops — the rest of the run is a
    // three-car race, exactly as it was before the roster was editable.
    playerNames: ["Alpha", "Bravo", "Charlie", "Delta"],
  });
  console.log(`created race ${raceId}\n`);

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
  check("winner takes the top of the table", pointsFor(1, false, DEFAULT_SCORING) === 10);
  check("past the table scores the tail value", pointsFor(99, false, DEFAULT_SCORING) === DEFAULT_SCORING.pointsBeyondTable);
  check(
    "a DNF from the lead still scores a DNF",
    pointsFor(1, true, DEFAULT_SCORING) === DEFAULT_SCORING.dnfPoints,
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
  const standings = computeStandings([finished], DEFAULT_SCORING, "default");
  const points = new Map(standings.map((s) => [s.playerId, s.points]));
  check(
    "points follow the finishing order",
    points.get("charlie") === 10 && points.get("alpha") === 8,
    `charlie=${points.get("charlie")} alpha=${points.get("alpha")}`,
  );
  check(
    "the retirement scores dnfPoints, not third place",
    points.get("bravo") === DEFAULT_SCORING.dnfPoints,
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

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nsmoke test threw:", e);
  process.exit(1);
});
