"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { startOf } from "@/lib/setup";
import type { CarStatusProperty, GearRange } from "@/lib/types";

/**
 * The car status card, as pegs.
 *
 * A stand-in for the piece of cardboard, not a model of the board: nothing in
 * the app derives anything from these numbers or enforces a rule with them, so
 * it cannot desync the game the way modelling positions or a gear the app acted
 * on would.
 *
 * There are no permissions here on purpose — anyone can change anyone's card,
 * exactly as anyone can reach across the table and move your pegs.
 *
 * **Every change renders immediately, before the write lands.** These mutations
 * are transactions, and Firestore's latency compensation does not cover
 * transactions the way it covers plain writes — the local cache has nothing to
 * show until the server answers. Waiting on that made pulling a peg feel like a
 * form submission rather than moving a peg, so the tapped value is held locally
 * and shown at once, then dropped once the write settles and the streamed value
 * is the truth again. Nothing is disabled mid-write either: dimming the card on
 * every tap was most of what made it feel slow.
 */
export default function CarStatusCard({
  spec,
  values,
  onSet,
  gears,
  gear,
  onSetGear,
  disabled = false,
}: {
  spec: CarStatusProperty[];
  values: Record<string, number> | undefined;
  onSet: (key: string, value: number) => Promise<void>;
  gears: GearRange[];
  gear: number | null;
  onSetGear: (gear: number | null) => Promise<void>;
  disabled?: boolean;
}) {
  // The truth as streamed, gear included, so one optimistic layer covers both.
  // Absent means the property's starting value: a car nobody has touched is
  // undamaged, and undamaged is not the same as full once upgrades let it hold
  // more than it starts with.
  const actual = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const property of spec) {
      map.set(property.key, values?.[property.key] ?? startOf(property));
    }
    map.set(GEAR, gear);
    return map;
  }, [spec, values, gear]);

  const card = useOptimistic<string, number | null>(actual, (key, value) =>
    key === GEAR ? onSetGear(value) : onSet(key, value as number),
  );

  return (
    <div className="flex flex-col gap-4">
      <GearSelector
        gears={gears}
        gear={card.shown(GEAR, gear)}
        onSetGear={(next) => card.set(GEAR, next)}
        disabled={disabled}
      />

      {spec.map((property) => (
        <PropertyRow
          key={property.key}
          property={property}
          remaining={
            card.shown(property.key, actual.get(property.key) ?? 0) as number
          }
          onSet={(value) => card.set(property.key, value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/** Reserved key: the lever rides the same optimistic layer as the properties. */
const GEAR = "\u0000gear";

/**
 * Shows what was just tapped, and gets out of the way without a flicker.
 *
 * The subtlety is when to STOP showing the held value. Releasing it when the
 * write resolves is wrong and was the original flicker: a transaction's promise
 * settles when the server commits, which is *before* the snapshot carrying that
 * commit arrives, so for one frame the row fell back to the pre-tap value.
 *
 * So a held value is released only when keeping it would be wrong:
 *
 *   - the write failed        — drop it, which is the whole undo; the streamed
 *                               value is already the truth. This is why the
 *                               injected `write` must rethrow rather than
 *                               swallow: the undo hangs off that rejection.
 *   - someone else moved it   — the store settled on something that is neither
 *                               our value nor what was there when our write
 *                               landed, so theirs wins
 *
 * When the store simply catches up with what we are already showing, nothing
 * happens at all: the held value and the streamed one agree, so dropping it
 * would only cost a render that changes nothing. A successful tap therefore
 * renders exactly once.
 */
function useOptimistic<K extends string, V>(
  actual: Map<K, V>,
  write: (key: K, value: V) => Promise<void>,
) {
  const [held, setHeld] = useState<Map<K, V>>(new Map());
  const outstanding = useRef(new Map<K, number>());
  // What the store held at the moment our last write for this key finished.
  // A later move away from it can only be someone else's.
  const settledAgainst = useRef(new Map<K, V>());

  const drop = (key: K) => {
    settledAgainst.current.delete(key);
    setHeld((h) => {
      if (!h.has(key)) return h;
      const next = new Map(h);
      next.delete(key);
      return next;
    });
  };

  useEffect(() => {
    for (const [key, value] of held) {
      if ((outstanding.current.get(key) ?? 0) > 0) continue;
      const now = actual.get(key) as V;
      if (now === value) continue; // caught up — leave it be, nothing to re-render
      if (
        settledAgainst.current.has(key) &&
        now !== settledAgainst.current.get(key)
      ) {
        drop(key);
      }
    }
    // `drop` is stable enough for this: it only closes over setHeld and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actual, held]);

  return {
    shown: (key: K, fallback: V) => (held.has(key) ? (held.get(key) as V) : fallback),
    set: async (key: K, value: V) => {
      const before = actual.get(key) as V;
      setHeld((h) => new Map(h).set(key, value));
      outstanding.current.set(key, (outstanding.current.get(key) ?? 0) + 1);
      try {
        await write(key, value);
        settledAgainst.current.set(key, before);
      } catch {
        // The undo. No rethrow: `write` has already reported the failure, and
        // this promise is handed to a click handler that cannot await it.
        drop(key);
      } finally {
        outstanding.current.set(key, (outstanding.current.get(key) ?? 1) - 1);
      }
    },
  };
}

/**
 * The gear lever, with each gear's dice range printed under it — the same
 * information as the card, in the same place you change it.
 *
 * Tapping the current gear clears it, matching the peg gesture: tapping the
 * last filled peg pulls it out.
 */
function GearSelector({
  gears,
  gear,
  onSetGear,
  disabled,
}: {
  gears: GearRange[];
  gear: number | null;
  onSetGear: (gear: number | null) => void | Promise<void>;
  disabled: boolean;
}) {
  const current = gears.find((g) => g.gear === gear);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm">Gear</span>
        <span className="font-mono text-sm tabular-nums text-neutral-400">
          {current ? `${current.min}–${current.max}` : "—"}
        </span>
      </div>

      <div className="flex gap-1">
        {gears.map((g) => {
          const active = g.gear === gear;
          return (
            <button
              key={g.gear}
              onClick={() => onSetGear(active ? null : g.gear)}
              disabled={disabled}
              aria-pressed={active}
              className={`flex-1 rounded-lg border py-2 disabled:opacity-40 ${
                active
                  ? "border-emerald-400 bg-emerald-500 text-neutral-950"
                  : "border-neutral-700 text-neutral-300"
              }`}
            >
              <span className="block text-lg font-semibold leading-none">
                {g.gear}
              </span>
              <span
                className={`mt-1 block text-[10px] leading-none tabular-nums ${
                  active ? "text-neutral-900" : "text-neutral-500"
                }`}
              >
                {g.min}–{g.max}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Past this many, a row of tap targets stops fitting a phone. */
const WIDE = 12;

function PropertyRow({
  property,
  remaining,
  onSet,
  disabled,
}: {
  property: CarStatusProperty;
  remaining: number;
  onSet: (value: number) => void | Promise<void>;
  disabled: boolean;
}) {
  const wide = property.max > WIDE;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        {/* Never rely on counting dots — this is read fast, over a board. */}
        <span className="text-sm">{property.label}</span>
        <span className="font-mono text-sm tabular-nums text-neutral-400">
          {remaining} / {property.max}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {wide && (
          // Steppers carry the common case (lose one tire); the strip carries
          // the jump.
          <Stepper
            label={`Remove one ${property.label}`}
            symbol="−"
            onClick={() => onSet(remaining - 1)}
            disabled={disabled || remaining === 0}
          />
        )}

        <div className={`flex flex-1 ${wide ? "gap-px" : "gap-1.5"}`}>
          {Array.from({ length: property.max }, (_, i) => {
            const filled = i < remaining;
            return (
              <button
                key={i}
                aria-label={`Set ${property.label} to ${i + 1}`}
                disabled={disabled}
                // Tapping the last filled peg pulls it out — the physical
                // gesture — so zero is reachable without a special control.
                onClick={() => onSet(remaining === i + 1 ? i : i + 1)}
                className={`flex-1 rounded-sm border disabled:opacity-40 ${
                  wide ? "h-8" : "h-10"
                } ${
                  filled
                    ? "border-emerald-400 bg-emerald-500"
                    : "border-neutral-700 bg-transparent"
                }`}
              >
                {/* Shape, not only colour: an empty peg is hollow. */}
                <span className="sr-only">{filled ? "filled" : "empty"}</span>
              </button>
            );
          })}
        </div>

        {wide && (
          <Stepper
            label={`Add one ${property.label}`}
            symbol="+"
            onClick={() => onSet(remaining + 1)}
            disabled={disabled || remaining === property.max}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  symbol,
  onClick,
  disabled,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-11 w-11 shrink-0 rounded-xl border border-neutral-700 text-xl active:bg-neutral-800 disabled:opacity-30"
    >
      {symbol}
    </button>
  );
}
