"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createRace } from "@/lib/setup";

export default function NewRaceForm() {
  const router = useRouter();
  const [track, setTrack] = useState("");
  const [lapCount, setLapCount] = useState(2);
  const [turnSeconds, setTurnSeconds] = useState(90);
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raceId = await createRace({
        track: track.trim() || "Untitled track",
        lapCount,
        turnSeconds,
        playerNames: names.split("\n"),
      });
      router.push(`/race/${raceId}/device`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
      <h2 className="text-xl font-medium">New race</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-500">Track</span>
        <input
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          className="rounded border border-neutral-700 bg-transparent p-2"
        />
      </label>

      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Laps</span>
          <input
            type="number"
            min={1}
            value={lapCount}
            onChange={(e) => setLapCount(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Turn seconds</span>
          <input
            type="number"
            min={10}
            value={turnSeconds}
            onChange={(e) => setTurnSeconds(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-500">
          Players, one per line, in starting grid order
        </span>
        <textarea
          value={names}
          onChange={(e) => setNames(e.target.value)}
          rows={7}
          placeholder={"Nick\nJames\nKen\nSarah"}
          className="rounded border border-neutral-700 bg-transparent p-2 font-mono"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-emerald-600 py-3 text-lg font-medium disabled:opacity-50"
      >
        {busy ? "Creating…" : "Start race"}
      </button>

      {error && <p className="text-red-500">{error}</p>}
    </form>
  );
}
