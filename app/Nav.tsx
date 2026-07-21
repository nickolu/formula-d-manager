import Link from "next/link";

/**
 * Opt-in rather than rendered from layout.tsx, on purpose: the big screen and
 * the tablet must stay chrome-free. The screen is read from across a room and
 * the device's buttons are sized for a thumb at arm's length — neither wants a
 * nav bar, and putting this in the layout would give both one.
 */
export default function Nav({ raceId }: { raceId?: string }) {
  return (
    <nav className="mb-6 flex items-baseline justify-between border-b border-neutral-800 pb-3">
      <Link href="/" className="font-semibold">
        Formula D
      </Link>
      <span className="flex gap-4 text-sm text-emerald-500">
        <Link href="/standings">standings</Link>
        {raceId && (
          <>
            <Link href={`/race/${raceId}/device`}>device</Link>
            <Link href={`/race/${raceId}/screen`}>screen</Link>
          </>
        )}
      </span>
    </nav>
  );
}
