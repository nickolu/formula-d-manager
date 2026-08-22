"use client";

import { useRef, useState } from "react";

/**
 * Drag-to-reorder mechanics, shared by the standings list and the track view.
 *
 * Pointer events rather than HTML5 drag-and-drop: the player view is used on
 * phones and a shared tablet, and native drag events never fire on touch, so
 * `draggable` would silently do nothing on the one screen this is for. Pointer
 * events cover touch, mouse and pen with one code path and no dependency.
 *
 * **The DOM order does not change while dragging.** An earlier version spliced
 * a preview array on every pointermove, so the rows jumped between slots and
 * the thing under your finger was whatever had landed there — legible, but it
 * never felt like moving an object. Now the list stands still and everything
 * moves by transform: the dragged row follows the pointer, and the rows it
 * passes slide out of its way. Only on drop does the real order change.
 *
 * That is also why the geometry is measured once, at drag start: with nothing
 * reflowing mid-drag those measurements stay true, so the arithmetic is a
 * subtraction rather than a re-measure on every frame.
 *
 * The drop is held optimistically for the same reason the car card holds a
 * tapped value: `onReorder` is a Firestore transaction, and clearing the
 * transforms the moment the pointer lifts would snap the row back to where it
 * started and leave it there for the whole round-trip before the new order
 * arrived. Instead the dropped order is adopted immediately and released once
 * the real list agrees with it — or dropped, reverting, if the write fails.
 *
 * The two consumers differ only in what they draw — rows with a ⠿ handle, or
 * cars on a strip of asphalt — so the hit-testing and the transforms live here
 * and the views stay presentational.
 */
interface Drag {
  id: string;
  /**
   * The order as it stood when the drag began. Held in state rather than a ref
   * because the render reads it — the rows are positioned against this list,
   * not against the live one.
   */
  ids: string[];
  from: number;
  /** Where it would land if dropped now. */
  to: number;
  /** How far the pointer has travelled since the drag began. */
  dy: number;
  /** Height of the dragged row plus the gap — how far a displaced row moves. */
  slot: number;
}

