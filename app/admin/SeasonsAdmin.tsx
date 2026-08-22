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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
    <div className="mt-8 flex flex-col gap-8">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">New season</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Season 2"
            className="flex-1 rounded border border-neutral-700 bg-transparent p-2"
          />
          <button
            type="submit"
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
      </form>

      <section>
        <h2 className="text-xl font-medium">Seasons</h2>
        {loading ? (
          <p className="mt-4 text-neutral-500">Loading seasons…</p>
        ) : active.length === 0 && archived.length === 0 ? (
          <p className="mt-4 rounded border border-neutral-800 p-4 text-neutral-400">
            No seasons yet. A race has to belong to one, so make a season first.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {active.map((season) => (
              <SeasonRow key={season.id} season={season} />
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="mt-6 rounded border border-neutral-800">
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
