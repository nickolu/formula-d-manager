"use client";

import Link from "next/link";
import {
  useLiveState,
  useNow,
  useParticipants,
  usePlayers,
  useRace,
} from "@/lib/hooks";
import { formatRemaining, readTimer } from "@/lib/timer";
import StaleRace from "@/app/StaleRace";
import { useFlipOrder } from "@/app/useFlipOrder";

/** Stable, so the flip hook does not re-measure on every repaint tick. */
const NO_ORDER: string[] = [];

/**
 * The clock, the car whose turn it is, and the order — drawn big.
 *
 * Rendered from two routes with a `variant`, the same bargain as RaceList:
 * the listener, the four states and every rule about what "nobody's turn"
 * means are shared, and two copies would drift.
 *
 * - `big` is /race/:id/screen — the television across the room, no chrome.
 * - `player` is /race/:id/player/screen — the same thing on the phone already
 *   in your hand, with a way back to the player view. It sits OUTSIDE the
 *   player layout's route group deliberately: a fixed tab bar and a header
 *   would eat a third of a phone held sideways, and this view exists to be
 *   nothing but a clock.
 *
 * **Everything is sized in viewport units, capped at what the big screen was
 * already using.** That is the whole of the orientation handling and it is
 * why there is no breakpoint anywhere in this file: a `md:` flip would jump
 * at one width, whereas `min(vw, vh)` tracks a phone turning through the
 * rotation continuously, and the `min()` means the binding constraint swaps
 * from height to width on its own as the aspect ratio crosses over. The cap
 * is what keeps the television pixel-identical — every real big-screen
 * resolution lands above it, so `big` clamps to the old fixed sizes.
 */
const SCALE = {
  // 4 chars of m:ss at ~0.6em each has to fit the width, hence the vw term.
  "--s-timer": "clamp(3rem, min(28vw, 34vh), 14rem)",
  "--s-hero": "clamp(1.75rem, min(7vw, 8.5vh), 4.5rem)",
  // The vw terms are looser than the vh ones for everything that wraps or is
  // short: a name and a standings row need width for one word, not for the
  // whole line, so punishing them for a narrow viewport the way the timer has
  // to be punished just leaves a portrait phone reading 15px type under three
  // inches of black. Landscape is bound by the vh term and the television by
  // the cap, so both are untouched by the looser width.
  "--s-name": "clamp(1.25rem, min(7vw, 6vh), 3rem)",
  "--s-label": "clamp(0.9rem, min(3.6vw, 4.4vh), 2.25rem)",
  "--s-row": "clamp(0.95rem, min(4.5vw, 3.6vh), 1.875rem)",
  "--s-sub": "clamp(0.7rem, min(2vw, 2.4vh), 1.25rem)",
  "--s-pad": "clamp(0.75rem, 5vmin, 2.5rem)",
  "--s-gap": "clamp(1rem, 4vh, 2.5rem)",
} as React.CSSProperties;

/**
 * The scale for a list of N rows, which is the one thing a fixed viewport
 * ratio cannot size on its own: the height it has to fit into is shared out
 * between the rows, so the vh term is divided by the field.
 *
 * 36 is picked so a field of eight still clamps to the same 3rem the fixed
 * layout used on a 1080p screen — the television is unchanged for any grid
 * this game seats — while a phone turned sideways shrinks the rows rather
 * than pushing half the order below the fold, which on the one screen whose
 * entire job is "check the order" would be the whole feature failing.
 */
function listScale(n: number): React.CSSProperties {
  return {
    "--s-item": `clamp(0.8rem, min(6vw, ${(36 / Math.max(n, 1)).toFixed(2)}vh), 3rem)`,
  } as React.CSSProperties;
}

const LIST = "flex flex-col gap-[clamp(0.25rem,1.5vh,0.75rem)] text-[length:var(--s-item)]";

