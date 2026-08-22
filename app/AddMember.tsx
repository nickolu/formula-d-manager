"use client";

import { useState } from "react";
import { addSeasonMember } from "@/lib/seasons";

/**
 * One field that puts a new racer in the league.
 *
 * Shared by the roster section and the new-race form, because a new player
 * turning up is normal and making the commissioner visit two screens for it is
 * not. Adding from either place goes through `addSeasonMember`, which also
 * joins them to every race in the season that has not been sealed — and
 * deliberately touches no finished race.
 */
export default function AddMember({
  seasonId,
  label = "Add someone to the league",
}: {
  seasonId: string;
  label?: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addSeasonMember(seasonId, name, { source: "manual" });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={label}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-transparent p-3"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded border border-neutral-700 px-4 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
