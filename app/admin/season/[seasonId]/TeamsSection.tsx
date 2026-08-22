"use client";

import { useState } from "react";
import { readableInk } from "@/lib/cars";
import { usePlayers, useSeasonMembers, useTeams } from "@/lib/hooks";
import { updateTeamConfig } from "@/lib/seasons";
import {
  assignToTeam,
  createTeam,
  DEFAULT_TEAM_CONFIG,
  DEFAULT_TEAM_PALETTE,
  deleteTeam,
  leaveTeam,
  recolourTeam,
  renameTeam,
  teamConfigFor,
} from "@/lib/teams";
import type { PlayerId, Season, TeamColor } from "@/lib/types";

/**
 * Constructors, for one season.
 *
 * The house rules that shape this: every team is the same size, and nobody
 * switches teams during a season. Both are held by convention and **surfaced
 * here rather than enforced in `lib/`** — an uneven team or a leftover player
 * is flagged, never blocked, because blocking the third team until the first
 * two are full is hostile during the ten minutes a league gets set up in.
 */
export default function TeamsSection({
  seasonId,
  season,
}: {
  seasonId: string;
  season: Season;
}) {
  const { teams } = useTeams(seasonId);
  const { members } = useSeasonMembers(seasonId);
  const players = usePlayers();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // Which team's empty slot is being filled, or which team is being recoloured.
  const [filling, setFilling] = useState<string | null>(null);
  const [recolouring, setRecolouring] = useState<string | null>(null);

  const config = teamConfigFor(season);
  const taken = season.teamColors ?? {};
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;
  const colourOf = (key: string) =>
    config.palette.find((c) => c.key === key)?.hex ?? "#666";

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

  const unassigned = members
    .filter((m) => !m.teamId)
    .map((m) => m.playerId)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const freeColours = config.palette.filter((c) => !taken[c.key]);
  const uneven = teams.some((t) => t.members.length !== config.teamSize);
  const remainder = members.length % config.teamSize;

  if (!config.enabled) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-neutral-500">
          Teams
        </h2>
        <p className="text-sm text-neutral-400">
          Off. Turning teams on adds a constructors table to the standings and a
          team panel to each player&rsquo;s phone.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            run("Teams on", () =>
              // Absent means off, so switching on for the first time writes a
              // whole usable config rather than a lone `enabled` flag with no
              // palette beside it.
              updateTeamConfig(
                seasonId,
                season.teamConfig
                  ? { enabled: true }
                  : { ...DEFAULT_TEAM_CONFIG, enabled: true },
                { source: "manual" },
              ),
            )
          }
          className="rounded-2xl border border-neutral-700 py-4 disabled:opacity-50"
        >
          Turn teams on
        </button>
        {status && <p className="text-sm text-neutral-400">{status}</p>}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs uppercase tracking-widest text-neutral-500">
        Teams
      </h2>

      {/* Flagged, never blocked — see the note at the top of this file. */}
      {(uneven || remainder !== 0) && teams.length > 0 && (
        <p className="rounded border border-amber-900 bg-amber-950/20 p-3 text-sm text-amber-300">
          {uneven && `Teams are meant to be ${config.teamSize} each. `}
          {remainder !== 0 &&
            `${members.length} in the league, teams of ${config.teamSize} — ${remainder} ${
              remainder === 1 ? "player" : "players"
            } will be left over.`}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {teams.map((team) => (
          <div
            key={team.id}
            className="flex flex-col gap-2 rounded-2xl border border-neutral-800 p-3"
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setRecolouring(recolouring === team.id ? null : team.id)
                }
                disabled={busy}
                aria-label={`Recolour ${team.name}`}
                className="h-8 w-8 shrink-0 rounded-lg"
                style={{ background: colourOf(team.colorKey) }}
              />
              <input
                defaultValue={team.name}
                // Uncontrolled: the listener would otherwise yank a half-typed
                // name away mid-edit, the same trap the settings fields dodge.
                onBlur={(e) => {
                  if (e.target.value.trim() === team.name) return;
                  run("Renamed", () =>
                    renameTeam(seasonId, team.id, e.target.value, {
                      source: "manual",
                    }),
                  );
                }}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent p-2 text-lg hover:border-neutral-800"
              />
              <button
                onClick={() =>
                  run(`${team.name} deleted`, () =>
                    deleteTeam(seasonId, team.id, { source: "manual" }),
                  )
                }
                disabled={busy}
                className="shrink-0 rounded border border-red-900 px-3 py-1 text-xs text-red-400 disabled:opacity-30"
              >
                Delete
              </button>
            </div>

            {recolouring === team.id && (
              <div className="flex flex-wrap gap-2 rounded border border-neutral-800 p-2">
                {config.palette.map((colour) => {
                  const held = taken[colour.key];
                  const mine = held === team.id;
                  return (
                    <button
                      key={colour.key}
                      // Taken colours grey out rather than hide: seeing that
                      // Ferrari is spoken for is information.
                      disabled={busy || (!!held && !mine)}
                      onClick={() =>
                        run("Recoloured", async () => {
                          await recolourTeam(seasonId, team.id, colour.key, {
                            source: "manual",
                          });
                          setRecolouring(null);
                        })
                      }
                      title={colour.label}
                      className={`h-8 w-8 rounded-lg ${
                        held && !mine ? "opacity-20" : ""
                      } ${mine ? "ring-2 ring-white" : ""}`}
                      style={{ background: colour.hex }}
                    />
                  );
                })}
              </div>
            )}

            {/* The slot grid. Not a dropdown per player: an empty slot and a
                leftover player are both visible at a glance this way. */}
            <ul className="flex flex-wrap gap-2">
              {Array.from({
                length: Math.max(config.teamSize, team.members.length),
              }).map((_, i) => {
                const playerId = team.members[i];
                if (playerId) {
                  return (
                    <li key={playerId}>
                      <button
                        onClick={() =>
                          run(`${nameOf(playerId)} removed`, () =>
                            leaveTeam(seasonId, playerId, { source: "manual" }),
                          )
                        }
                        disabled={busy}
                        className="rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-50"
                        style={{
                          background: colourOf(team.colorKey),
                          color: readableInk(colourOf(team.colorKey)),
                        }}
                      >
                        {nameOf(playerId)} ×
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`slot-${i}`}>
                    <button
                      onClick={() =>
                        setFilling(filling === team.id ? null : team.id)
                      }
                      disabled={busy}
                      className="rounded-xl border border-dashed border-neutral-700 px-4 py-2 text-sm text-neutral-500 disabled:opacity-50"
                    >
                      + empty
                    </button>
                  </li>
                );
              })}
            </ul>

            {filling === team.id && (
              <div className="flex flex-wrap gap-2 rounded border border-neutral-800 p-2">
                {unassigned.length === 0 ? (
                  <span className="text-sm text-neutral-500">
                    Everyone is on a team.
                  </span>
                ) : (
                  unassigned.map((id) => (
                    <button
                      key={id}
                      disabled={busy}
                      onClick={() =>
                        run(`${nameOf(id)} added`, async () => {
                          await assignToTeam(seasonId, team.id, id, {
                            source: "manual",
                          });
                          setFilling(null);
                        })
                      }
                      className="rounded-xl border border-neutral-700 px-3 py-2 text-sm disabled:opacity-50"
                    >
                      {nameOf(id)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New team name"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-transparent p-3"
        />
        <button
          disabled={busy || !newName.trim() || freeColours.length === 0}
          onClick={() =>
            run(`${newName} created`, async () => {
              await createTeam(seasonId, newName, freeColours[0].key, {
                source: "manual",
              });
              setNewName("");
            })
          }
          className="rounded border border-neutral-700 px-4 disabled:opacity-40"
        >
          Create
        </button>
      </div>
      {freeColours.length === 0 && (
        <p className="text-sm text-neutral-500">
          Every colour in the palette is taken — add one below, or free one up.
        </p>
      )}

      {unassigned.length > 0 && (
        <p className="text-sm text-neutral-500">
          Not on a team: {unassigned.map(nameOf).join(", ")}
        </p>
      )}

      <TeamOptions
        seasonId={seasonId}
        teamSize={config.teamSize}
        playerManaged={config.playerManaged}
        scoring={config.scoring}
        palette={config.palette}
        taken={taken}
        busy={busy}
        run={run}
      />

      {status && <p className="text-sm text-neutral-400">{status}</p>}
    </section>
  );
}

function TeamOptions({
  seasonId,
  teamSize,
  playerManaged,
  scoring,
  palette,
  taken,
  busy,
  run,
}: {
  seasonId: string;
  teamSize: number;
  playerManaged: boolean;
  scoring: "sum" | "average";
  palette: TeamColor[];
  taken: Record<string, string>;
  busy: boolean;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
}) {
  const [size, setSize] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [hex, setHex] = useState("#888888");

  const sizeValue = size ?? String(teamSize);

  return (
    <details className="rounded border border-neutral-800">
      <summary className="cursor-pointer select-none p-3 text-sm uppercase tracking-widest text-neutral-500">
        Team options
      </summary>
      <div className="flex flex-col gap-3 p-3 pt-0">
        <label className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">Racers per team</span>
          <input
            inputMode="numeric"
            value={sizeValue}
            onChange={(e) => setSize(e.target.value)}
            onBlur={() =>
              run("Team size saved", async () => {
                await updateTeamConfig(
                  seasonId,
                  { teamSize: Number(sizeValue) },
                  { source: "manual" },
                );
                setSize(null);
              })
            }
            className="w-16 rounded border border-neutral-700 bg-transparent p-2"
          />
        </label>
        {/* Lowering this never kicks anyone — it blocks new joins and leaves
            everyone where they are. */}
        <p className="text-xs text-neutral-600">
          Lowering this leaves existing teams alone; it only stops new joins.
        </p>

        <button
          disabled={busy}
          onClick={() =>
            run(playerManaged ? "Players can manage teams" : "Admin only", () =>
              updateTeamConfig(
                seasonId,
                { playerManaged: !playerManaged },
                { source: "manual" },
              ),
            )
          }
          className={`rounded border p-3 text-left text-sm disabled:opacity-50 ${
            playerManaged ? "border-emerald-800 bg-emerald-950/30" : "border-neutral-800"
          }`}
        >
          Players can join, leave and rename their own team
          <span className="mt-1 block text-xs text-neutral-500">
            Not a permission — there is no login to enforce one with. It hides
            the controls, and `lib/` only checks that a player is editing the
            team they are on.
          </span>
        </button>

        <button
          disabled={busy}
          onClick={() =>
            run("Team scoring saved", () =>
              updateTeamConfig(
                seasonId,
                { scoring: scoring === "sum" ? "average" : "sum" },
                { source: "manual" },
              ),
            )
          }
          className="rounded border border-neutral-800 p-3 text-left text-sm disabled:opacity-50"
        >
          Team score: <span className="text-neutral-300">{scoring}</span>
          <span className="mt-1 block text-xs text-neutral-500">
            With equal, full teams these rank identically — average is sum
            divided by the same number every time.
          </span>
        </button>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-neutral-500">Palette</span>
          <ul className="flex flex-wrap gap-2">
            {palette.map((colour) => {
              const held = !!taken[colour.key];
              return (
                <li
                  key={colour.key}
                  className="flex items-center gap-2 rounded border border-neutral-800 p-1 pr-2"
                >
                  <span
                    className="h-6 w-6 rounded"
                    style={{ background: colour.hex }}
                  />
                  <span className="text-xs">{colour.label}</span>
                  <button
                    // Greyed for the same reason lib/ refuses it: a team wearing
                    // this colour would be left pointing at nothing.
                    disabled={busy || held}
                    title={held ? "A team is wearing this" : "Remove"}
                    onClick={() =>
                      run("Palette saved", () =>
                        updateTeamConfig(
                          seasonId,
                          { palette: palette.filter((c) => c.key !== colour.key) },
                          { source: "manual" },
                        ),
                      )
                    }
                    className="text-xs text-neutral-600 disabled:opacity-20"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Colour name"
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-transparent p-2 text-sm"
            />
            <input
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="h-10 w-12 rounded border border-neutral-700 bg-transparent"
            />
            <button
              disabled={busy || !label.trim()}
              onClick={() =>
                run("Colour added", async () => {
                  // Keys are stable ids and never reused for a different
                  // colour, so a new one is derived from the label and suffixed
                  // if that key is already spoken for.
                  const base =
                    label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
                    "colour";
                  let key = base;
                  let n = 2;
                  while (palette.some((c) => c.key === key)) key = `${base}-${n++}`;
                  await updateTeamConfig(
                    seasonId,
                    { palette: [...palette, { key, label: label.trim(), hex }] },
                    { source: "manual" },
                  );
                  setLabel("");
                })
              }
              className="rounded border border-neutral-700 px-3 text-sm disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {DEFAULT_TEAM_PALETTE.length > palette.length && (
          <button
            disabled={busy}
            onClick={() =>
              run("Palette restored", () =>
                updateTeamConfig(
                  seasonId,
                  {
                    palette: [
                      ...palette,
                      ...DEFAULT_TEAM_PALETTE.filter(
                        (c) => !palette.some((p) => p.key === c.key),
                      ),
                    ],
                  },
                  { source: "manual" },
                ),
              )
            }
            className="rounded border border-neutral-800 p-2 text-xs text-neutral-500 disabled:opacity-50"
          >
            Put the house colours back
          </button>
        )}
      </div>
    </details>
  );
}
