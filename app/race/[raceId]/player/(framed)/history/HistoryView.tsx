"use client";

import { assignCars, readableInk } from "@/lib/cars";
import { useLiveState, usePlayers, useRaceEvents } from "@/lib/hooks";
import { formatRemaining } from "@/lib/timer";
import type { Car } from "@/lib/cars";
import type { PlayerId, RaceEvent, RaceSettingsChangedEvent } from "@/lib/types";

/**
 * The race event log, rendered as sentences, newest first.
 *
 * The log is the product — this is the first view that shows it as such. It is
 * read-only on purpose: corrections append rather than mutate, and the place
 * to make one is the results screen.
 */
export default function HistoryView({ raceId }: { raceId: string }) {
  const { events, loading } = useRaceEvents(raceId);
  const { live } = useLiveState(raceId);
  const players = usePlayers();

  // Derived from positionOrder, the same set the turn-order subview uses, so a
  // car reads identically on both screens. assignCars sorts internally, so
  // this does not reshuffle when someone overtakes.
  const cars = assignCars(live?.positionOrder ?? [], players);
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  // Corrections carry the id of what they correct. Resolving it here means a
  // correction can show what it is about instead of being an orphan line.
  const byId = new Map(events.map((e) => [e.id, e]));

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xs uppercase tracking-widest text-neutral-500">
        History — newest first
      </h1>

      {loading && <p className="text-neutral-500">Loading…</p>}
      {!loading && events.length === 0 && (
        <p className="text-neutral-500">Nothing has happened yet.</p>
      )}

      <ol className="flex flex-col gap-1">
        {events.map((event) => {
          const subject = subjectOf(event);
          const car = subject ? cars.get(subject) : undefined;
          const target =
            event.type === "correction" && event.targetEventId
              ? byId.get(event.targetEventId)
              : undefined;

          return (
            <li
              key={event.id}
              className="flex items-start gap-3 rounded border border-neutral-800 p-3"
            >
              <CarChip car={car} />

              <div className="min-w-0 flex-1">
                <p className="text-sm">{describe(event, nameOf)}</p>
                {target && (
                  <p className="mt-1 truncate text-xs text-neutral-500">
                    ↳ {describe(target, nameOf)}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-xs text-neutral-500">
                  {timeOf(event)}
                </span>
                {/* Chat-entered rows are the ones most likely to be wrong, and
                    the source field exists to keep them traceable. Manual is
                    the norm and would be noise. */}
                {event.source !== "manual" && (
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                    {event.source}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function CarChip({ car }: { car?: Car }) {
  if (!car) {
    return <span className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />;
  }
  return (
    <span
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold"
      style={{ background: car.colour, color: readableInk(car.colour) }}
    >
      {car.label}
    </span>
  );
}

/**
 * `at` is null until the server acknowledges the write, and the persistent
 * cache surfaces the write straight away — so every event this device appends
 * lands here without a timestamp for a moment.
 */
function timeOf(event: RaceEvent): string {
  if (!event.at) return "now";
  return event.at.toDate().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The car an event is about, if it is about one. */
function subjectOf(event: RaceEvent): PlayerId | null {
  switch (event.type) {
    case "turnAdvanced":
    case "turnRewound":
      return event.toPlayerId;
    case "lapCompleted":
    case "dnfChanged":
    case "playerRemoved":
    case "playerJoined":
    case "participantNoteSet":
    case "racerClaimed":
    case "racerReleased":
      return event.playerId;
    default:
      return null;
  }
}

/** A settings event carries only what changed, so read it back the same way. */
function describePatch(patch: RaceSettingsChangedEvent["patch"]): string {
  const parts: string[] = [];
  if (patch.track !== undefined) parts.push(`track is now ${patch.track}`);
  if (patch.location !== undefined) {
    parts.push(patch.location ? `played at ${patch.location}` : "location cleared");
  }
  if (patch.lapCount !== undefined) parts.push(`${patch.lapCount} laps`);
  if (patch.turnSeconds !== undefined) parts.push(`${patch.turnSeconds}s turns`);
  if (patch.scheduledAt !== undefined) {
    parts.push(`run on ${patch.scheduledAt.toDate().toLocaleDateString()}`);
  }
  if (patch.settings?.betweenRounds !== undefined) {
    parts.push(`between-rounds pause ${patch.settings.betweenRounds ? "on" : "off"}`);
  }
  if (patch.settings?.carStatus?.enabled !== undefined) {
    parts.push(`car status ${patch.settings.carStatus.enabled ? "on" : "off"}`);
  }
  return parts.join(", ");
}

/**
 * One sentence per event variant.
 *
 * The switch is exhaustive and the `never` assignment at the end enforces it:
 * adding a variant to RaceEvent without describing it here fails
 * `npx tsc --noEmit` rather than rendering a blank line at the table. That is
 * the point of the union.
 */
function describe(event: RaceEvent, nameOf: (id: PlayerId) => string): string {
  const list = (ids: PlayerId[]) => ids.map(nameOf).join(", ");

  switch (event.type) {
    case "raceCreated":
      return `Race created at ${event.track}${
        event.location ? `, ${event.location}` : ""
      } — ${event.lapCount} laps, grid: ${list(event.order)}.`;
    case "raceStarted":
      return `The flag drops — grid: ${list(event.order)}.`;
    case "raceSettingsChanged":
      return `Settings changed: ${describePatch(event.patch)}.`;
    case "playerRemoved":
      return `${nameOf(event.playerId)} was taken off the grid.`;
    case "playerJoined":
      return `${event.name} joined the race, at the back.`;
    case "turnAdvanced":
      return `${nameOf(event.toPlayerId)} is up (round ${event.round}).`;
    case "roundStarted":
      return `Round ${event.round} began — order: ${list(event.order)}.`;
    case "roundEnded":
      return `Round ${event.round} ended — every car has moved.`;
    case "positionOrderChanged":
      return `Standings changed to ${list(event.order)}.`;
    case "lapCompleted":
      return `${nameOf(event.playerId)} completed lap ${event.lap}.`;
    case "dnfChanged":
      return event.dnf
        ? `${nameOf(event.playerId)} retired.`
        : `${nameOf(event.playerId)} is back in the race.`;
    case "participantNoteSet":
      return event.note
        ? `Note on ${nameOf(event.playerId)}: ${event.note}`
        : `Note on ${nameOf(event.playerId)} cleared.`;
    case "carStatusChanged":
      return `${nameOf(event.playerId)}: ${event.key} ${event.from} → ${event.to}.`;
    case "gearChanged":
      return event.to === null
        ? `${nameOf(event.playerId)} came out of gear.`
        : `${nameOf(event.playerId)} shifted to ${event.to}${event.from === null ? "" : ` (from ${event.from})`}.`;
    case "racerClaimed":
      return `${nameOf(event.playerId)} was claimed by a player's device.`;
    case "racerReleased":
      return `${nameOf(event.playerId)} was released.`;
    case "turnRewound":
      return `Turn stepped back to ${nameOf(event.toPlayerId)} (round ${event.round}) — clock reset and paused.`;
    case "turnPaused":
      return `Timer paused with ${formatRemaining(event.remainingMs)} left.`;
    case "turnResumed":
      return "Timer resumed.";
    case "raceFinished":
      return `Race finished — ${nameOf(event.order[0])} wins. Order: ${list(event.order)}${
        event.dnf.length > 0 ? `. Retired: ${list(event.dnf)}` : ""
      }.`;
    case "raceReopened":
      return `Race reopened — the result was ${list(event.order)}.`;
    case "raceResultAmended":
      return `Result amended — ${nameOf(event.order[0])} wins. Order: ${list(event.order)}${
        event.dnf.length > 0 ? `. Retired: ${list(event.dnf)}` : ""
      }.${event.note ? ` (${event.note})` : ""}`;
    case "correction":
      return `Correction: ${event.note}`;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
