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
import { collection, deleteDoc, doc, getDocs, onSnapshot } from "firebase/firestore";
import { app, db } from "../lib/firebase";
import {
  advanceTurn,
  completeLap,
  liveDoc,
  pauseTurn,
  resumeTurn,
  setPositionOrder,
  uncompleteLap,
} from "../lib/race";
import { createRace } from "../lib/setup";
import { readTimer } from "../lib/timer";
import type { LiveState, Participant } from "../lib/types";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Resolves when the listener reports a state matching the predicate. */
function waitFor(
  states: LiveState[],
  predicate: (s: LiveState) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<LiveState> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const hit = states.findLast(predicate);
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
