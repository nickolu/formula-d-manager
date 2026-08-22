# 8 — Notes in the results view

Record why a player didn't finish.

**Depends on:** item 5 (the rename).

## The decision you asked me to make

**One optional free-text note per participant**, not a DNF-only reason field.

The UI labels it by context — "Reason" for a retired car, "Note" otherwise — so
the DNF case reads exactly like a dedicated reason field, but "blew the engine on
lap 3" and "won on the last corner" are the same shape of data and there is no
second schema to add later. It also survives un-retiring: with a DNF-only field,
`setDnf(false)` either orphans the reason or silently destroys it. Neither is
good, and both are avoidable by not coupling the note to the flag.

## Where it lives

`Participant` in `lib/types.ts` gains `note?: string`. Not on `RaceResult` — that
is a scoring cache, notes are not scoring input, and `computeStandings` stays a
pure function of finishes.

New `lib/race.ts` function:

```ts
setParticipantNote(raceId, playerId, note, who)
```

One transaction: update the participant doc, append a `participantNoteSet` event
carrying the text. Add the event to the union in `lib/types.ts`.

An empty string clears it — write `note: ""` rather than deleting the field, so
the change still appends an event and history shows the clearing.

## UI

In the results view (`ResultsView.tsx`), a note field per player in the finishing
order. Give retired players' fields visual weight — that is the case this exists
for — but don't hide the others behind a disclosure; a note is more likely to get
written if the box is already there.

Notes are editable after the race is sealed. They are commentary, not results:
`finishRace`'s validation of `order` is untouched by this item.

Surface notes in item 3's history view (`participantNoteSet` needs a rendering)
and in item 10's racer overview modal.

## Acceptance

- A note saves, persists, and appends an event.
- Clearing a note appends an event too.
- Notes survive `setDnf` in both directions.
- Notes are editable on a complete race.
- Smoke coverage for `setParticipantNote`.
