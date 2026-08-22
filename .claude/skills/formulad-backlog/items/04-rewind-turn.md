# 4 — Go back a turn: reset the clock and auto-pause

`rewindTurn` already exists in `lib/race.ts` and already steps back to the
previous player, crossing at most one round boundary via `previousRoundOrder`.
Two behaviours change:

1. **The clock resets** to the race's full turn duration, not whatever remained.
2. **The timer auto-pauses** — rewinding means something went wrong at the table
   and people are talking about it. Don't start a clock on that.

## The missing field

`turnDurationMs` is not the race's configured turn length: `pauseTurn` overwrites
it with the remaining time. There is currently **no record of the configured
duration** on the live doc, so "reset the clock" has nothing to reset to.

Add `turnDurationDefaultMs?: number` to `LiveState` in `lib/types.ts`:

- Seeded by `createRace` in `lib/setup.ts` from `input.turnSeconds * 1000`.
- **Optional**, because races created before this field exists don't have it.
  Every reader falls back to `live.turnDurationMs`. Do not migrate.
- This is the field item 6's "edit turn seconds" edits.

## The change to `rewindTurn`

In both branches (within-round and crossing back a round), replace
`turnStartedAt: serverTimestamp()` with:

```
turnStartedAt: null,
turnDurationMs: live.turnDurationDefaultMs ?? live.turnDurationMs,
```

`turnStartedAt: null` *is* the paused state — `readTimer()` already reads it that
way and `turnDurationMs` already holds what's left. **Do not add a pause flag.**
The render path stays identical everywhere, which is the whole reason the timer
is state and not a process.

## Events

Keep emitting `turnRewound` alone. Do not also emit `turnPaused`: one action is
one event, and "a rewind leaves the race paused with a fresh clock" is a rule of
the system, not a separate thing that happened. Record that rule in `AGENTS.md`
so replay stays reconstructable.

## Also update

`AGENTS.md` currently states that `rewindTurn` "re-anchors the clock, so the
corrected player gets a fresh turn," and `lib/race.ts` says the same in its
doc comment. Both become wrong — fix them in this commit.

The deliberate non-behaviour stays: rewinding still makes **no attempt to restore
`positionOrder`**. Standings are human-nudged and the operator is looking
straight at the board.

## Smoke coverage

`scripts/smoke.ts` must assert, after a rewind: `turnStartedAt` is null, and
`turnDurationMs` equals the configured default. Cover the round-boundary case
too — it is the branch with the interesting arithmetic.

## Acceptance

- Rewinding steps back one car, resets to full duration, and leaves it paused.
- Resuming starts a full turn.
- Rewinding across a round boundary does the same and decrements `currentRound`.
- A race with no `turnDurationDefaultMs` rewinds without crashing.
