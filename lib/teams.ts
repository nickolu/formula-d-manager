import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { appendSeasonEvent, seasonDoc, seasonMemberDoc } from "./seasons";
import type { Actor, PlayerId, Season, TeamColor } from "./types";

export const teamsCol = (seasonId: string) =>
  collection(db, "seasons", seasonId, "teams");
export const teamDoc = (seasonId: string, teamId: string) =>
  doc(db, "seasons", seasonId, "teams", teamId);

/**
 * The house palette. Config, not code — this only *seeds* `teamConfig.palette`,
 * and a season keeps whatever it was set up with, exactly like `scoringConfig`.
 *
 * Keys are stable ids and are never reused for a different colour: a team's
 * `colorKey` and the season's `teamColors` map both point at one.
 */
export const DEFAULT_TEAM_PALETTE: TeamColor[] = [
  { key: "ferrari", label: "Ferrari Red", hex: "#E8002D" },
  { key: "mercedes", label: "Mercedes Silver", hex: "#27F4D2" },
  { key: "redbull", label: "Red Bull Navy", hex: "#3671C6" },
  { key: "mclaren", label: "McLaren Papaya", hex: "#FF8000" },
  { key: "aston", label: "Aston Green", hex: "#229971" },
  { key: "alpine", label: "Alpine Blue", hex: "#00A1E8" },
  { key: "williams", label: "Williams Cyan", hex: "#1868DB" },
  { key: "haas", label: "Haas White", hex: "#B6BABD" },
  { key: "sauber", label: "Sauber Lime", hex: "#01C00E" },
  { key: "rb", label: "RB Indigo", hex: "#6692FF" },
];

export const DEFAULT_TEAM_CONFIG = {
  enabled: false,
  teamSize: 2,
  playerManaged: true,
  palette: DEFAULT_TEAM_PALETTE,
  scoring: "sum" as const,
};

/** The team config a season actually uses, falling back the way carStatusSpecFor does. */
export function teamConfigFor(season: Season | null | undefined) {
  const config = season?.teamConfig;
  if (!config) return DEFAULT_TEAM_CONFIG;
  return {
    ...DEFAULT_TEAM_CONFIG,
    ...config,
    // A season switched on before a palette was written would otherwise render
    // an empty picker — the same "every reader handles the field's absence"
    // rule that gives an old race the standard car status card.
    palette:
      config.palette && config.palette.length > 0
        ? config.palette
        : DEFAULT_TEAM_PALETTE,
  };
}

/** Colour keys already spoken for, read from a document every view streams anyway. */
export function takenColors(season: Season | null | undefined) {
  return season?.teamColors ?? {};
}

/**
 * Claims a colour for a team inside a transaction.
 *
 * "No two teams share a colour" spans every team in the season, and the web SDK
 * cannot query a collection inside a transaction — so the answer lives in
 * `seasons/{id}.teamColors`, which this transaction has already read. Written
 * by **dot path**: writing the map whole would clobber a colour claimed a
 * second earlier, the same reason race settings toggles are written by dot path.
 */
function colourFields(claim: string | null, teamId: string, colorKey: string) {
  const fields: Record<string, unknown> = { [`teamColors.${colorKey}`]: teamId };
  if (claim && claim !== colorKey) fields[`teamColors.${claim}`] = deleteField();
  return fields;
}

async function readSeason(
  tx: Parameters<Parameters<typeof runTransaction>[1]>[0],
  seasonId: string,
): Promise<Season> {
  const snap = await tx.get(seasonDoc(seasonId));
  if (!snap.exists()) throw new Error(`No season ${seasonId}`);
  return { id: seasonId, ...snap.data() } as Season;
}

export async function createTeam(
  seasonId: string,
  name: string,
  colorKey: string,
  who: Actor,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A team needs a name");

  const ref = doc(teamsCol(seasonId));
  await runTransaction(db, async (tx) => {
    const season = await readSeason(tx, seasonId);
    const config = teamConfigFor(season);
    if (!config.palette.some((c) => c.key === colorKey)) {
      throw new Error(`${colorKey} is not in this season's palette`);
    }
    const holder = takenColors(season)[colorKey];
    if (holder) throw new Error("Another team already has that colour");

    // Deliberately no check that the season has room for another team. Equal
    // team sizes are a house rule, not an invariant — blocking the third team
    // until the first two are full is hostile during the ten minutes the
    // commissioner spends setting the league up. The UI flags it instead.
    tx.set(ref, {
      name: trimmed,
      colorKey,
      members: [],
      createdAt: serverTimestamp(),
    });
    tx.update(seasonDoc(seasonId), colourFields(null, ref.id, colorKey));
    appendSeasonEvent(tx, seasonId, who, {
      type: "teamCreated",
      teamId: ref.id,
      name: trimmed,
      colorKey,
    });
  });

  return ref.id;
}

export async function renameTeam(
  seasonId: string,
  teamId: string,
  name: string,
  who: Actor,
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A team needs a name");

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(teamDoc(seasonId, teamId));
    if (!snap.exists()) throw new Error("That team is gone");

    tx.update(teamDoc(seasonId, teamId), { name: trimmed });
    appendSeasonEvent(tx, seasonId, who, {
      type: "teamRenamed",
      teamId,
      name: trimmed,
    });
  });
}

/**
 * Moves a team onto a different colour, releasing the old one in the same
 * transaction. Two phones picking the same colour at once: one wins, the other
 * is told it is taken.
 */
