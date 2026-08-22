# 11 — Per-player car status

Replace the physical car status card: remaining tires, brakes, gearbox, engine,
body, nitro. Off by default, enabled per race in settings. When on, the My Racer
subview gains a **My Car** section.

**Depends on:** item 6 (settings), item 10 (My Racer).

**First iteration has no permissions and no cheat prevention** — anyone can
change anyone's values, exactly as anyone can reach across the table and move
your pegs. Don't build ownership checks; the claim from item 10 decides whose
card shows under "My Car", nothing more.

## This is not board state

`AGENTS.md` rejects modelling the board: no car positions, no gear, no wear
tokens. This item is not a reversal of that.

The distinction: the app never *derives* anything from these numbers and never
enforces a rule with them. It is a shared counter standing in for a piece of
cardboard, the way the standings list stands in for looking at the table. It
cannot desync the game because nothing consults it. **Keep it that way** — the
moment something validates a move against remaining tires, this becomes a board
model and the rejection applies. Record this distinction in `AGENTS.md`.

## Configurable, not hardcoded

Maxima vary by house variant (the user's card has tires at 30). Follow the
`scoringConfig` precedent: **config in Firestore, not in code**, so a variant
doesn't need a deploy.

In `races/{id}.settings`:

```ts
carStatus?: {
  enabled: boolean;
  spec: { key: string; label: string; max: number }[];
};
```

`createRace` seeds a sensible default spec with `enabled: false`. Absent means
off, so old races are untouched.

Values live on the participant: `carStatus?: Record<string, number>` in
`Participant`. A key absent means full — don't backfill.

## The mutation

```ts
setCarStatus(raceId, playerId, key, value, who)
```

One transaction: clamp to `0..max` from the spec, reject an unknown key, update
the participant doc, append a `carStatusChanged` event carrying key, old and new
value. Add it to the union.

Clamp **server-side in the function**, not only in the UI. The user's rule is
"any new value within the limit on the card" — the limit is the only constraint,
and it belongs where every caller (including the Phase 3 chatbot) hits it.

## The peg UI

Make it analogous to the physical card, but a row of 30 tappable dots does not
fit a phone.

- **max ≤ 12:** a row of pegs. Tap a peg to set remaining to that count — the
  same gesture as pulling pegs out, and it reaches any value in one tap.
- **max > 12:** a peg strip that reads as a bar, plus −/+ steppers for
  single-value changes, plus tap-to-set on the strip. Steppers carry the common
  case (lose one tire), the strip carries the jump.

Filled and empty pegs need a non-colour distinction as well as colour — this is
read fast, in a lit room, over a game board.

Every property gets its label and a `remaining / max` readout. Don't rely on
counting dots.

## Where it appears

- **My Car** section in My Racer, when enabled — the player's own claimed racer.
- The **racer overview modal** (item 10) for any racer, so you can check a rival's
  card the way you'd look across the table.
- Not on the turn-order or track subviews. Those are about order; this is not.

## Acceptance

- Off by default; enabling it in settings reveals My Car and the modal section.
- Setting a value persists, appends an event, and is visible on other devices.
- Values clamp to the spec in `lib/race.ts`, not just the UI.
- Old races and participants with no `carStatus` render as full.
- Usable one-handed at phone width, including a max-30 property.
- Smoke coverage for `setCarStatus`, including clamping and an unknown key.
