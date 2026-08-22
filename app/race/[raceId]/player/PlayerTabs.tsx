"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A bottom tab bar, fixed. Thumb-reachable on a phone — a top tab bar is not —
 * and it survives the page scrolling.
 *
 * Only subviews that exist get a tab — a tab leading to a 404 is worse than no
 * tab. Four fit at phone width; a fifth would need an overflow.
 */
const TABS = [
  { segment: "", label: "Turn order" },
  { segment: "my-racer", label: "My racer" },
  { segment: "history", label: "History" },
  { segment: "settings", label: "Settings" },
];

export default function PlayerTabs({ raceId }: { raceId: string }) {
  const pathname = usePathname();
  const base = `/race/${raceId}/player`;

  // The segment the URL is actually on — "" for the default subview. Reading
  // it from the path rather than tracking state is what keeps a cold load and
  // a reload land on the right tab.
  const current = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "").split("/")[0]
    : "";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-800 bg-neutral-950/95 backdrop-blur">
      {TABS.map((tab) => {
        const active = current === tab.segment;
        return (
          <Link
            key={tab.segment}
            href={tab.segment ? `${base}/${tab.segment}` : base}
            aria-current={active ? "page" : undefined}
            className={`flex-1 py-5 text-center text-sm font-medium ${
              active
                ? "border-t-2 border-emerald-500 -mt-px text-white"
                : "text-neutral-500 active:bg-neutral-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
