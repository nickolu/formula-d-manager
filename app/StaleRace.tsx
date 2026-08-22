import Link from "next/link";

/**
 * Races created before turn order was split into positionOrder/roundOrder have
 * no usable live state. There's no sensible migration — the old model recorded
 * a single fixed rotation, which can't be reconstructed into standings plus a
 * frozen round order — so say so plainly rather than crashing on undefined.
 *
 * It used to send people to the Firebase console, which was wrong twice over:
 * such a race cannot be finished, and deleteRace refused anything unfinished,
 * so it was genuinely undeletable in the app. Both ends are fixed — the rule
 * now carves out a race that can never be finished — and this points at the
 * screen that does it.
 */
export default function StaleRace({ raceId }: { raceId?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xl">This race predates the round-order change.</p>
      <p className="max-w-md text-neutral-500">
        It was stored as a single fixed turn rotation, which Formula D
        doesn&apos;t actually use, so there is nothing here to show. Start a new
        race — this one can be deleted from its settings.
      </p>
      {raceId && (
        <Link
          href={`/race/${raceId}/settings`}
          className="mt-2 rounded-2xl border border-neutral-700 px-5 py-3 text-emerald-500"
        >
          Race settings
        </Link>
      )}
    </main>
  );
}
