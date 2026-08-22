"use client";

import { useState } from "react";
import { readableInk } from "@/lib/cars";
import {
  usePlayers,
  useSeason,
  useSeasonMembers,
  useStandings,
  useTeams,
} from "@/lib/hooks";
import {
  createTeam,
  joinTeam,
  leaveTeam,
  recolourTeam,
  renameTeam,
  teamConfigFor,
} from "@/lib/teams";
import type { Participant, PlayerId } from "@/lib/types";

/**
 * A racer's team, on their own phone.
 *
 * Rendered in two places from one component: below the car card in My racer
 * (where there is a race to show teammates' positions from) and standing alone
 * at `/season/:id/teams` between game nights. Do not fork it — the join, leave
 * and rename paths are the same paths, and two copies would drift.
 *
 * It lives inside My racer rather than a fourth tab because the panel has to
 * know who *you* are, which is the claim. A standalone Team tab would open on
 * "claim a racer first", which is the My racer screen with extra steps.
 *
 * `playerManaged` is a **mode, not a permission**: there is no auth to enforce
 * one with. It hides the controls; `lib/teams.ts` separately enforces the soft
 * check that actually holds at a table — you edit the team you are on.
 */
export default function TeamPanel({
  seasonId,
  playerId,
  race,
}: {
  seasonId: string;
  /** This device's racer, or null when nothing is claimed yet. */
  playerId: PlayerId | null;
  /** Live race context, absent between game nights. */
  race?: {
    positionOrder: PlayerId[];
    participants: Map<PlayerId, Participant>;
    retired: Set<PlayerId>;
  };
}) {
  const { season } = useSeason(seasonId);
  const { teams } = useTeams(seasonId);
  const { members } = useSeasonMembers(seasonId);
  const { standings } = useStandings(seasonId);
  const players = usePlayers();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [newTeam, setNewTeam] = useState("");

  const config = teamConfigFor(season);
  if (!config.enabled) return null;

  const taken = season?.teamColors ?? {};
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;
  const pointsOf = (id: PlayerId) =>
    standings.find((r) => r.playerId === id)?.points ?? 0;
  const colourOf = (key: string) =>
    config.palette.find((c) => c.key === key)?.hex ?? "#666";

  const mine = playerId
    ? (teams.find((t) => t.members.includes(playerId)) ?? null)
    : null;
  const onRoster = playerId
    ? members.some((m) => m.playerId === playerId)
    : false;
  const canEdit = config.playerManaged && !!mine && !!playerId;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-widest text-neutral-500">Team</h2>

      {mine ? (
        <>
          <div
            className="flex items-center gap-3 rounded-2xl p-4"
            style={{
              background: colourOf(mine.colorKey),
              color: readableInk(colourOf(mine.colorKey)),
            }}
          >
            {editing ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() =>
                  run(async () => {
                    if (name.trim() && name.trim() !== mine.name) {
                      await renameTeam(seasonId, mine.id, name, {
                        source: "manual",
                      }, playerId!);
                    }
                    setEditing(false);
                  })
                }
                className="min-w-0 flex-1 rounded border border-black/20 bg-white/20 p-2 text-xl font-semibold"
              />
            ) : (
              <button
                disabled={!canEdit}
                onClick={() => {
                  setName(mine.name);
                  setEditing(true);
                }}
                className="min-w-0 flex-1 truncate text-left text-xl font-semibold"
              >
                {mine.name}
              </button>
            )}
            <span className="shrink-0 text-sm opacity-70">
              {mine.members.length}/{config.teamSize}
            </span>
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {config.palette.map((colour) => {
                const held = taken[colour.key];
                const isMine = held === mine.id;
                return (
                  <button
                    key={colour.key}
                    // Greyed rather than hidden: seeing that Ferrari is taken
                    // is information.
                    disabled={busy || (!!held && !isMine)}
                    onClick={() =>
                      run(() =>
                        recolourTeam(
                          seasonId,
                          mine.id,
                          colour.key,
                          { source: "manual" },
                          playerId!,
                        ),
                      )
                    }
                    title={colour.label}
                    aria-label={colour.label}
                    className={`h-9 w-9 rounded-xl ${
                      held && !isMine ? "opacity-20" : ""
                    } ${isMine ? "ring-2 ring-white" : ""}`}
                    style={{ background: colour.hex }}
                  />
                );
              })}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {mine.members.map((id) => {
              const participant = race?.participants.get(id);
              const position = race ? race.positionOrder.indexOf(id) + 1 : 0;
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-2xl border border-neutral-800 p-3"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {nameOf(id)}
                    {id === playerId && (
                      <span className="ml-2 text-xs text-neutral-500">you</span>
                    )}
                  </span>
                  {position > 0 && (
                    <span className="shrink-0 text-sm text-neutral-400">
                      P{position}
                    </span>
                  )}
                  {participant && (
                    <span className="shrink-0 text-sm text-neutral-500">
                      lap {participant.lapsCompleted}
                    </span>
                  )}
                  {race?.retired.has(id) && (
                    <span className="shrink-0 rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
                      DNF
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-medium">
                    {pointsOf(id)}
                  </span>
                </li>
              );
            })}
          </ul>

          {config.playerManaged && (
            // Muted, small, and on its own — the same reasoning as the reverse
            // gear. A rare action that undoes something does not sit beside a
            // target a thumb is aimed at all evening.
            <div className="mt-4">
              <button
                onClick={() =>
                  run(() =>
                    leaveTeam(seasonId, playerId!, { source: "manual" }),
                  )
                }
                disabled={busy}
                className="text-sm text-neutral-600 underline disabled:opacity-50"
              >
                Leave team
              </button>
            </div>
          )}
        </>
      ) : !playerId ? (
        <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
          Pick your racer first — a team is something a racer joins.
        </p>
      ) : !onRoster ? (
        <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
          You are not in this season&rsquo;s league yet, so there is no team to
          join. The commissioner can add you from the season page.
        </p>
      ) : (
        <>
          {teams.length === 0 ? (
            <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
              No teams yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {teams.map((team) => {
                const full = team.members.length >= config.teamSize;
                return (
                  <li key={team.id}>
                    <button
                      // Full teams stay visible and disabled: hiding one makes
                      // a player think their friend's team is missing.
                      disabled={busy || full || !config.playerManaged}
                      onClick={() =>
                        run(() =>
                          joinTeam(seasonId, team.id, playerId, {
                            source: "manual",
                          }),
                        )
                      }
                      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left ${
                        full ? "border-neutral-900 opacity-50" : "border-neutral-800"
                      }`}
                    >
                      <span
                        className="h-8 w-8 shrink-0 rounded-lg"
                        style={{ background: colourOf(team.colorKey) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-lg">
                        {team.name}
                      </span>
                      <span className="shrink-0 text-sm text-neutral-500">
                        {team.members.length}/{config.teamSize}
                        {full ? " · full" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {config.playerManaged && (
            <div className="flex gap-2">
              <input
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
                placeholder="Start a team"
                className="min-w-0 flex-1 rounded border border-neutral-700 bg-transparent p-3"
              />
              <button
                disabled={busy || !newTeam.trim()}
                onClick={() =>
                  run(async () => {
                    const free = config.palette.find((c) => !taken[c.key]);
                    if (!free) throw new Error("Every colour is taken");
                    const teamId = await createTeam(seasonId, newTeam, free.key, {
                      source: "manual",
                    });
                    await joinTeam(seasonId, teamId, playerId, {
                      source: "manual",
                    });
                    setNewTeam("");
                  })
                }
                className="rounded border border-neutral-700 px-4 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </section>
  );
}
