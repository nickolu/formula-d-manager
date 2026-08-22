"use client";

import { useState } from "react";
import { useSeason } from "@/lib/hooks";
import { updateSeason } from "@/lib/seasons";
import type { ScoringConfig } from "@/lib/types";

/**
 * The season's points table, finally editable outside the Firestore console.
 *
 * Every change goes through updateSeason, which writes the document and appends
 * a season event in one transaction. Nothing here writes a document directly.
 */
export default function ScoringSection({ seasonId }: { seasonId: string }) {
  const { season } = useSeason(seasonId);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Null until touched, so each field tracks the live document right up to the
  // first keystroke and then pins — the same trick the race settings view uses,
  // and it stops an incoming write yanking a half-typed value away.
  const [points, setPoints] = useState<string | null>(null);
  const [beyond, setBeyond] = useState<string | null>(null);

  if (!season) return null;

  const config = season.scoringConfig;
  const pointsValue = points ?? config.positionPoints.join(", ");
  const beyondValue = beyond ?? String(config.pointsBeyondTable);
  // Counted off the value being edited, not the saved one, so the sentence
  // below follows along as the list is typed.
  const places = pointsValue.split(",").map((n) => n.trim()).filter(Boolean).length;

  function parseScoring(): ScoringConfig {
    const positionPoints = pointsValue
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map(Number);
    // Caught here so the message names the offending field; lib/seasons.ts
    // validates again, because the chatbot will call it without a form.
    if (positionPoints.some((n) => !Number.isFinite(n))) {
      throw new Error("Position points must be numbers separated by commas");
    }
    return {
      positionPoints,
      pointsBeyondTable: Number(beyondValue),
    };
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await updateSeason(
        seasonId,
        { scoringConfig: parseScoring() },
        { source: "manual" },
      );
      setPoints(null);
      setBeyond(null);
      setStatus("Scoring saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-neutral-400">
        Standings are worked out from finished races every time they are shown,
        so editing this re-sorts the whole season — including races already run.
        That is the point: house rules can be re-argued against past seasons
        without touching a race.
      </p>

      <Field label="Points by position, first place first">
        <input
          value={pointsValue}
          onChange={(e) => setPoints(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 p-3 font-mono"
        />
      </Field>

      <Field label="Points for anyone finishing lower">
        <input
          inputMode="numeric"
          value={beyondValue}
          onChange={(e) => setBeyond(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 p-3"
        />
      </Field>
      {/* The label used to read "Beyond the table", which meant nothing unless
          you already knew "the table" was the list above. Say which places it
          actually covers, worked out from that list. */}
      <p className="-mt-2 text-xs text-neutral-500">
        {places === 0
          ? "Everyone, until the list above has some points in it."
          : `The list above covers ${places} ${places === 1 ? "place" : "places"}, so this is what ${ordinal(places + 1)} and below score.`}
      </p>

      {/* Said out loud because it otherwise reads as a bug: a retirement is
          scored, not zeroed. */}
      <p className="text-xs text-neutral-500">
        There is no separate DNF score. A car that retires is placed by when it
        went out — first one out finishes last — so its position already says
        what happened, and it scores whatever that position is worth.
      </p>

      <button
        disabled={busy}
        onClick={save}
        className="rounded-2xl bg-neutral-800 py-4 active:bg-neutral-700 disabled:opacity-50"
      >
        Save scoring
      </button>

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}

/** 1st, 2nd, 3rd, 4th… so the hint reads as a sentence rather than a number. */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
