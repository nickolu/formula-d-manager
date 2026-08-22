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
  section = "player",
}: {
  raceId?: string;
  /**
   * The season pages pass false: `SeasonTabs` sits directly below this bar and
   * already has a Standings tab, so the link here was the same destination
   * twice, a centimetre apart.
   */
  standings?: boolean;
  /**
   * Which half of the app this page belongs to. The bar offers the *other*
   * one, so it is never a link to where you already are — "admin" sat there
   * doing nothing on every admin page.
   */
  section?: "player" | "admin";
}) {
  return (
    <nav className="mb-6 flex items-baseline justify-between border-b border-neutral-800 pb-3">
      <Link href="/" className="font-semibold">
        Formula D
      </Link>
      <span className="flex gap-4 text-sm text-emerald-500">
        {standings && <Link href="/standings">standings</Link>}
        {/* The two halves of the app, and the bar always points at the one you
            are not in. `/admin` has no other way in — nothing hides it, because
            there is no auth to hide it behind yet. */}
        {section === "admin" ? (
          <Link href="/">player view</Link>
        ) : (
          <Link href="/admin">admin</Link>
        )}
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
