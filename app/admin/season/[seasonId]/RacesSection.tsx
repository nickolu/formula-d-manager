"use client";

import NewRaceForm from "@/app/NewRaceForm";
import RaceList from "@/app/RaceList";
import BackfillForm from "./BackfillForm";

/**
 * The season's races.
 *
 * The list comes first because arriving here mid-season usually means reaching
 * for a race that already exists; setting one up is a once-a-week act worth a
 * scroll. Backfill sits below both, collapsed — it is for history, not tonight.
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
