"use client";

import { readableInk, type Car } from "@/lib/cars";
import type { CarStatusProperty, GearRange, Participant } from "@/lib/types";
import CarStatusCard from "./CarStatusCard";

/**
 * One racer, read back in full: who they are, where they started, how far they
 * have got, and whatever was written about their race.
 *
 * Shared by the claimed state and the tap-a-racer sheet, so a rival's card
 * reads exactly like your own — which is the point of being able to check it.
 */
export default function RacerOverview({
  name,
  car,
  participant,
  retired,
  position,
  carStatusSpec,
  onSetCarStatus,
  gears,
  onSetGear,
}: {
  name: string;
  car?: Car;
  participant?: Participant;
  retired: boolean;
  /** Live standings position, 1-based. */
  position: number;
  /** Absent when the race has car status switched off. */
  carStatusSpec?: CarStatusProperty[];
  onSetCarStatus?: (key: string, value: number) => Promise<void>;
  gears?: GearRange[];
  onSetGear?: (gear: number | null) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {car && (
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold"
            style={{ background: car.colour, color: readableInk(car.colour) }}
          >
            {car.label}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold">{name}</p>
          {retired && (
            <p className="mt-1 inline-block rounded bg-red-950/60 px-2 py-0.5 text-xs uppercase tracking-wide text-red-400">
              Retired
            </p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Position" value={String(position)} />
        <Stat label="Started" value={String(participant?.startPosition ?? "—")} />
        <Stat label="Laps" value={String(participant?.lapsCompleted ?? 0)} />
      </dl>

      {carStatusSpec &&
        carStatusSpec.length > 0 &&
        onSetCarStatus &&
        gears &&
        onSetGear && (
          <div className="rounded-xl border border-neutral-800 p-3">
            <p className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
              Car
            </p>
            <CarStatusCard
              spec={carStatusSpec}
              values={participant?.carStatus}
              onSet={onSetCarStatus}
              gears={gears}
              gear={participant?.gear ?? null}
              onSetGear={onSetGear}
            />
          </div>
        )}

      {participant?.note && (
        <div className="rounded-xl border border-neutral-800 p-3">
          <p className="text-xs uppercase tracking-widest text-neutral-500">
            {retired ? "Reason" : "Note"}
          </p>
          <p className="mt-1 text-sm">{participant.note}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 p-3">
      <dt className="text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
