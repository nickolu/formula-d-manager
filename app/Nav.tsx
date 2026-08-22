import Link from "next/link";

/**
 * Opt-in rather than rendered from layout.tsx, on purpose: the big screen and
 * the tablet must stay chrome-free. The screen is read from across a room and
 * the player view's buttons are sized for a thumb at arm's length — neither
 * wants a nav bar, and putting this in the layout would give both one.
 */
export default function Nav({
  raceId,
  standings = true,
}: {
  raceId?: string;
  /**
   * The season pages pass false: `SeasonTabs` sits directly below this bar and
   * already has a Standings tab, so the link here was the same destination
   * twice, a centimetre apart.
   */
  standings?: boolean;
}) {
  return (
    <nav className="mb-6 flex items-baseline justify-between border-b border-neutral-800 pb-3">
      <Link href="/" className="font-semibold">
        Formula D
      </Link>
      <span className="flex gap-4 text-sm text-emerald-500">
        {standings && <Link href="/standings">standings</Link>}
        {/* The only way to find /admin. Nothing hides it — there is no auth to
            hide it behind yet. */}
        <Link href="/admin">admin</Link>
        {raceId && (
          <>
            <Link href={`/race/${raceId}/player`}>player</Link>
            <Link href={`/race/${raceId}/screen`}>screen</Link>
          </>
        )}
      </span>
    </nav>
  );
}