export default function ScreenView({
  raceId,
  variant = "big",
}: {
  raceId: string;
  variant?: "big" | "player";
}) {
  const { live, loading, error } = useLiveState(raceId);
  const { race } = useRace(raceId);
  const players = usePlayers();
  const participants = useParticipants(raceId);
  const now = useNow();

  // Called unconditionally, above the early returns, because hooks are — and
  // one per list because they measure different rows in different branches.
  const registerRoundRow = useFlipOrder(live?.roundOrder ?? NO_ORDER);
  const registerPositionRow = useFlipOrder(live?.positionOrder ?? NO_ORDER);

  const timer = readTimer(live, now);
  const nameOf = (id: string) => players.get(id)?.displayName ?? id;

  /**
   * The way out, on the phone only. A screen with no exit is a trap — the
   * same rule PlayerHeader exists for — and the television has no thumb to
   * offer it to.
   */
  const back =
    variant === "player" ? (
      <Link
        href={`/race/${raceId}/player`}
        className="shrink-0 rounded px-3 py-2 text-[length:var(--s-sub)] text-neutral-500 active:text-white"
      >
        ‹ Back
      </Link>
    ) : null;

  if (loading) return <Centered back={back}>Connecting…</Centered>;
  if (error) return <Centered back={back}>Connection error: {error.message}</Centered>;
  if (!live) return <Centered back={back}>Race not found.</Centered>;
  if (!live.positionOrder || !live.roundOrder) return <StaleRace raceId={raceId} />;

  // Before the flag drops there is no turn and no running clock. Showing the
  // usual layout would read as PAUSED, which is a different thing.
  if (race?.status === "scheduled") {
    return (
      <Shell>
        <TopRow back={back} />
        <div className="flex flex-1 flex-col items-center justify-center gap-[var(--s-gap)]">
          <p className="text-[length:var(--s-label)] uppercase tracking-widest text-neutral-500">
            {race.track} — starting grid
          </p>
          <ol style={listScale(live.positionOrder.length)} className={LIST}>
            {live.positionOrder.map((id, i) => (
              <li key={id}>
                <Pos>{i + 1}</Pos>
                {nameOf(id)}
              </li>
            ))}
          </ol>
        </div>
      </Shell>
    );
  }

  // Absent on races created before retirement was modelled.
  const retired = new Set(live.retired ?? []);

  // Nobody's turn means two different things — the race is over, or it is
  // between rounds. Discriminate on status, never on the null player. A big
  // screen showing nobody's turn with no explanation reads as a bug from
  // across the room, which is why this state gets its own rendering.
  if (race?.status !== "complete" && live.phase === "betweenRounds") {
    return (
      <Shell>
        <TopRow back={back} />
        <div className="flex flex-1 flex-col items-center justify-center gap-[var(--s-gap)]">
          <p className="text-[length:var(--s-label)] uppercase tracking-widest text-neutral-500">
            Round {live.currentRound - 1} done
          </p>
          <p className="text-[length:var(--s-hero)] font-semibold">Check the order</p>
          {/* The order the round will actually run in — which, between rounds,
              is what a drag on the tablet is editing. It slides rather than
              redrawing: from across the room a list that has just changed and a
              list that was always like that are the same picture, and the
              argument at the table is about exactly which one this is. */}
          <ol
            style={listScale(live.roundOrder.length)}
            className={`${LIST} text-neutral-300`}
          >
            {live.roundOrder.map((id, i) => (
              <li
                key={id}
                ref={registerRoundRow(id)}
                className={retired.has(id) ? "text-neutral-700 line-through" : undefined}
              >
                <Pos>{i + 1}</Pos>
                {nameOf(id)}
              </li>
            ))}
          </ol>
          <p className="text-[length:var(--s-row)] text-neutral-500">
            Round {live.currentRound} starts on the tablet
          </p>
        </div>
      </Shell>
    );
  }

  // Expiry carries no mechanical consequence — this is pure social pressure.
  const timerColor = timer.isExpired
    ? "text-red-500"
    : timer.remainingMs < 30_000
      ? "text-amber-400"
      : "text-emerald-400";

  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;

  return (
    <Shell className="justify-between">
      <header className="flex items-baseline justify-between gap-4 text-[length:var(--s-row)] text-neutral-400">
        <div className="flex min-w-0 items-baseline gap-2">
          {back}
          <span>Round {live.currentRound}</span>
        </div>
        {timer.isPaused && (
          <span className="shrink-0 rounded bg-neutral-800 px-4 py-1 text-[length:var(--s-label)]">
            PAUSED
          </span>
        )}
      </header>

      <div className="flex flex-col items-center">
        <p className="text-[length:var(--s-name)] text-neutral-300">
          {live.currentPlayerId ? nameOf(live.currentPlayerId) : "—"}
        </p>
        <p
          className={`font-mono text-[length:var(--s-timer)] leading-none tabular-nums ${timerColor}`}
        >
          {formatRemaining(timer.remainingMs)}
        </p>
      </div>

      <ol className="flex flex-wrap justify-center gap-x-[clamp(0.75rem,3vw,2.5rem)] gap-y-2 text-[length:var(--s-row)] text-neutral-400">
        {live.positionOrder.map((id, i) => {
          const roundIdx = live.roundOrder.indexOf(id);
          const alreadyMoved = roundIdx !== -1 && roundIdx < turnIndex;
          const laps = participants.get(id)?.lapsCompleted ?? 0;
          const isOut = retired.has(id);

          return (
            <li
              key={id}
              ref={registerPositionRow(id)}
              className={
                isOut
                  ? "text-neutral-700 line-through"
                  : id === live.currentPlayerId
                    ? "text-white"
                    : alreadyMoved
                      ? "text-neutral-600"
                      : undefined
              }
            >
              <span className="text-neutral-600">{i + 1}.</span> {nameOf(id)}
              <span className="ml-2 text-[length:var(--s-sub)] text-neutral-600">L{laps}</span>
            </li>
          );
        })}
      </ol>
    </Shell>
  );
}

/**
 * dvh rather than vh: on a phone, vh is the tallest the viewport ever gets,
 * so the standings would sit under the browser's own chrome until you
 * scrolled. On a desktop or a television the two are identical, which is what
 * lets one class serve both variants.
 */
function Shell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      style={SCALE}
      className={`flex min-h-dvh flex-col bg-black p-[var(--s-pad)] text-white ${className}`}
    >
      {children}
    </main>
  );
}

/**
 * Holds the top of the two centred states so the back link has somewhere to
 * live without pushing the content off centre — the body below is flex-1, so
 * it centres in whatever is left. Renders nothing at all on the television.
 */
function TopRow({ back }: { back: React.ReactNode }) {
  return back ? <div className="flex">{back}</div> : null;
}

function Pos({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-[clamp(0.5rem,1.5vw,1.5rem)] text-neutral-600">{children}</span>
  );
}

function Centered({
  back,
  children,
}: {
  back?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Shell>
      <TopRow back={back} />
      <div className="flex flex-1 items-center justify-center text-[length:var(--s-label)] text-neutral-400">
        {children}
      </div>
    </Shell>
  );
}
