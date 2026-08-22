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
 * The two consumers differ only in what they draw — rows with a ⠿ handle, or
 * cars on a strip of asphalt — so the hit-testing and preview state live here
 * and the views stay presentational.
 */
export function useDragOrder({
  items,
  onReorder,
  disabled = false,
}: {
  items: string[];
  onReorder: (next: string[]) => void;
  disabled?: boolean;
}) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // The ref is what the handlers read — a pointermove can arrive before React
  // has re-rendered, and a stale closure would drop the first few pixels of the
  // drag. The state exists only so the dragged item can be styled.
  const dragging = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Non-null only mid-drag: the live preview order the pointer is describing.
  const [preview, setPreview] = useState<string[] | null>(null);

  function begin(id: string, e: React.PointerEvent) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
    setDraggingId(id);
    setPreview(items);
  }

  /**
   * Finds the item the pointer is currently over by measuring the rendered
   * elements, which keeps this correct regardless of size, gap or layout.
   */
  function move(e: React.PointerEvent) {
    const id = dragging.current;
    if (!id || !preview) return;

    const from = preview.indexOf(id);
    let to = from;

    for (const [rowId, el] of rowRefs.current) {
      const box = el.getBoundingClientRect();
      if (e.clientY >= box.top && e.clientY <= box.bottom) {
        to = preview.indexOf(rowId);
        break;
      }
    }

    if (to === from || to === -1) return;
    const next = [...preview];
    next.splice(to, 0, ...next.splice(from, 1));
    setPreview(next);
  }

  function end() {
    const id = dragging.current;
    dragging.current = null;
    setDraggingId(null);
    if (!id || !preview) return setPreview(null);

    // Only write when the drag actually changed something.
    const changed = preview.some((p, i) => p !== items[i]);
    setPreview(null);
    if (changed) onReorder(preview);
  }

  return {
    /** The order to render: the drag preview while dragging, else the truth. */
    order: preview ?? items,
    draggingId,
    /** Ref callback registering an element for pointer hit-testing. */
    registerRow: (id: string) => (el: HTMLElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
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
