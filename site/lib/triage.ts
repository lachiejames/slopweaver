/*
 * The order a triage pass walks the Queue's cards in: a clock a card over the Queue's own cards, the voice keeping
 * the clock (`./triageWalk.ts`, docs/console/voice-triage-pass.md). Pure, so the unit lane holds the order without
 * importing React.
 */

import { deferredLast } from "./cardDeferrals";
import { type QueueSection, SECTIONS } from "./queueFocus";

/**
 * The cards in the order a triage pass walks them.
 *
 * The Queue's one order (`./queueFocus.ts` `queueOrdered`): section by section, and within a section the order the
 * rows arrive in, which the caller takes from `queueOrdered` so a pass opens the card the page numbers 1 — then every
 * card the owner put off with "Come back to it", oldest deferral first, as the Queue draws them (`./cardDeferrals.ts`); a put-off
 * card that stops their work keeps its place, since a blocker is never buried. Never
 * regrouped by register: that put a hand step above the owner's first priority's card only because hands were walked first.
 *
 * @param rows the rows, in the Queue's one order
 * @param sectionOf the section the Queue draws a row in (`queueSectionOf`)
 * @returns the rows, deferred ones last unless they stop the owner's work
 */
export function triageOrder<T extends { readonly key: string; readonly deferredIso?: string }>({
  rows,
  sectionOf,
}: {
  rows: readonly T[];
  sectionOf: (row: T) => QueueSection;
}): readonly T[] {
  const bySection = SECTIONS.flatMap((section) => rows.filter((row) => sectionOf(row) === section));
  const { now, deferred } = deferredLast({ rows: bySection });
  return [...now, ...deferred];
}
