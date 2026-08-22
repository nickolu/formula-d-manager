"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Nav from "@/app/Nav";
import NewRaceForm from "@/app/NewRaceForm";
import RaceList from "@/app/RaceList";
import BackfillForm from "./BackfillForm";
import RosterSection from "./RosterSection";
import { useSeason } from "@/lib/hooks";
import { deleteSeason, updateSeason } from "@/lib/seasons";
import type { ScoringConfig } from "@/lib/types";

/**
 * One season, everything about it in one page: its races, its roster, its
 * scoring, and the settings that seal or remove it. Teams is item 17 and lands
 * here as a further section.
 *
 * Every change goes through lib/seasons.ts, which writes the document and
 * appends a season event in one transaction. Nothing here writes a document
 * directly — the season log is the only record that a change happened, and it
 * ships before its view for exactly that reason.
 */
export default function SeasonAdminView({ seasonId }: { seasonId: string }) {
  const { season, loading } = useSeason(seasonId);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Null until touched, so each field tracks the live document right up to the
  // first keystroke and then pins — the same trick the race settings view uses.
  const [name, setName] = useState<string | null>(null);
  const [points, setPoints] = useState<string | null>(null);
  const [beyond, setBeyond] = useState<string | null>(null);
  const [dnf, setDnf] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(label);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-8 text-neutral-400">Connecting…</p>;
  if (!season) {
    return (
      <main className="mx-auto w-full max-w-2xl p-8">
        <Nav />
        <p className="text-neutral-400">
          Season not found. <Link href="/admin" className="text-emerald-500">Back to admin</Link>
        </p>
      </main>
    );
  }

  const config = season.scoringConfig;
  const nameValue = name ?? season.name;
  const pointsValue = points ?? config.positionPoints.join(", ");
  const beyondValue = beyond ?? String(config.pointsBeyondTable);
  const dnfValue = dnf ?? String(config.dnfPoints);
  const archived = season.archived === true;

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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 p-8">
      <Nav />

      <div>
        <Link href="/admin" className="text-sm text-emerald-500">
          ← all seasons
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">
          {season.name}
          {archived && (
            <span className="ml-3 align-middle text-sm font-normal uppercase tracking-widest text-neutral-500">
              archived
            </span>
          )}
        </h1>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          Races
        </h2>
        <NewRaceForm seasonId={seasonId} />
        <BackfillForm seasonId={seasonId} />
        <RaceList variant="admin" seasonId={seasonId} />
      </section>

      <RosterSection seasonId={seasonId} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          Scoring
        </h2>
        <p className="text-sm text-neutral-400">
          Standings are worked out from finished races every time they are
          shown, so editing this re-sorts the whole season — including races
          already run. That is the point: house rules can be re-argued against
          past seasons without touching a race.
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

        <button
          disabled={busy}
          onClick={() =>
            run("Scoring saved", async () => {
              await updateSeason(
                seasonId,
                { scoringConfig: parseScoring() },
                { source: "manual" },
              );
              setPoints(null);
              setBeyond(null);
              setDnf(null);
            })
          }
          className="rounded-2xl bg-neutral-800 py-4 active:bg-neutral-700 disabled:opacity-50"
        >
          Save scoring
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          Settings
        </h2>

        <Field label="Name">
          <input
            value={nameValue}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-3"
          />
        </Field>
        <button
          disabled={busy}
          onClick={() =>
            run("Saved", async () => {
              await updateSeason(seasonId, { name: nameValue }, { source: "manual" });
              setName(null);
            })
          }
          className="rounded-2xl bg-neutral-800 py-4 active:bg-neutral-700 disabled:opacity-50"
        >
          Save name
        </button>

        {/* Archiving is the action people actually want when a season ends: it
            drops out of pickers and keeps its standings. Delete is for the
            season made by a mis-tap, which is why it sits below and refuses
            anything with a race in it. */}
        <button
          disabled={busy}
          onClick={() =>
            run(archived ? "Season reopened" : "Season archived", () =>
              updateSeason(seasonId, { archived: !archived }, { source: "manual" }),
            )
          }
          className="rounded-2xl border border-neutral-700 py-4 disabled:opacity-50"
        >
          {archived ? "Reopen season" : "Archive season"}
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-red-900">
          Danger
        </h2>

        {confirmingDelete ? (
          // Named, with the consequence spelled out — the same shape as race
          // deletion. A generic "Are you sure?" on a phone gets tapped through.
          <div className="flex flex-col gap-3 rounded-2xl border border-red-900 p-4">
            <p className="text-sm">
              Delete <span className="font-semibold">{season.name}</span>?
            </p>
            <p className="text-xs text-neutral-400">
              Only a season with no races at all can be deleted — a season with
              history should be archived instead. The season&rsquo;s log is
              kept; events can never be deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-neutral-700 py-3 disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                onClick={() =>
                  run("Deleted", async () => {
                    await deleteSeason(seasonId);
                    router.push("/admin");
                  })
                }
                disabled={busy}
                className="flex-1 rounded-xl bg-red-900 py-3 disabled:opacity-50"
              >
                Delete season
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="w-full rounded-2xl border border-red-900 py-4 text-red-400 disabled:opacity-50"
          >
            Delete this season
          </button>
        )}
      </section>

      {status && <p className="text-center text-sm text-neutral-400">{status}</p>}
    </main>
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
