"use client";

import { useState } from "react";
import { assignCars, readableInk } from "@/lib/cars";
import type { LiveState, Participant, Player, PlayerId } from "@/lib/types";
import { useDragOrder } from "@/app/useDragOrder";

/**
 * The running order drawn as cars on a strip of asphalt, top-down, travelling
 * up the screen — leader nearest the flag.
 *
 * Position here means *standings order only*. The app deliberately models no
 * board state (no spaces, no gear, no wear), so a car's real location on the
 * table is unknowable and nothing on this screen claims otherwise: cars are
 * evenly spaced, and the only other axis drawn is laps, which is real data.
 * This is a second rendering of positionOrder, not a second source of truth.
 *
 * Dragging a car writes the same setPositionOrder mutation the list view does.
 */
export default function TrackView({
  live,
  players,
  participants,
  onReorder,
  onCompleteLap,
  onToggleDnf,
  disabled = false,
}: {
  live: LiveState;
  players: Map<PlayerId, Player>;
  participants: Map<PlayerId, Participant>;
  onReorder: (next: PlayerId[]) => void;
  onCompleteLap: (id: PlayerId) => void;
  onToggleDnf: (id: PlayerId, dnf: boolean) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<PlayerId | null>(null);

  const { order, draggingId, registerRow, dragHandlers } = useDragOrder({
    items: live.positionOrder,
    onReorder,
    disabled,
  });

  const cars = assignCars(live.positionOrder, players);
  const retired = new Set(live.retired ?? []);
  const turnIndex = live.currentPlayerId
    ? live.roundOrder.indexOf(live.currentPlayerId)
    : -1;

  const lapsOf = (id: PlayerId) => participants.get(id)?.lapsCompleted ?? 0;
  const nameOf = (id: PlayerId) => players.get(id)?.displayName ?? id;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
      {/* Direction of travel is up, so the flag caps the top of the strip. */}
      <div
        className="h-3 w-full"
        style={{
          backgroundImage:
            "repeating-conic-gradient(#e5e5e5 0% 25%, #262626 0% 50%)",
          backgroundSize: "16px 16px",
        }}
      />

      <ol className="relative flex flex-col gap-1 px-3 py-4">
        {/* Lane divider, drawn behind the cars. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[repeating-linear-gradient(to_bottom,#525252_0_10px,transparent_10px_24px)]"
        />

        {order.map((id, i) => {
          const car = cars.get(id)!;
          const isOut = retired.has(id);
          const isCurrent = id === live.currentPlayerId;
          const roundIdx = live.roundOrder.indexOf(id);
          const alreadyMoved = roundIdx !== -1 && roundIdx < turnIndex;
          const laps = lapsOf(id);

          // A gantry wherever the car ahead is on a different lap. Cars are
          // evenly spaced, so this is the only honest depth cue available.
          const lapBreak = i > 0 && lapsOf(order[i - 1]) !== laps;

          return (
            <li key={id}>
              {lapBreak && (
                <div className="my-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-neutral-700" />
                  <span className="text-[10px] uppercase tracking-widest text-neutral-500">
                    lap {laps}
                  </span>
                  <div className="h-px flex-1 bg-neutral-700" />
                </div>
              )}

              <div
                ref={registerRow(id)}
                // Alternating lanes read as a gaggle of cars rather than a
                // column of buttons. Purely cosmetic — order is the data.
                className={`flex items-center gap-3 ${
                  i % 2 === 0 ? "flex-row" : "flex-row-reverse"
                } ${draggingId === id ? "opacity-60" : ""}`}
              >
                <button
                  aria-label={`Drag ${nameOf(id)} to reorder`}
                  disabled={disabled}
                  {...dragHandlers(id)}
                  className={`relative flex h-14 w-14 shrink-0 cursor-grab select-none items-center justify-center rounded-xl text-xl font-bold shadow-lg transition active:cursor-grabbing disabled:opacity-30 ${
                    isCurrent ? "ring-4 ring-emerald-400" : ""
                  } ${isOut ? "opacity-40 grayscale" : ""} ${
                    alreadyMoved && !isCurrent && !isOut ? "opacity-70" : ""
                  }`}
                  style={{
                    background: car.colour,
                    color: readableInk(car.colour),
                  }}
                >
                  {/* Nose, pointing the way the car is travelling. */}
                  <span
                    aria-hidden
                    className="absolute -top-1 left-1/2 h-2 w-6 -translate-x-1/2 rounded-t-sm opacity-80"
                    style={{ background: car.colour }}
                  />
                  {car.label}
                  {isOut && (
                    <span
                      aria-hidden
                      className="absolute inset-0 flex items-center justify-center text-3xl text-red-500"
                    >
                      ✕
                    </span>
                  )}
                </button>

                {/* Tapping the name opens the actions. Selection deliberately
                    is not on the car itself — that target belongs to the drag,
                    and one element can't own both gestures cleanly. */}
                <button
                  onClick={() => setSelected(selected === id ? null : id)}
                  className={`flex min-w-0 flex-1 flex-col py-2 ${
                    i % 2 === 0 ? "items-start text-left" : "items-end text-right"
                  }`}
                >
                  <span
                    className={`truncate text-lg ${
                      isOut
                        ? "text-neutral-600 line-through"
                        : isCurrent
                          ? "font-semibold text-emerald-400"
                          : alreadyMoved
                            ? "text-neutral-500"
                            : "text-white"
                    }`}
                  >
                    <span className="mr-2 text-neutral-600">P{i + 1}</span>
                    {nameOf(id)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    lap {laps}
                    {isCurrent && " · driving now"}
                    {isOut && " · out"}
                  </span>
                </button>
              </div>

              {selected === id && (
                <div
                  className={`mt-1 flex gap-2 ${
                    i % 2 === 0 ? "justify-start pl-16" : "justify-end pr-16"
                  }`}
                >
                  <button
                    onClick={() => onCompleteLap(id)}
                    disabled={disabled || isOut}
                    className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-300 disabled:opacity-30"
                  >
                    +lap
                  </button>
                  <button
                    onClick={() => onToggleDnf(id, !isOut)}
                    disabled={disabled}
                    className={`rounded border px-3 py-2 text-sm disabled:opacity-30 ${
                      isOut
                        ? "border-red-800 bg-red-950/50 text-red-400"
                        : "border-neutral-700 text-neutral-400"
                    }`}
                  >
                    {isOut ? "Un-retire" : "DNF"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="border-t border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600">
        Drag a car to reorder · tap a name for lap and DNF
      </p>
    </div>
  );
}
