"use client";

import { useRef, useState } from "react";

/**
 * Drag-to-reorder built on pointer events rather than HTML5 drag-and-drop.
 *
 * That is not a style preference: the device view is a touchscreen tablet, and
 * native drag events never fire on touch, so `draggable` would silently do
 * nothing on the one screen this is for. Pointer events cover touch, mouse and
 * pen with one code path and no dependency.
 *
 * The rows carry ↑/↓ buttons too — dragging is the fast path, not the only one.
 */
export default function ReorderableList({
  items,
  onReorder,
  renderRow,
  disabled = false,
}: {
  items: string[];
  onReorder: (next: string[]) => void;
  renderRow: (id: string, index: number) => React.ReactNode;
  disabled?: boolean;
}) {
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  // The ref is what the handlers read — a pointermove can arrive before React
  // has re-rendered, and a stale closure would drop the first few pixels of the
  // drag. The state exists only so the dragged row can be styled.
  const dragging = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Non-null only mid-drag: the live preview order the pointer is describing.
  const [preview, setPreview] = useState<string[] | null>(null);

  const order = preview ?? items;

  function begin(id: string, e: React.PointerEvent) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
    setDraggingId(id);
    setPreview(items);
  }

  /**
   * Finds the row the pointer is currently over by measuring the rendered rows,
   * which keeps this correct regardless of row height or gap.
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

  return (
    <ol className="flex flex-col gap-1">
      {order.map((id, i) => (
        <li
          key={id}
          ref={(el) => {
            if (el) rowRefs.current.set(id, el);
            else rowRefs.current.delete(id);
          }}
          className={draggingId === id ? "opacity-60" : undefined}
        >
          <div className="flex items-center gap-2">
            <button
              aria-label={`Reorder ${id}`}
              disabled={disabled}
              onPointerDown={(e) => begin(id, e)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              // Without this the browser scrolls the page instead of dragging.
              style={{ touchAction: "none" }}
              className="cursor-grab select-none px-2 py-3 text-lg leading-none text-neutral-600 active:cursor-grabbing disabled:opacity-30"
            >
              ⠿
            </button>
            <div className="flex-1">{renderRow(id, i)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
