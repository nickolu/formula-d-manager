import type { Player, PlayerId } from "./types";

/**
 * Car identity — the short label and colour a driver is drawn with.
 *
 * Both are *derived*, not stored. Adding `carLabel`/`carColour` to the player
 * document would mean a setup screen, a migration for existing players, and a
 * way for two cars to end up the same colour anyway. Deriving them keeps the
 * schema untouched and makes a car look the same on every screen for free.
 *
 * Everything here is a pure function of the ids and names handed in, in the
 * spirit of lib/scoring.ts: no Firestore, no clock, no I/O.
 */

/**
 * Chosen to stay distinguishable against dark asphalt and from each other.
 * Ten covers any plausible Formula D grid — assignment wraps past that, which
 * only matters in a field larger than the game supports.
 */
const PALETTE = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#eab308", // yellow
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#e2e8f0", // white
];

export interface Car {
  label: string;
  colour: string;
}

/**
 * Black or white, whichever stays legible on the given car colour. The palette
 * spans yellow to purple, so a fixed ink colour would be unreadable on one end
 * of it.
 */
export function readableInk(colour: string): string {
  const n = parseInt(colour.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived brightness — green dominates, blue barely registers.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0a0a0a" : "#ffffff";
}

/** Stable across sessions and machines — a player keeps their colour. */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Label candidates, most preferred first. Each step degrades a little further
 * from "what you'd write on the car yourself":
 *
 *   1. initials of the first two words   Nick Cunningham -> NC
 *   2. the first two letters             Sarah           -> SA
 *   3. first letter + a later one        Nina  (NI take) -> NN
 *   4. the first letter alone            A               -> A
 *   5. a number, which can never collide
 *
 * Step 3 is what keeps a grid of similar names readable — without it a second
 * "Ni…" falls straight through to a digit, which reads as a position rather
 * than a driver.
 */
function candidates(name: string, index: number): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const out: string[] = [];

  if (words.length > 1) out.push((words[0][0] + words[1][0]).toUpperCase());
  if (letters.length > 1) out.push(letters.slice(0, 2));
  for (let k = 2; k < letters.length; k++) out.push(letters[0] + letters[k]);
  if (letters.length > 0) out.push(letters[0]);
  out.push(String(index + 1));

  return out;
}

/**
 * Assigns every driver a unique label and colour.
 *
 * Uniqueness is the whole point — two grey "N" cars on the tablet is worse than
 * no visualisation at all — so both passes iterate the ids *sorted*, not in
 * standings order. Assignment must not shuffle when someone overtakes.
 */
export function assignCars(
  ids: PlayerId[],
  players: Map<PlayerId, Player>,
): Map<PlayerId, Car> {
  const stable = [...new Set(ids)].sort();
  const cars = new Map<PlayerId, Car>();

  const usedLabels = new Set<string>();
  const usedColours = new Set<string>();

  stable.forEach((id, i) => {
    const name = players.get(id)?.displayName ?? id;

    const label =
      candidates(name, i).find((c) => !usedLabels.has(c)) ?? String(i + 1);
    usedLabels.add(label);

    // Linear-probe from the hashed slot so a collision takes the next free
    // colour rather than duplicating one.
    let slot = hash(id) % PALETTE.length;
    for (let n = 0; n < PALETTE.length && usedColours.has(PALETTE[slot]); n++) {
      slot = (slot + 1) % PALETTE.length;
    }
    const colour = PALETTE[slot];
    usedColours.add(colour);

    cars.set(id, { label, colour });
  });

  return cars;
}
