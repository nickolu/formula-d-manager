"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRaceList, useSeason } from "@/lib/hooks";
import { deleteSeason, updateSeason } from "@/lib/seasons";

/**
 * The season's name, and the two ways it stops being current.
 *
 * Archiving is what people actually want when a season ends: it drops out of
 * pickers and keeps its standings. Delete is for the season made by a mis-tap,
 * which is why it refuses anything with a race in it.
 */
export default function SettingsSection({ seasonId }: { seasonId: string }) {
  const { season } = useSeason(seasonId);
  const { races } = useRaceList(seasonId);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState<string | null>(null);

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

  if (!season) return null;

  const nameValue = name ?? season.name;
  const archived = season.archived === true;
  // deleteSeason refuses a season with races. Saying so up front beats a button
  // that looks live and throws — the same reasoning as the locked-roster note
  // on the race settings screen.
  const deletable = races.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-widest text-neutral-500">
            Name
          </span>
          <input
            value={nameValue}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-900 p-3"
          />
        </label>
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
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          {archived ? "Archived" : "Ending the season"}
        </h2>
        <p className="text-sm text-neutral-400">
          {archived
            ? "This season is out of the switcher. Its standings are still reachable by link."
            : "Archiving drops the season out of pickers and keeps its standings. It is reversible."}
        </p>
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

        {!deletable ? (
          // Explained, not merely disabled: a control that does nothing with no
          // reason given reads as a bug.
          <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
            This season has {races.length}{" "}
            {races.length === 1 ? "race" : "races"}, so it cannot be deleted —
            archive it instead. Deleting would mean deleting races, and a race
            can only be deleted once it has been finished.
          </p>
        ) : confirmingDelete ? (
          // Named, with the consequence spelled out — the same shape as race
          // deletion. A generic "Are you sure?" on a phone gets tapped through.
          <div className="flex flex-col gap-3 rounded-2xl border border-red-900 p-4">
            <p className="text-sm">
              Delete <span className="font-semibold">{season.name}</span>?
            </p>
            <p className="text-xs text-neutral-400">
              The season&rsquo;s roster and teams go with it. Its log is kept —
              events can never be deleted — but nothing will be able to reach it.
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

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </div>
  );
}
