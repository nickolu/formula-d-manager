"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/app/Nav";
import { useSeason } from "@/lib/hooks";

/**
 * Which sections exist. Only ones that do get a tab — a tab leading to a 404 is
 * worse than no tab, the same rule PlayerTabs follows.
 */
const TABS = [
  { segment: "", label: "Races" },
  { segment: "roster", label: "Roster" },
  { segment: "teams", label: "Teams" },
  { segment: "scoring", label: "Scoring" },
  { segment: "settings", label: "Settings" },
];

export default function SeasonAdminShell({
  seasonId,
  children,
}: {
  seasonId: string;
  children: React.ReactNode;
}) {
  const { season, loading } = useSeason(seasonId);
  const pathname = usePathname();
  const base = `/admin/season/${seasonId}`;

  // Read from the path rather than tracked in state, which is what makes a
  // cold load and a reload land on the right section.
  const current = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "").split("/")[0]
    : "";

  if (loading) return <p className="p-8 text-neutral-400">Connecting…</p>;

  if (!season) {
    return (
      <main className="mx-auto w-full max-w-3xl p-5 sm:p-8">
        <Nav standings={false} section="admin" />
        <p className="text-neutral-400">
          Season not found.{" "}
          <Link href="/admin" className="text-emerald-500">
            Back to admin
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-5 sm:p-8">
      <Nav standings={false} section="admin" />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-3xl font-semibold">{season.name}</h1>
        {season.archived && (
          <span className="text-xs uppercase tracking-widest text-neutral-500">
            archived
          </span>
        )}
        <Link href="/admin" className="ml-auto text-sm text-emerald-500">
          all seasons
        </Link>
      </div>

      {/* A top bar, not the player view's bottom one: this is a laptop surface
          read at desk distance, not a phone held at arm's length. It scrolls
          sideways rather than wrapping, so the row stays one row at 390px. */}
      <nav className="-mx-5 mt-5 overflow-x-auto border-b border-neutral-800 px-5 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const active = current === tab.segment;
            return (
              <Link
                key={tab.segment}
                href={tab.segment ? `${base}/${tab.segment}` : base}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium ${
                  active
                    ? "-mb-px border-b-2 border-emerald-500 text-white"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-6">{children}</div>
    </main>
  );
}
