/**
 * A CARD THAT FAILED ITS OWN GATE NEVER REACHES THE OWNER'S QUEUE. Every gate a Queue card passes — a field its record
 * did not write (`./briefingCardForm.ts`), the owner's words unread (`./queueCardSource.ts`), a draft it cannot draw
 * (`./draftAsOwner.ts`), a machine id in its prose (`./machineIdForm.ts`) and the rest — folds its refusal into the
 * row's `record.form`. A row left on the Queue would have its panel draw the refusal line in place of the substance,
 * so the owner would open a parked post and find one italic sentence and no draft. A card that reaches the Queue
 * has passed every fail-closed requirement; one that did not is not shown.
 *
 * So the rows are split here, once, right after `rowsOf`: a refused card is WITHHELD — out of every list, count,
 * badge, departure and spoken item — and kept only as the few fields that say which card it was and why, so the
 * Queue can say how many it is not showing and the chair's report can name each one to fix. Never the whole row:
 * a withheld card that carried its card could be handed back to a renderer by mistake.
 *
 * An act is not withheld. Acts are the Alignment page's (`./alignment.ts`), and a finding act is refused BY DESIGN
 * until its pull request is looked up (`./queueActRow.ts` `actCardFormBefore`); withholding it would remove the one
 * card whose panel performs that lookup.
 *
 * Pure: rows in, rows out. A module rather than logic in `../components/console/useQueueRows.ts` because the unit
 * lane does not transform `.tsx`.
 */

import { rowForOpen } from "./queueOpen";
import type { QueueRow } from "./queueRows";
import type { ReasonWords } from "./quotedReason";

/** A card a gate refused, as the Queue and the chair's report name it — never the card itself. */
export interface WithheldQueueRow {
  /** The key `?open=` named it by. */
  readonly key: string;
  /** Every other key it answered to, so an alias deep link resolves to the withholding too. */
  readonly aliases: readonly string[];
  readonly kind: Exclude<QueueRow["kind"], "act">;
  /** The card's title, with any machine id already hidden (`./machineIdForm.ts` `machineIdsHidden`). */
  readonly title: string;
  /** The gate's own sentence, or its lead with a failed read's reason apart: which check refused the card. */
  readonly why: ReasonWords;
  /** Which workspace it belongs to, so the Queue counts it in the context it would have drawn in. */
  readonly placement: QueueRow["placement"];
}

/** The Queue's rows split by whether a gate refused them. */
export interface QueueRowPartition {
  /** Every row a gate let through, and every act, in the order `rowsOf` ranked them. */
  readonly rows: readonly QueueRow[];
  /** Every non-act row a gate refused, in the same order. */
  readonly withheld: readonly WithheldQueueRow[];
}

/**
 * Split the Queue's rows into those it draws and those a gate refused.
 *
 * @param rows every row `rowsOf` built
 * @returns the drawn rows and the withheld ones, each in their original order
 */
export function partitionQueueRows({ rows }: { rows: readonly QueueRow[] }): QueueRowPartition {
  const drawn: QueueRow[] = [];
  const withheld: WithheldQueueRow[] = [];
  for (const row of rows) {
    const form = row.record.form;
    if (row.kind === "act" || form.kind === "drawn") {
      drawn.push(row);
      continue;
    }
    let aliases: readonly string[] = [];
    if (row.aliases !== undefined) {
      aliases = row.aliases;
    }
    withheld.push({
      aliases,
      key: row.key,
      kind: row.kind,
      placement: row.placement,
      title: row.card.question,
      why: form.why,
    });
  }
  return { rows: drawn, withheld };
}

/**
 * The withheld card `?open=` names — its exact key first, then one that answered to it as an alias, as
 * `./queueOpen.ts` `rowForOpen` resolves a drawn row.
 *
 * @param open the key `?open=` names
 * @param withheld the withheld cards
 * @returns the withheld card, or `undefined` when none answers to the key
 */
export function withheldForOpen({
  open,
  withheld,
}: {
  open: string;
  withheld: readonly WithheldQueueRow[];
}): WithheldQueueRow | undefined {
  const exact = withheld.find((row) => row.key === open);
  if (exact !== undefined) {
    return exact;
  }
  return withheld.find((row) => row.aliases.includes(open));
}

/**
 * The withheld card an open panel draws its held note for: only when no drawn row answers to the key — live in the
 * page's list, or held by a register in either work context, whose own panel (switching, gone) outranks the note.
 *
 * @param open the key `?open=` names, or `null` when no panel is open
 * @param live the drawn row the page's list holds under that key
 * @param every every drawn row, in both work contexts
 * @param withheld every withheld card, in both work contexts
 * @returns the withheld card, or `undefined` when a drawn row answers or none is withheld under the key
 */
export function heldForOpen({
  open,
  live,
  every,
  withheld,
}: {
  open: string | null;
  live: QueueRow | undefined;
  every: readonly QueueRow[];
  withheld: readonly WithheldQueueRow[];
}): WithheldQueueRow | undefined {
  if (open === null || live !== undefined || rowForOpen({ open, rows: every }) !== undefined) {
    return undefined;
  }
  return withheldForOpen({ open, withheld });
}

/**
 * The one line the Queue prints over the cards it is not showing, or nothing when it withholds none.
 *
 * @param count how many cards the current view withholds
 * @returns the sentence, or `undefined` at zero
 */
export function withheldSentence({ count }: { count: number }): string | undefined {
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return "1 card failed its own checks, so it is held off this Queue until the supervisor fixes it.";
  }
  return `${String(count)} cards failed their own checks, so they are held off this Queue until the supervisor fixes them.`;
}
