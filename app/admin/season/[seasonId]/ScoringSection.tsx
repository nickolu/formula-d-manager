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
  const [dnf, setDnf] = useState<string | null>(null);

  if (!season) return null;

  const config = season.scoringConfig;
  const pointsValue = points ?? config.positionPoints.join(", ");
  const beyondValue = beyond ?? String(config.pointsBeyondTable);
  const dnfValue = dnf ?? String(config.dnfPoints);

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
      dnfPoints: Number(dnfValue),
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
      setDnf(null);
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

      <div className="flex gap-4">
        <Field label="Beyond the table">
          <input
            inputMode="numeric"
            value={beyondValue}
            onChange={(e) => setBeyond(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-3"
          />
        </Field>
        <Field label="DNF">
          <input
            inputMode="numeric"
            value={dnfValue}
            onChange={(e) => setDnf(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-3"
          />
        </Field>
      </div>

      {/* Said out loud because it is the rule most likely to be mistaken for a
          bug: absent is not retired. */}
      <p className="text-xs text-neutral-500">
        A driver who missed a race scores nothing at all — which is not the same
        as the DNF value above.
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
