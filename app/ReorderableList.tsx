"use client";

import { useDragOrder } from "./useDragOrder";

/**
 * The standings list, dragged by a ⠿ handle.
 *
 * The drag mechanics live in useDragOrder, shared with the track view: the row
 * lifts and follows the pointer while the rest slide out of its way. The rows
 * carry ↑/↓ buttons too — dragging is the fast path, not the only one.
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
  const { order, projectedIndex, registerRow, rowStyle, dragHandlers } =
    useDragOrder({
      items,
      onReorder,
      disabled,
    });

  return (
    <ol className="flex flex-col gap-1">
      {order.map((id) => (
        // The row is positioned by the hook: dragged rows follow the pointer,
        // the ones they pass ease aside. Nothing is dimmed — the lift is the
        // feedback, and a half-transparent row you are holding reads as broken.
        <li key={id} ref={registerRow(id)} style={rowStyle(id)}>
          <div className="flex items-center gap-2">
            <button
              aria-label={`Reorder ${id}`}
              disabled={disabled}
              {...dragHandlers(id)}
              className="cursor-grab select-none px-2 py-3 text-lg leading-none text-neutral-600 active:cursor-grabbing disabled:opacity-30"
            >
              ⠿
            </button>
            {/* The projected index, not the render index: the row sits where
                it was but reads as where it is going. */}
            <div className="flex-1">{renderRow(id, projectedIndex(id))}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
