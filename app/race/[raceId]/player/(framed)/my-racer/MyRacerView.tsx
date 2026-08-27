"use client";

import { useState } from "react";
import { assignCars, readableInk } from "@/lib/cars";
import {
  useLiveState,
  useParticipants,
  usePlayers,
  useRace,
  useSeasonMembers,
  useUid,
} from "@/lib/hooks";
import {
  claimRacer,
  joinRace,
  releaseRacer,
  setCarStatus,
  setGear,
} from "@/lib/race";
import {
  addSeasonMember,
  claimSeasonRacer,
  releaseSeasonRacer,
} from "@/lib/seasons";
import { carStatusSpecFor, gearsFor } from "@/lib/setup";
import type { PlayerId } from "@/lib/types";
import TeamPanel from "@/app/TeamPanel";
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
  const { members } = useSeasonMembers(race?.seasonId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which racer's sheet is open. Not a route: it is a transient overlay on this
  // subview, and a reload landing back on the list is the right behaviour.
  const [previewing, setPreviewing] = useState<PlayerId | null>(null);
  const [joinName, setJoinName] = useState("");

  /**
   * For changes that render themselves optimistically: no busy flag, so
   * nothing on screen dims while the write is in flight.
   *
   * Reports the failure and then **rethrows**, which matters — the card undoes
   * its optimistic change by catching this. Swallowing it here would leave the
   * card showing a value that was never written.
   */
  async function runReported(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /**
   * The season claim is a **default for the next race, not a second source of
   * truth** — participants/{id}.claimedBy is what "my racer" is derived from,
   * and it has already been written by the time this runs. So a failure here is
   * swallowed: the player's tap worked, and telling them "someone else has that
   * racer" when the racer is visibly theirs would be a lie about what happened.
   * The worst case is that next week's race seeds nothing and they tap again.
   */
  async function rememberForSeason(action: () => Promise<void>) {
    if (!race?.seasonId) return;
    try {
      await action();
    } catch {
      // Deliberately silent — see above.
    }
  }

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
  const claimedHere = uid
    ? order.find((id) => participants.get(id)?.claimedBy === uid)
    : undefined;

  /**
   * The racer this device holds for the season, used only when nothing is
   * claimed in this race.
   *
   * `createRace` and `joinRace` seed the participant from the season claim, but
   * a race that already existed when you picked has nothing seeded — and this
   * screen would then ask you to pick again, which is exactly the thing picking
   * at the season level was supposed to stop.
   *
   * Derived, not written: nothing claims on render. And only when that
   * participant is **unclaimed here** — if another phone has taken them in this
   * race, the in-race claim wins, which is the whole point of it being
   * authoritative and re-tappable.
   */
  const seasonRacer = uid
    ? (members.find((m) => m.claimedBy === uid)?.playerId ?? null)
    : null;
  const mine =
    claimedHere ??
    (seasonRacer &&
    order.includes(seasonRacer) &&
    !participants.get(seasonRacer)?.claimedBy
      ? seasonRacer
      : undefined);

  // `enabled` is the only switch. The spec falls back to the default, because a
  // race created before the card existed has none — switching it on would
  // otherwise appear to do nothing at all.
  const cardOn = race?.settings?.carStatus?.enabled ?? false;
  const carStatusSpec = cardOn ? carStatusSpecFor(race) : undefined;
  const gears = cardOn ? gearsFor(race) : undefined;

  const overviewFor = (id: PlayerId) => (
    <RacerOverview
      name={nameOf(id)}
      car={cars.get(id)}
      participant={participants.get(id)}
      retired={retired.has(id)}
      position={order.indexOf(id) + 1}
      carStatusSpec={carStatusSpec}
      // Anyone can change anyone's card, the same way anyone can reach across
      // the table. The claim decides whose shows up top, nothing more.
      //
      // runReported, not run: a card edit must not raise the busy flag. The
      // card renders the change immediately and reverts itself if the write
      // fails, so dimming the screen around it would only make a tap feel slow.
      onSetCarStatus={(key, value) =>
        runReported(() =>
          setCarStatus(raceId, id, key, value, { source: "manual" }),
        )
      }
      gears={gears}
      onSetGear={(gear) =>
        runReported(() => setGear(raceId, id, gear, { source: "manual" }))
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
              run(async () => {
                await releaseRacer(raceId, mine, uid!, { source: "manual" });
                await rememberForSeason(() =>
                  releaseSeasonRacer(race!.seasonId, mine, uid!, {
                    source: "manual",
                  }),
                );
              })
            }
            disabled={busy}
            className="rounded-2xl border border-neutral-700 py-4 text-lg active:bg-neutral-800 disabled:opacity-50"
          >
            Change racer
          </button>

          {/* Below the car card rather than in a fourth tab: the panel has to
              know who you are, and that is the claim. A standalone Team tab
              would open on "claim a racer first" — this screen, with extra
              steps. It renders nothing at all when teams are off. */}
          {race?.seasonId && (
            <TeamPanel
              seasonId={race.seasonId}
              playerId={mine}
              race={{ positionOrder: order, participants, retired }}
            />
          )}
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
                  const id = await joinRace(raceId, joinName, uid, {
                    source: "manual",
                  });
                  setJoinName("");
                  // Someone who turns up and puts their name in has joined the
                  // league, not just tonight's race — otherwise they would be
                  // absent from the roster the commissioner builds next week's
                  // grid from. Best-effort: the join already worked, and
                  // addSeasonMember skips a race they are already on.
                  await rememberForSeason(async () => {
                    await addSeasonMember(race!.seasonId, joinName, {
                      source: "manual",
                    });
                    if (uid) {
                      await claimSeasonRacer(race!.seasonId, id, uid, null, {
                        source: "manual",
                      });
                    }
                  });
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
                  run(async () => {
                    await claimRacer(
                      raceId,
                      previewing,
                      uid!,
                      { source: "manual" },
                      mine ?? null,
                    );
                    // Claim once a season rather than every game night. The
                    // in-race claim above is the authority; this only seeds the
                    // next race's participants.
                    await rememberForSeason(() =>
                      claimSeasonRacer(
                        race!.seasonId,
                        previewing,
                        uid!,
                        mine ?? null,
                        { source: "manual" },
                      ),
                    );
                  })
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
