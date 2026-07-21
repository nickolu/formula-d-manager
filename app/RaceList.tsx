"use client";

import Link from "next/link";
import { useRaces } from "@/lib/hooks";

export default function RaceList() {
  const races = useRaces();

  if (races.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-xl font-medium">Races</h2>
      <ul className="mt-4 flex flex-col gap-2">
        {races.map((race) => (
          <li
            key={race.id}
            className="flex items-center justify-between rounded border border-neutral-800 p-3"
          >
            <span>
              {race.track}
              <span className="ml-2 text-sm text-neutral-500">{race.status}</span>
            </span>
            <span className="flex gap-4 text-sm">
              <Link href={`/race/${race.id}/device`} className="text-emerald-500">
                device
              </Link>
              <Link href={`/race/${race.id}/screen`} className="text-emerald-500">
                screen
              </Link>
              <Link href={`/race/${race.id}/edit`} className="text-emerald-500">
                edit
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
