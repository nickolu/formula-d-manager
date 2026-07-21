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
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { app, db } from "../lib/firebase";
import {
  advanceTurn,
  completeLap,
  finishRace,
  liveDoc,
  pauseTurn,
  resumeTurn,
  rewindTurn,
  setDnf,
  setPositionOrder,
  uncompleteLap,
} from "../lib/race";
import { computeStandings, pointsFor } from "../lib/scoring";
import { DEFAULT_SCORING } from "../lib/seasons";
import { createRace } from "../lib/setup";
import { readTimer } from "../lib/timer";
import type { LiveState, Participant, Race } from "../lib/types";

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
    turnSeconds: 90,
    playerNames: ["Alpha", "Bravo", "Charlie"],
  });
  console.log(`created race ${raceId}\n`);

  const states: LiveState[] = [];
  const unsubscribe = onSnapshot(liveDoc(raceId), (snap) => {
    if (snap.exists()) states.push(snap.data() as LiveState);
  });

  const initial = await waitFor(states, (s) => !!s.currentPlayerId, "initial state");
  check("listener receives initial state", true);
  check("grid seeds both lists", initial.positionOrder.join(",") === "alpha,bravo,charlie" && initial.roundOrder.join(",") === "alpha,bravo,charlie");
  check("starts on round 1", initial.currentRound === 1, `round ${initial.currentRound}`);
  check("leader plays first", initial.currentPlayerId === "alpha");
  check("timer derives ~90s", readTimer(initial, Date.now()).remainingMs > 85_000);

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

  console.log("\nevent log:");
  const events = await getDocs(collection(db, "races", raceId, "events"));
  const types = events.docs.map((d) => d.data().type as string);
  check("race creation seeded the log", types.includes("raceCreated"));
  check("roundStarted logged once", types.filter((t) => t === "roundStarted").length === 1, `${types.filter((t) => t === "roundStarted").length}`);
  check("overtake logged", types.includes("positionOrderChanged"));
  check("lapCompleted logged 3x", types.filter((t) => t === "lapCompleted").length === 3);
  check("turnAdvanced logged 3x", types.filter((t) => t === "turnAdvanced").length === 3, `${types.filter((t) => t === "turnAdvanced").length}`);
  check("all events carry a source", events.docs.every((d) => !!d.data().source));

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
  check("rewind re-anchors the clock", !readTimer(rewound, Date.now()).isPaused);

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

  await rewindTurn(raceId, { source: "manual" }); // charlie -> bravo
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
  check(
    "every rewind is logged",
    finalTypes.filter((t) => t === "turnRewound").length === 5,
    `${finalTypes.filter((t) => t === "turnRewound").length}`,
  );
  check(
    "every retirement change is logged",
    finalTypes.filter((t) => t === "dnfChanged").length === 3,
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

  console.log("\ncleaning up…");
  for (const p of (await getDocs(collection(db, "races", raceId, "participants"))).docs) {
    await deleteDoc(p.ref);
  }
  await deleteDoc(liveDoc(raceId));
  await deleteDoc(doc(db, "races", raceId));
  console.log("race removed (events remain by design)");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nsmoke test threw:", e);
  process.exit(1);
});
