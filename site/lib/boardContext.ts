/**
 * What a BOARD row's published tags say about its workspace: the `context=` it declares, and whether the board
 * published its tags trustworthily enough for that declaration — or its absence — to count.
 *
 * A card is chosen by a tag the row DECLARES, never by a regex guessing at its
 * words. A board row can declare its context (`slopweaver handover tag <slug> context=work|slopweaver`), and
 * `./registerPlacement.ts`'s `boardRowPlacement` reads that declaration as a stated workspace, beside the `workspace:`
 * line `handover set-workspace` writes.
 *
 * **A declaration acts only when the board published it trustworthily.** The tags must have read whole, and the
 * producer must have said the row's journal read completely (`tagsIncomplete: false`).
 *
 * **A read in DOUBT leaves the row a finding.** Tags that read in part, or a journal the producer says read in
 * part, may be hiding a `context=` that says the other thing, so no field places the row: it is a finding the
 * default rule places and marks, never a guess at the context it may be hiding. So is a declaration
 * on a board that never said whether its journal read whole. A board cut before either field existed published no
 * declaration at all, so its rows are placed by their other fields.
 */

import type { BoardTagsRead } from "../components/live/read";
import type { BoardTag } from "../components/live/readBoardTags";
import { isWorkContext, type WorkContext } from "./workContext";

/** What reading a board row's declaration needs — structurally satisfied by `read.ts`'s `BoardRow`. */
export interface BoardContextRow {
  readonly tags: readonly BoardTag[];
  readonly tagsRead: BoardTagsRead;
  readonly tagsIncomplete: boolean | undefined;
}

/**
 * Every context a board row declares, when its declaration can be trusted. The tag grammar allows one, but each is
 * returned, so two that disagree reach the placement as the conflict they are rather than first-wins.
 *
 * @param row the board row, with its published tags
 * @returns the declared contexts, empty when the row declares none or its tags did not read completely
 */
export function declaredContextsOf({ row }: { row: BoardContextRow }): readonly WorkContext[] {
  if (row.tagsRead !== "whole" || row.tagsIncomplete !== false) {
    return [];
  }
  const declared: WorkContext[] = [];
  for (const tag of row.tags) {
    if (tag.key === "context" && tag.source === "declared" && isWorkContext(tag.value)) {
      declared.push(tag.value);
    }
  }
  return declared;
}

/**
 * Whether a board row's tags read in doubt — in part, or off a journal the producer read in part — so a
 * `context=` that places it elsewhere may be hidden. A `context=` declared on a board that never said whether its
 * journal read whole is in doubt too: it cannot act, and ignoring it would let a contrary address place the row
 * with no mark.
 *
 * @param row the board row, with its published tags
 * @returns true when no field may place the row
 */
export function tagsInDoubt({ row }: { row: BoardContextRow }): boolean {
  if (row.tagsRead === "partial" || row.tagsIncomplete === true) {
    return true;
  }
  return row.tagsIncomplete === undefined && row.tags.some((tag) => tag.key === "context" && tag.source === "declared");
}
