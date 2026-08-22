"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The season's subviews, as one tab bar.
 *
 * They were loose text links beside the season name — "standings", "teams" —
 * which read as decoration rather than as the three places a player can be.
 *
 * A **top** bar, unlike `PlayerTabs`. That one is fixed to the bottom because
 * it is operated mid-game with a thumb; these pages are browsed between game
 * nights, and a bar pinned over the standings table would cost a row of it for
 * nothing.
 *
 * Teams is deliberately not a tab. The team panel needs to know who *you* are,
 * which is the claim, so it lives inside Racer — a Team tab would open on
 * "pick your racer first", which is the Racer screen with extra steps. That is
 * the same reasoning that keeps it out of the in-race tab bar.
 */
export default function SeasonTabs({
  seasonId,
  /** Where "Races" goes. `/` on the root, so the landing keeps its own URL. */
  racesHref,
}: {
  seasonId: string;
  racesHref: string;
}) {
  const pathname = usePathname();
  const base = `/season/${seasonId}`;
  const tabs = [
    { href: racesHref, label: "Races", match: [racesHref, base] },
    { href: `${base}/racer`, label: "Racer", match: [`${base}/racer`] },
    {
      href: `${base}/standings`,
      label: "Standings",
      match: [`${base}/standings`],
    },
  ];

  return (
    <nav className="mt-4 flex border-b border-neutral-800">
      {tabs.map((tab) => {
        // From the path rather than from state, which is what makes a cold
        // load and a reload land on the right tab.
        const active = tab.match.includes(pathname);
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 py-3 text-center text-sm font-medium ${
              active
                ? "-mb-px border-b-2 border-emerald-500 text-white"
                : "text-neutral-500 active:text-neutral-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
