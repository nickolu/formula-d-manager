"use client";

import { useDragOrder } from "./useDragOrder";

/**
 * The standings list, dragged by a ⠿ handle.
 *
 * The drag mechanics live in useDragOrder, shared with the track view. The rows
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
  const { order, draggingId, registerRow, dragHandlers } = useDragOrder({
    items,
    onReorder,
    disabled,
  });

  return (
    <ol className="flex flex-col gap-1">
      {order.map((id, i) => (
        <li
          key={id}
          ref={registerRow(id)}
          className={draggingId === id ? "opacity-60" : undefined}
        >
          <div className="flex items-center gap-2">
            <button
              aria-label={`Reorder ${id}`}
              disabled={disabled}
              {...dragHandlers(id)}
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