export async function recolourTeam(
  seasonId: string,
  teamId: string,
  colorKey: string,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const season = await readSeason(tx, seasonId);
    const snap = await tx.get(teamDoc(seasonId, teamId));
    if (!snap.exists()) throw new Error("That team is gone");

    const config = teamConfigFor(season);
    if (!config.palette.some((c) => c.key === colorKey)) {
      throw new Error(`${colorKey} is not in this season's palette`);
    }
    const holder = takenColors(season)[colorKey];
    if (holder && holder !== teamId) {
      throw new Error("Another team already has that colour");
    }

    const previous = snap.data().colorKey as string;
    if (previous === colorKey) return;

    tx.update(teamDoc(seasonId, teamId), { colorKey });
    tx.update(seasonDoc(seasonId), colourFields(previous, teamId, colorKey));
    appendSeasonEvent(tx, seasonId, who, {
      type: "teamRecoloured",
      teamId,
      colorKey,
    });
  });
}

/**
 * Deletes a team, frees its colour, and clears its members' `teamId`.
 *
 * Both halves of the membership denormalization have to be undone together or
 * a player is left pointing at a team that no longer exists — which is exactly
 * what would then make `joinTeam` refuse to put them anywhere.
 */
export async function deleteTeam(seasonId: string, teamId: string, who: Actor) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(teamDoc(seasonId, teamId));
    if (!snap.exists()) throw new Error("That team is gone");

    const { name, colorKey, members } = snap.data() as {
      name: string;
      colorKey: string;
      members: PlayerId[];
    };

    // Reads before writes, as every transaction here must — the member docs are
    // known from the team's own members array, so no query is needed.
    for (const playerId of members ?? []) {
      tx.update(seasonMemberDoc(seasonId, playerId), { teamId: null });
    }

    tx.delete(teamDoc(seasonId, teamId));
    tx.update(seasonDoc(seasonId), {
      [`teamColors.${colorKey}`]: deleteField(),
    });
    appendSeasonEvent(tx, seasonId, who, { type: "teamDeleted", teamId, name });
  });
}

/**
 * Puts a racer on a team, checking both denormalized invariants in one
 * transaction: the team has a slot (`members.length < teamSize`, from the team
 * doc) and the racer is not already on one (`member.teamId`, from the member
 * doc). Neither can be violated by two phones tapping at once.
 *
 * `enforceCapacity` is false for the admin path, which is allowed to overfill a
 * team — the commissioner setting up a league of five with teams of two needs
 * to be able to make an uneven one, and the UI flags it rather than blocking it.
 */
async function join(
  seasonId: string,
  teamId: string,
  playerId: PlayerId,
  who: Actor,
  enforceCapacity: boolean,
) {
  await runTransaction(db, async (tx) => {
    const season = await readSeason(tx, seasonId);
    const teamSnap = await tx.get(teamDoc(seasonId, teamId));
    const memberSnap = await tx.get(seasonMemberDoc(seasonId, playerId));
    if (!teamSnap.exists()) throw new Error("That team is gone");
    if (!memberSnap.exists()) throw new Error(`${playerId} is not in this season`);

    const members = (teamSnap.data().members ?? []) as PlayerId[];
    const currentTeam = (memberSnap.data().teamId ?? null) as string | null;
    if (currentTeam === teamId) return; // already there

    const config = teamConfigFor(season);
    if (enforceCapacity && members.length >= config.teamSize) {
      throw new Error(`${teamSnap.data().name} is full`);
    }
    if (currentTeam) {
      throw new Error("Leave your current team first");
    }

    tx.update(teamDoc(seasonId, teamId), { members: [...members, playerId] });
    tx.update(seasonMemberDoc(seasonId, playerId), { teamId });
    appendSeasonEvent(tx, seasonId, who, { type: "teamJoined", teamId, playerId });
  });
}

/** The player path: capacity-checked, because a player must not overfill a team. */
export function joinTeam(
  seasonId: string,
  teamId: string,
  playerId: PlayerId,
  who: Actor,
) {
  return join(seasonId, teamId, playerId, who, true);
}

/** The admin path: same invariants, but allowed to make an uneven team. */
export function assignToTeam(
  seasonId: string,
  teamId: string,
  playerId: PlayerId,
  who: Actor,
) {
  return join(seasonId, teamId, playerId, who, false);
}

/**
 * Takes a racer off whatever team they are on. The team is found from the
 * member document rather than by querying teams — the exclusivity authority
 * exists precisely so a transaction can answer "which team" from one read.
 */
export async function leaveTeam(
  seasonId: string,
  playerId: PlayerId,
  who: Actor,
) {
  await runTransaction(db, async (tx) => {
    const memberSnap = await tx.get(seasonMemberDoc(seasonId, playerId));
    if (!memberSnap.exists()) throw new Error(`${playerId} is not in this season`);

    const teamId = (memberSnap.data().teamId ?? null) as string | null;
    if (!teamId) return; // not on a team; nothing to undo

    const teamSnap = await tx.get(teamDoc(seasonId, teamId));

    tx.update(seasonMemberDoc(seasonId, playerId), { teamId: null });
    // A team that has already been deleted leaves a dangling teamId; clearing
    // it above is still the right thing, and there is no array left to splice.
    if (teamSnap.exists()) {
      const members = (teamSnap.data().members ?? []) as PlayerId[];
      tx.update(teamDoc(seasonId, teamId), {
        members: members.filter((id) => id !== playerId),
      });
    }
    appendSeasonEvent(tx, seasonId, who, { type: "teamLeft", teamId, playerId });
  });
}
