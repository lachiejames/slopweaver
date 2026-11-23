/**
 * The turn's own position in its checklist, and the one edit that moves it.
 *
 * **Ordering 2** of the list in {@link ./run}: each phase advances the checklist IN PLACE, by editing the
 * same message. A new message per phase would push the thread down and lose the visibly-moving property
 * the whole surface exists for. {@link advance} is the only writer of that position, so there is one place
 * a phase can be marked done and one place to read to find out what done means.
 */

import { CARD_LINE_CAP, clampVisible, turnChecklist } from "./answer.js";
import type { PostedRef, TurnPoster, TurnStep } from "./runContract.js";

/** The turn's mutable position in its own checklist. Local to one run; never shared. */
export interface Cursor {
  completed: number;
  readonly details: (string | undefined)[];
}

/** Advance the checklist one step and edit the message in place. */
export async function advance({
  cursor,
  detail,
  posted,
  poster,
  steps,
  task,
}: {
  cursor: Cursor;
  detail: string;
  posted: PostedRef;
  poster: TurnPoster;
  steps: readonly TurnStep[];
  task: string;
}): Promise<void> {
  cursor.details[cursor.completed] = detail;
  cursor.completed = Math.min(steps.length, cursor.completed + 1);
  await poster.advanceWorking({
    posted,
    steps: turnChecklist({ progress: { completed: cursor.completed, details: cursor.details }, steps }),
    task,
  });
}

/**
 * Write a detail onto the step the checklist is ON, without marking it done, and edit the message in place.
 *
 * The one writer for a turn that has posted something and is still working — a first answer with
 * follow-through owed (`./turnSettle.ts`). Advancing instead would tick the step finished while the work it
 * names is still being done, which is the claim ordering 2 exists to keep off the card.
 *
 * A query that reported every phase has already ticked the LAST step done by the time its answer posts, so
 * there is no running step to write under. That step is re-opened as running instead: a card reading all done
 * over a worker still building is the false ending this path exists to avoid, and a note written past the
 * last step renders nowhere. The line rides as the running step's own detail, clamped to the card's line cap,
 * because a running step renders that and never a stored per-step detail.
 *
 * @param cursor the turn's position, left at the same step, or moved back onto the last one
 * @param detail the line to show under the running step
 * @param posted the working message to edit
 * @param poster what the turn may post
 * @param steps the checklist this tier takes
 * @param task the bracketed task label on the author row
 */
export async function annotate({
  cursor,
  detail,
  posted,
  poster,
  steps,
  task,
}: {
  cursor: Cursor;
  detail: string;
  posted: PostedRef;
  poster: TurnPoster;
  steps: readonly TurnStep[];
  task: string;
}): Promise<void> {
  cursor.completed = Math.max(0, Math.min(cursor.completed, steps.length - 1));
  const runningDetail = clampVisible({ cap: CARD_LINE_CAP, text: detail });
  await poster.advanceWorking({
    posted,
    steps: turnChecklist({ progress: { completed: cursor.completed, details: cursor.details, runningDetail }, steps }),
    task,
  });
}

/**
 * The reason text for a thrown value, without pretending an unknown throw is an `Error`.
 *
 * @returns the error's own message, or the thrown value stringified when it is not an `Error`
 */
export function reasonOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}
