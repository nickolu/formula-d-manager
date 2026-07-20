/**
 * Races created before turn order was split into positionOrder/roundOrder have
 * no usable live state. There's no sensible migration — the old model recorded
 * a single fixed rotation, which can't be reconstructed into standings plus a
 * frozen round order — so say so plainly rather than crashing on undefined.
 */
export default function StaleRace() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xl">This race predates the round-order change.</p>
      <p className="max-w-md text-neutral-500">
        It was stored as a single fixed turn rotation, which Formula D doesn&apos;t
        actually use. Start a new race — the old one can be deleted from the
        Firebase console.
      </p>
    </main>
  );
}
