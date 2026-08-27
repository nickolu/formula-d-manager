"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AddMember from "@/app/AddMember";
import ReorderableList from "@/app/ReorderableList";
import { usePlayers, useSeasonMembers } from "@/lib/hooks";
import { createRace } from "@/lib/setup";
import type { PlayerId } from "@/lib/types";

/**
 * A race is drawn from the season roster, not typed into a textarea.
 *
 * The roster answers "who is in this league"; this form answers "who is at the
 * table tonight, and in what order". So it is a checklist you uncheck absentees
 * from, plus a drag handle for grid order — Ken skipping a week is one tap and
 * does not touch his membership.
 *
 * Scoped to a season because a race must belong to one: createRace verifies the
 * id rather than defaulting it.
 */
export default function NewRaceForm({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const { members, loading } = useSeasonMembers(seasonId);
  const players = usePlayers();

  // Collapsed by default. See the early return below for why.
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState("");
  const [location, setLocation] = useState("");
  // Defaults to today, which is what a race being set up at the table is.
  const [date, setDate] = useState(() => todayInput());
  const [lapCount, setLapCount] = useState(2);
  const [turnSeconds, setTurnSeconds] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grid order and absentees, held apart from the roster itself. `order` only
  // records what has been dragged; anyone the roster gains afterwards falls in
  // at the bottom, and `absent` is the exception list so a new member arrives
  // checked rather than silently left off.
  const [order, setOrder] = useState<PlayerId[]>([]);
  const [absent, setAbsent] = useState<Set<PlayerId>>(new Set());

  const rosterIds = useMemo(
    () => members.map((m) => m.playerId).sort(),
    [members],
  );

  // Derived, not synchronized: the displayed order is the dragged order
  // intersected with the roster, plus whatever the roster has that it doesn't.
  // No effect, so a member added on another phone appears without a re-render
  // fight over who owns the list.
  const grid = useMemo(() => {
    const roster = new Set(rosterIds);
    const placed = order.filter((id) => roster.has(id));
    const seen = new Set(placed);
    return [...placed, ...rosterIds.filter((id) => !seen.has(id))];
  }, [order, rosterIds]);

  const racing = grid.filter((id) => !absent.has(id));
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  function toggle(id: PlayerId) {
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raceId = await createRace({
        track: track.trim() || "Untitled track",
        location,
        scheduledAt: scheduledFrom(date),
        lapCount,
        turnSeconds,
        // Names rather than ids, because ids are name slugs — createRace slugs
        // them straight back to the same players.
        playerNames: racing.map(nameOf),
        seasonId,
      });
      // The commissioner's side, not the player's. Creating a race is
      // commissioner work and it is rarely the last of it — the grid usually
      // wants a nudge before the flag drops, and the track or the turn length
      // is often typed wrong the first time. Landing on the player view meant
      // reaching all of that by going back and finding the race again in a
      // list you were standing on a moment ago.
      //
      // Race settings rather than back to /admin/season/:seasonId: it is the
      // screen for the thing that was just made, and it renders Nav, so the
      // player view — where Start race lives — is one tap from it.
      router.push(`/race/${raceId}/settings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  // Collapsed by default, the same as the backfill form below it.
  //
  // This form is the longest thing on the page — track, location, date, laps,
  // turn length, the whole roster as a drag list, and an add-a-member box — and
  // it is opened once a week, while the race list above it is what the page is
  // usually reached for. Open, it pushed the backfill form and everything after
  // it off the bottom of a phone.
  //
  // The component stays mounted while it is shut, so a half-filled form
  // survives a mis-tap on Cancel, and the roster listener stays open — which
  // is what makes opening it instant rather than a flash of "Loading the
  // roster…".
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 w-full rounded border border-emerald-900 py-3 text-sm text-emerald-500 active:bg-emerald-950/40"
      >
        + New race
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <h3 className="text-lg font-medium">New race</h3>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-500">Track</span>
        <input
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          className="rounded border border-neutral-700 bg-transparent p-2"
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Nick's"
            className="w-full rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
      </div>

      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Laps</span>
          <input
            type="number"
            min={1}
            value={lapCount}
            onChange={(e) => setLapCount(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm text-neutral-500">Turn seconds</span>
          <input
            type="number"
            min={10}
            value={turnSeconds}
            onChange={(e) => setTurnSeconds(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-neutral-500">
          Who is racing, front of the grid first
        </span>

        {loading ? (
          <p className="text-neutral-500">Loading the roster…</p>
        ) : grid.length === 0 ? (
          <p className="rounded border border-neutral-800 p-4 text-sm text-neutral-400">
            Nobody in the league yet. Add someone below and they will be here
            next time too — the roster belongs to the season, not to one race.
          </p>
        ) : (
          <ReorderableList
            items={grid}
            disabled={busy}
            onReorder={setOrder}
            renderRow={(id) => {
              const out = absent.has(id);
              return (
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-pressed={!out}
                  className={`flex w-full items-center gap-3 rounded border p-3 text-left ${
                    out
                      ? "border-neutral-900 text-neutral-600"
                      : "border-neutral-800"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs ${
                      out
                        ? "border-neutral-800 text-transparent"
                        : "border-emerald-600 bg-emerald-600 text-white"
                    }`}
                  >
                    ✓
                  </span>
                  {/* The number is the grid slot, so absentees carry none —
                      counting them would make the third row say "4". */}
                  <span className="w-5 text-neutral-500">
                    {out ? "—" : racing.indexOf(id) + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                </button>
              );
            }}
          />
        )}

        <AddMember seasonId={seasonId} label="Someone new at the table" />
      </div>

      <div className="flex gap-2">
        {/* type="button" is load-bearing: a <button> with no type inside a
            <form> is a submit button, and this one would create the race. */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded border border-neutral-700 px-5 py-3 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || racing.length === 0}
          className="flex-1 rounded bg-emerald-600 py-3 text-lg font-medium disabled:opacity-50"
        >
          {busy ? "Creating…" : `Create race (${racing.length})`}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}
    </form>
  );
}

/** Today as the local YYYY-MM-DD an <input type="date"> expects. */
function todayInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The chosen day as a Date.
 *
 * When it is today, that means *now* rather than midnight: a race set up at the
 * table is happening at the table, and stamping it 00:00 would tie it with
 * anything else created the same day for ordering. Built from the parts rather
 * than `new Date(value)`, which reads a bare YYYY-MM-DD as UTC midnight.
 */
function scheduledFrom(value: string): Date | undefined {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const now = new Date();
  const isToday =
    y === now.getFullYear() && m === now.getMonth() + 1 && d === now.getDate();
  return isToday ? now : new Date(y, m - 1, d);
}