export function useDragOrder({
  items,
  onReorder,
  disabled = false,
}: {
  items: string[];
  onReorder: (next: string[]) => void | Promise<void>;
  disabled?: boolean;
}) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  // The order just dropped, held until the real list catches up, along with
  // what the list looked like at the moment of the drop.
  const [dropped, setDropped] = useState<{
    order: string[];
    before: string[];
  } | null>(null);

  // Reconciled during render rather than in an effect: this is adjusting state
  // because a prop arrived, which React does in-place without committing the
  // intermediate pass.
  //
  // While the write is in flight `items` still reads as it did before the drop,
  // so those two comparisons are enough to tell the three cases apart without
  // waiting on the write at all — which matters, because the write resolves a
  // round-trip before the snapshot carrying it arrives.
  let holding = dropped;
  if (
    holding &&
    // Ours landed, or somebody else moved the list out from under it.
    (sameOrder(items, holding.order) || !sameOrder(items, holding.before))
  ) {
    setDropped(null);
    holding = null;
  }

  /** What is on screen: the dropped order while it is still in flight. */
  const shown = holding?.order ?? items;

  // The handlers read refs, not state: a pointermove can arrive before React
  // has re-rendered, and a stale closure would drop the first few pixels.
  const active = useRef<Drag | null>(null);
  const startY = useRef(0);
  // Row geometry frozen at drag start, read only by the pointer handlers.
  const frozen = useRef<{ tops: number[]; heights: number[] }>({
    tops: [],
    heights: [],
  });

  function begin(id: string, e: React.PointerEvent) {
    if (disabled) return;
    const from = shown.indexOf(id);
    if (from === -1) return;

    const tops: number[] = [];
    const heights: number[] = [];
    for (const rowId of shown) {
      const box = rowRefs.current.get(rowId)?.getBoundingClientRect();
      tops.push(box?.top ?? 0);
      heights.push(box?.height ?? 0);
    }

    // The gap between rows is layout the views own, so read it rather than
    // hardcoding it — the list and the track space their rows differently.
    const gap =
      shown.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;

    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    frozen.current = { tops, heights };

    const next = {
      id,
      ids: [...shown],
      from,
      to: from,
      dy: 0,
      slot: heights[from] + gap,
    };
    active.current = next;
    setDrag(next);
  }

  function move(e: React.PointerEvent) {
    const current = active.current;
    if (!current) return;

    const { tops, heights } = frozen.current;
    const dy = e.clientY - startY.current;

    // Walk outwards from the row's own slot for as long as the pointer is past
    // the midpoint of the next one. Measuring against the frozen layout is what
    // keeps this stable — the rows it describes are not the rows on screen.
    let to = current.from;
    if (dy > 0) {
      for (let i = current.from + 1; i < tops.length; i++) {
        if (e.clientY < tops[i] + heights[i] / 2) break;
        to = i;
      }
    } else {
      for (let i = current.from - 1; i >= 0; i--) {
        if (e.clientY > tops[i] + heights[i] / 2) break;
        to = i;
      }
    }

    if (dy === current.dy && to === current.to) return;
    const next = { ...current, dy, to };
    active.current = next;
    setDrag(next);
  }

  async function end() {
    const current = active.current;
    active.current = null;
    if (!current || current.to === current.from) {
      setDrag(null);
      return;
    }

    // Reorder the list as it was when the drag began: that is the list the
    // indices describe.
    const next = [...current.ids];
    next.splice(current.to, 0, ...next.splice(current.from, 1));

    // Adopted and un-transformed in the same render, so the row is laid out
    // where it already appears to be rather than snapping back and waiting.
    setDropped({ order: next, before: current.ids });
    setDrag(null);

    try {
      await onReorder(next);
    } catch {
      // The undo. The list underneath was never wrong.
      setDropped(null);
    }
  }

  // The order as it would be if the drag ended now. The DOM keeps the old one
  // — that is what makes the motion fluid — so anything that *reads* as a
  // position, like a row's number, has to come from here instead of from the
  // render index, or it would sit there contradicting what the eye can see.
  const projected = (() => {
    if (!drag) return shown;
    if (drag.to === drag.from) return drag.ids;
    const next = [...drag.ids];
    next.splice(drag.to, 0, ...next.splice(drag.from, 1));
    return next;
  })();

  return {
    /** Render order. Stays put during a drag; only the transforms move. */
    order: shown,
    /** Where a row would rank if the drag ended now. */
    projectedIndex: (id: string) => {
      const i = projected.indexOf(id);
      return i === -1 ? shown.indexOf(id) : i;
    },
    draggingId: drag?.id ?? null,
    /** Ref callback registering an element for measurement and transforms. */
    registerRow: (id: string) => (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    /**
     * Where a row should sit right now. The dragged one tracks the pointer with
     * no transition — anything else lags behind the finger — while the rows it
     * displaces ease into their new slots.
     */
    rowStyle: (id: string): React.CSSProperties | undefined => {
      if (!drag) return undefined;

      if (id === drag.id) {
        return {
          transform: `translateY(${drag.dy}px) scale(1.03)`,
          zIndex: 30,
          position: "relative",
          // Lifted off the page, so it needs to cast onto what it passes over.
          boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
          transition: "none",
          willChange: "transform",
          cursor: "grabbing",
        };
      }

      const i = drag.ids.indexOf(id);
      const displaced =
        i === -1
          ? 0
          : drag.from < i && i <= drag.to
            ? -drag.slot
            : drag.to <= i && i < drag.from
              ? drag.slot
              : 0;

      return {
        transform: `translateY(${displaced}px)`,
        transition: "transform 160ms cubic-bezier(0.2, 0, 0, 1)",
        willChange: displaced === 0 ? undefined : "transform",
      };
    },
    /** Spread onto whatever element should start a drag. */
    dragHandlers: (id: string) => ({
      onPointerDown: (e: React.PointerEvent) => begin(id, e),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      // Without this the browser scrolls the page instead of dragging.
      style: { touchAction: "none" as const },
    }),
  };
}

function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
