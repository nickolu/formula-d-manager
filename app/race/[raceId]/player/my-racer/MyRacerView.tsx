"use client";

import { useState } from "react";
import { assignCars, readableInk } from "@/lib/cars";
import {
  useLiveState,
  useParticipants,
  usePlayers,
  useRace,
  useUid,
} from "@/lib/hooks";
import { claimRacer, joinRace, releaseRacer, setCarStatus } from "@/lib/race";
import type { PlayerId } from "@/lib/types";
import RacerOverview from "./RacerOverview";

/**
 * The identity step. A visitor with no claimed racer is the common case, not an
 * edge case — this is the front door of the player view.
 *
 * "My racer" is derived, never stored: it is the participant whose claimedBy
 * equals this device's anonymous uid. There is no local copy to fall out of
 * step with the shared one.
 */
export default function MyRacerView({ raceId }: { raceId: string }) {
  const uid = useUid();
  const { live } = useLiveState(raceId);
  const { race } = useRace(raceId);
  const participants = useParticipants(raceId);
  const players = usePlayers();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which racer's sheet is open. Not a route: it is a transient overlay on this
  // subview, and a reload landing back on the list is the right behaviour.
  const [previewing, setPreviewing] = useState<PlayerId | null>(null);
  const [joinName, setJoinName] = useState("");

  async function run(action: () => Promise<void>, dismiss = true) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (dismiss) setPreviewing(null);
    } catch (e) {
      // A contested claim lands here. Say what happened — the list is already
      // streaming, so it has re-rendered with the truth by the time it is read.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!live) return <p className="p-4 text-neutral-400">Race not found.</p>;

  const order = live.positionOrder ?? [];
  const cars = assignCars(order, players);
  const retired = new Set(live.retired ?? []);
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  // Old races have no claimedBy anywhere, so everything is simply unclaimed.
  const mine = uid
    ? order.find((id) => participants.get(id)?.claimedBy === uid)
    : undefined;

  // Absent or disabled means no card at all — old races are untouched.
  const carStatus = race?.settings?.carStatus;
  const carStatusSpec = carStatus?.enabled ? carStatus.spec : undefined;

  const overviewFor = (id: PlayerId) => (
    <RacerOverview
      name={nameOf(id)}
      car={cars.get(id)}
      participant={participants.get(id)}
      retired={retired.has(id)}
      position={order.indexOf(id) + 1}
      carStatusSpec={carStatusSpec}
      busy={busy}
      // Anyone can change anyone's card, the same way anyone can reach across
      // the table. The claim decides whose shows up top, nothing more.
      onSetCarStatus={(key, value) =>
        run(
          () => setCarStatus(raceId, id, key, value, { source: "manual" }),
          false,
        )
      }
    />
  );

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xs uppercase tracking-widest text-neutral-500">
        My racer
      </h1>

      {mine ? (
        <>
          {overviewFor(mine)}
          <button
            onClick={() =>
              run(() =>
                releaseRacer(raceId, mine, uid!, { source: "manual" }),
              )
            }
            disabled={busy}
            className="rounded-2xl border border-neutral-700 py-4 text-lg active:bg-neutral-800 disabled:opacity-50"
          >
            Change racer
          </button>
        </>
      ) : (
        <>
          {order.length > 0 && (
            <p className="text-sm text-neutral-400">
              Which racer is yours? Tap one to have a look first.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {order.map((id) => {
              const car = cars.get(id);
              const claimed = !!participants.get(id)?.claimedBy;
              return (
                <li key={id}>
                  {/* Claimed racers stay visible but unselectable. Hiding them
                      makes a player think their friend is missing. */}
                  <button
                    onClick={() => setPreviewing(id)}
                    disabled={busy || claimed}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left ${
                      claimed
                        ? "border-neutral-900 text-neutral-600"
                        : "border-neutral-800 active:bg-neutral-800"
                    }`}
                  >
                    {car && (
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                        style={{
                          background: car.colour,
                          color: readableInk(car.colour),
                          opacity: claimed ? 0.35 : 1,
                        }}
                      >
                        {car.label}
                      </span>
                    )}
                    <span className="flex-1 text-lg">{nameOf(id)}</span>
                    {claimed && (
                      <span className="shrink-0 text-xs uppercase tracking-wide">
                        taken
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Alongside the list, and in place of it when the race has nobody
              in it — an empty list with no way to act is a dead end, and this
              is the first screen a player sees. */}
          <div className="flex flex-col gap-2 rounded-2xl border border-neutral-800 p-4">
            {/* The empty grid still needs a sentence — an empty list with no
                way to act is a dead end. A populated one doesn't: the field and
                the button say what they do. */}
            {order.length === 0 && (
              <p className="text-sm text-neutral-400">
                Nobody is racing yet. Put your name in.
              </p>
            )}
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 text-lg"
            />
            <button
              onClick={() =>
                run(async () => {
                  await joinRace(raceId, joinName, uid, { source: "manual" });
                  setJoinName("");
                })
              }
              disabled={busy || !joinName.trim()}
              className="rounded-2xl bg-emerald-600 py-4 text-lg font-semibold active:bg-emerald-700 disabled:opacity-40"
            >
              Add new racer
            </button>
          </div>
        </>
      )}

      {error && <p className="text-center text-red-500">{error}</p>}

      {previewing && (
        // A full-height sheet with a large dismiss target: this has to work
        // one-handed at phone width, so nothing here depends on hover and
        // nothing important sits at the top of the screen.
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/70">
          <div className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-5 pb-8">
            {overviewFor(previewing)}

            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() =>
                  run(() =>
                    claimRacer(
                      raceId,
                      previewing,
                      uid!,
                      { source: "manual" },
                      mine ?? null,
                    ),
                  )
                }
                disabled={busy || !uid}
                className="rounded-2xl bg-emerald-600 py-5 text-xl font-semibold active:bg-emerald-700 disabled:opacity-50"
              >
                Select racer
              </button>
              <button
                onClick={() => setPreviewing(null)}
                disabled={busy}
                className="rounded-2xl border border-neutral-700 py-5 text-lg text-neutral-400 active:bg-neutral-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
