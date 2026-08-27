"use client";

import NewRaceForm from "@/app/NewRaceForm";
import RaceList from "@/app/RaceList";
import BackfillForm from "./BackfillForm";

/**
 * The season's races.
 *
 * The list comes first because arriving here mid-season usually means reaching
 * for a race that already exists. Both forms below it are **collapsed**, for
 * the same reason: each is a screen's worth of inputs used once a week, and
 * open by default they pushed everything after them off the bottom of a phone.
 * Setting up tonight's race is one tap; backfilling history is one tap and
 * further down.
 */
export default function RacesSection({ seasonId }: { seasonId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <RaceList variant="admin" seasonId={seasonId} />
      <NewRaceForm seasonId={seasonId} />
      <BackfillForm seasonId={seasonId} />
    </div>
  );
}
