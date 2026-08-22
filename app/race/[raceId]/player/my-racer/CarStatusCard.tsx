"use client";

import type { CarStatusProperty } from "@/lib/types";

/**
 * The car status card, as pegs.
 *
 * A stand-in for the piece of cardboard, not a model of the board: nothing in
 * the app derives anything from these numbers or enforces a rule with them, so
 * it cannot desync the game the way modelling positions or gear would.
 *
 * There are no permissions here on purpose — anyone can change anyone's card,
 * exactly as anyone can reach across the table and move your pegs.
 */
export default function CarStatusCard({
  spec,
  values,
  onSet,
  disabled = false,
}: {
  spec: CarStatusProperty[];
  values: Record<string, number> | undefined;
  onSet: (key: string, value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {spec.map((property) => (
        <PropertyRow
          key={property.key}
          property={property}
          // Absent means full: a car nobody has touched is undamaged.
          remaining={values?.[property.key] ?? property.max}
          onSet={(value) => onSet(property.key, value)}
          disabled={disabled}
        />
      ))}
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
  onSet: (value: number) => void;
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
