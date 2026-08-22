"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSeasons } from "@/lib/hooks";
import { createSeason } from "@/lib/seasons";
import type { Season } from "@/lib/types";

/**
 * The commissioner's top level: which seasons exist, and a way to make another.
 *
 * The new-race form used to live here. It moved down a level because a race
 * must belong to a season now — createRace verifies the id rather than
 * defaulting it to "default" against a document that might not exist.
 */
export default function SeasonsAdmin() {
  const { seasons, loading } = useSeasons();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const seasonId = await createSeason({ name }, { source: "manual" });
      router.push(`/admin/season/${seasonId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  // Absent means active — archived seasons drop out of the working list rather
  // than disappearing, because their standings stay reachable.
  const active = seasons.filter((s) => !s.archived);
  const archived = seasons.filter((s) => s.archived);

  return (
    <div className="mt-8 flex flex-col gap-10">
      {/* The list first: arriving here usually means reaching for a season that
          already exists. Making one is a once-a-year act, and it sits below. */}
      <section>
        {loading ? (
          <p className="text-neutral-500">Loading seasons…</p>
        ) : active.length === 0 && archived.length === 0 ? (
          <p className="rounded border border-neutral-800 p-4 text-neutral-400">
            No seasons yet. A race has to belong to one, so make a season first.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((season) => (
              <SeasonRow key={season.id} season={season} />
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="mt-4 rounded border border-neutral-800">
            <summary className="cursor-pointer select-none p-3 text-sm uppercase tracking-widest text-neutral-500">
              Archived ({archived.length})
            </summary>
            <ul className="flex flex-col gap-2 p-3 pt-0">
              {archived.map((season) => (
                <SeasonRow key={season.id} season={season} muted />
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-900 pt-8">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          New season
        </h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              submit();
            }}
            placeholder="Season 2"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-transparent p-3"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="rounded bg-emerald-600 px-5 font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Scoring starts from the house table and is editable on the season
          page — it is data, not code, so changing it never needs a deploy.
        </p>
        {error && <p className="text-red-500">{error}</p>}
      </section>
    </div>
  );
}

function SeasonRow({ season, muted = false }: { season: Season; muted?: boolean }) {
  return (
    <li>
      <Link
        href={`/admin/season/${season.id}`}
        className={`flex items-center justify-between gap-3 rounded border p-3 active:bg-neutral-800 ${
          muted ? "border-neutral-800 text-neutral-400" : "border-neutral-700"
        }`}
      >
        <span>{season.name}</span>
        <span className="text-sm text-emerald-500">manage</span>
      </Link>
    </li>
  );
}
