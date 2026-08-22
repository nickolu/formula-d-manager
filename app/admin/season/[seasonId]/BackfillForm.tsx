"use client";

import { useMemo, useState } from "react";
import ReorderableList from "@/app/ReorderableList";
import { usePlayers, useSeasonMembers } from "@/lib/hooks";
import { backfillRace } from "@/lib/setup";
import type { PlayerId } from "@/lib/types";

/**
 * A race the app never timed, entered after the fact.
 *
 * Drawn from the roster and ordered by dragging, the same as the new-race form
 * — except the order here is the *finishing* order, not the grid. The date is
 * required and is the point of the whole form: without it every backfilled race
 * would sort to today and scramble the season.
 */
export default function BackfillForm({ seasonId }: { seasonId: string }) {
  const { members } = useSeasonMembers(seasonId);
  const players = usePlayers();

  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState("");
  const [date, setDate] = useState("");
  const [order, setOrder] = useState<PlayerId[]>([]);
  const [absent, setAbsent] = useState<Set<PlayerId>>(new Set());
  const [dnf, setDnf] = useState<Set<PlayerId>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const rosterIds = useMemo(
    () => members.map((m) => m.playerId).sort(),
    [members],
  );

  // Derived from the roster, not synchronized with it — same as NewRaceForm.
  const listed = useMemo(() => {
    const roster = new Set(rosterIds);
    const placed = order.filter((id) => roster.has(id));
    const seen = new Set(placed);
    return [...placed, ...rosterIds.filter((id) => !seen.has(id))];
  }, [order, rosterIds]);

  const ran = listed.filter((id) => !absent.has(id));
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  function toggle(set: Set<PlayerId>, id: PlayerId) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  async function submit() {
    setBusy(true);
    setStatus(null);
    try {
      // The date input gives a bare "YYYY-MM-DD", which `new Date()` reads as
      // UTC midnight — an evening race in a western timezone would land on the
      // day before. Split it so it means midnight *here*.
      const [y, m, d] = date.split("-").map(Number);
      await backfillRace({
        seasonId,
        track: track.trim() || "Untitled track",
        scheduledAt: new Date(y, m - 1, d),
        playerNames: ran.map(nameOf),
        dnfNames: ran.filter((id) => dnf.has(id)).map(nameOf),
      });
      setStatus(`${track || "Race"} added`);
      setTrack("");
      setDate("");
      setDnf(new Set());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-6 w-full rounded border border-neutral-800 py-3 text-sm text-neutral-400"
      >
        Backfill a past race
      </button>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4 rounded border border-neutral-800 p-4">
      <h3 className="text-lg font-medium">Backfill a past race</h3>
      <p className="text-sm text-neutral-400">
        For a race played before this existed. It is created already finished,
        on the date you give — which is what keeps the season in the order it
        was actually run.
      </p>

      <div className="flex flex-wrap gap-4">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Track</span>
          <input
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            className="rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Date run</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-neutral-500">
          Finishing order, winner first. Tap a name to leave them out; tap DNF if
          they retired.
        </span>
        {listed.length === 0 ? (
          <p className="rounded border border-neutral-800 p-4 text-sm text-neutral-400">
            Nobody in the league yet — add the roster first.
          </p>
        ) : (
          <ReorderableList
            items={listed}
            disabled={busy}
            onReorder={setOrder}
            renderRow={(id) => {
              const out = absent.has(id);
              return (
                <div
                  className={`flex items-center gap-2 rounded border p-3 ${
                    out ? "border-neutral-900 text-neutral-600" : "border-neutral-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setAbsent((s) => toggle(s, id))}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="w-5 text-neutral-500">
                      {out ? "—" : ran.indexOf(id) + 1}
                    </span>
                    <span className="min-w-0 truncate">{nameOf(id)}</span>
                  </button>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => setDnf((s) => toggle(s, id))}
                    aria-pressed={dnf.has(id)}
                    className={`shrink-0 rounded border px-3 py-1 text-xs disabled:opacity-30 ${
                      dnf.has(id)
                        ? "border-red-700 bg-red-950 text-red-300"
                        : "border-neutral-800 text-neutral-500"
                    }`}
                  >
                    DNF
                  </button>
                </div>
              );
            }}
          />
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          disabled={busy}
          className="flex-1 rounded border border-neutral-700 py-3 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !date || ran.length === 0}
          className="flex-1 rounded bg-emerald-600 py-3 font-medium disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add finished race"}
        </button>
      </div>

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </div>
  );
}
