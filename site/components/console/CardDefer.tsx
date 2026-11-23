"use client";

/**
 * "Come back to it" on an opened Queue card: one press records that the owner put it off, and the card steps below every
 * card they have not (`../../lib/cardDeferrals.ts`). On a card already put off, the same place offers to bring it back
 * up.
 *
 * It sits in the panel's header rather than its footer because every register's card can take it, whatever its own
 * footer holds. The press never settles the row: the card stays on the owner's Queue, it only moves — so the panel
 * closes on a done press and the owner is looking at the rest of the list again.
 */
import { type ReactElement, useEffect } from "react";

import { actLineFor } from "../../lib/actVerbs";
import type { QueueRow } from "../../lib/queueRows";
import { BUTTON } from "./controls";
import { Outcome, usePress } from "./press";

/**
 * The one control, and its outcome line once pressed.
 *
 * @param row the card the panel is open on
 * @param onClose what closes the panel, run once a press is done
 * @returns the control
 */
export function CardDefer({
  row,
  onClose,
}: {
  row: Pick<QueueRow, "kind" | "id" | "deferredIso">;
  onClose: () => void;
}): ReactElement | null {
  const { press, state } = usePress();
  const deferred = row.deferredIso !== undefined;
  useEffect(() => {
    if (state.phase === "done") {
      onClose();
    }
  }, [state.phase, onClose]);
  // An act is the Alignment page's, never on the owner's Queue, so there is nothing to put off.
  if (row.kind === "act") {
    return null;
  }
  let slug = "queue-defer";
  let label = "Come back to it";
  let title = "moves this card below every card you have not put off; it stays on your Queue, no reminder";
  if (deferred) {
    slug = "queue-restore";
    label = "Bring it back up";
    title = "puts this card back in its own place on your Queue";
  }
  return (
    <div className="mt-[0.45rem] flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={BUTTON}
        disabled={state.phase === "sending"}
        title={`${title}\n${actLineFor({ slug })}`}
        onClick={() => void press({ readsSlug: "queue-deferred", slots: { id: row.id, kind: row.kind }, slug })}
      >
        {label}
      </button>
      <Outcome state={state} />
    </div>
  );
}
