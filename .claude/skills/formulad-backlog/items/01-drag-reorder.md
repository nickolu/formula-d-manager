# 1 — Drag-to-reorder from the player view (mobile-first)

**Status: done.** Recorded here so the backlog stays complete.

Shipped in `67f7103` plus the working-tree follow-up: pointer-event drag on both
renderings of the standings.

- `app/useDragOrder.ts` — the shared mechanics.
- `app/ReorderableList.tsx` — the list rendering.
- `app/race/[raceId]/device/TrackView.tsx` — the track rendering.

Built on **pointer events, not HTML5 drag-and-drop**, because native drag events
never fire on touch — `draggable` would silently do nothing on the one screen
this is for. The ↑/↓ buttons stay as a fallback. Dragging emits the same
`setPositionOrder` mutation the buttons do.

## Before closing it out

Verify on an actual touch device, not a desktop browser emulating touch:

- Drag does not fight vertical page scroll.
- Touch targets are thumb-sized at phone width.
- Both renderings (list and track) reorder identically and persist.
- The ↑/↓ fallback still works.

If any of these fail, reopen it in `BACKLOG.md` as a mobile polish pass rather
than fixing it silently inside another item.
