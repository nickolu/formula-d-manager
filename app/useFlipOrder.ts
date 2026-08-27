"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Names that slide to their new places when the order changes.
 *
 * The big screen is read from across a room, and between rounds it is what the
 * table is arguing over — somebody says "no, I passed you", the tablet is
 * dragged, and the projector's list silently redraws in a different order. A
 * list that has *changed* and a list that was always like that look identical
 * from six feet away. The motion is the only thing that says which one you are
 * looking at, and whose name moved.
 *
 * FLIP, so nothing in the layout is faked: React re-renders into the new order
 * as usual, and each row is measured before and after, then played back from
 * where it was to where it now is. The transform is an animation rather than a
 * transition on a style, so the DOM the next render sees is untouched.
 *
 * Measurement is two passes on purpose. getBoundingClientRect includes
 * transforms, so recording a row's new home in the same pass that starts its
 * animation would record wherever the animation had just put it — every
 * subsequent change would then be measured against a lie.
 */
export function useFlipOrder(ids: string[]) {
  const rows = useRef(new Map<string, HTMLElement>());
  const previous = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    // Pass one: where everything is now, before anything is transformed.
    const current = new Map<string, DOMRect>();
    for (const [id, el] of rows.current) {
      current.set(id, el.getBoundingClientRect());
    }

    const still =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Pass two: play each row back from where it was.
    if (!still) {
      for (const [id, box] of current) {
        const was = previous.current.get(id);
        // A car that has just joined has no previous place to come from, and
        // sliding it in from the origin would read as an overtake.
        if (!was) continue;

        const dx = was.left - box.left;
        const dy = was.top - box.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        rows.current.get(id)?.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)" },
        );
      }
    }

    previous.current = current;
    // ids is what changes the layout, so it is what this has to run after.
  }, [ids]);

  /** Ref callback registering a row for measurement. */
  return (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };
}
