/** Which of its faces the Alignment page's Start here card (`../components/console/AlignmentStart.tsx`) shows, as data. */

import {
  failedCountFactsOf,
  type SidebarReading,
  staleCountFactsOf,
  type UnmeasuredStandIn,
  updatingCountLabelOf,
} from "./sidebarCountsBasis";
import type { StalenessFact } from "./stalenessLabel";

/** What Start here's stand-in names while the count has no number. */
export const STAND_IN_SUBJECT = "what leads this page";

/** One face of Start here, before it is drawn. */
export type StartHereFace =
  | { readonly kind: "stand-in"; readonly state: UnmeasuredStandIn }
  | { readonly kind: "updating"; readonly label: string }
  | { readonly kind: "failed"; readonly facts: readonly StalenessFact[] }
  | { readonly kind: "ordered" };

/**
 * What Start here shows. A count not current names no first: the order waits for every reading it is made from. Only
 * a read that FAILED carries the warning, with words beside it naming each failed read and what the console does next;
 * one merely being updated is the progress indicator, since a warning over a count nothing failed on reads as broken.
 *
 * @param waiting the page's count of the general-ruling questions waiting on the owner
 * @param next what the console is doing about a failed read, off its recovery runner
 * @param age how old an instant reads, injected so this stays off the clock
 * @returns the face to draw
 */
export function startHereFaceOf({
  waiting,
  next,
  age,
}: {
  waiting: SidebarReading;
  next: string;
  age: (iso: string) => string;
}): StartHereFace {
  if (waiting.phase !== "measured") {
    if ("failures" in waiting) {
      return { facts: failedCountFactsOf({ failures: waiting.failures, next }), kind: "failed" };
    }
    return { kind: "stand-in", state: waiting };
  }
  if (waiting.stale?.kind === "failed") {
    return { facts: staleCountFactsOf({ next, reading: waiting }), kind: "failed" };
  }
  if (waiting.stale?.kind === "updating") {
    return {
      kind: "updating",
      label: `The first question to answer shows here once the count is current. ${updatingCountLabelOf({ age, stale: waiting.stale })}`,
    };
  }
  return { kind: "ordered" };
}
