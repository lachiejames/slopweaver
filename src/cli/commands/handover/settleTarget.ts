/**
 * Which row a `handover settle` is about, and every refusal the board itself gives before anything is planned or
 * written. Split from `./settleRowRun.ts` (the file-size ratchet) along that seam: this half is pure over the board
 * scan the settle's critical section already holds, so it is tested directly rather than through the verb.
 * `readSettleRow` is its thin shell: the board read itself, and the refusal printed the way every settle prints one.
 */
import { basename } from "node:path";

import type { HandoverDoc } from "../../../handover/doc.js";
import type { AskSettlement } from "../../../handover/rowKind.js";
import { alreadySettledRefusalLines } from "../../../handover/settleEnding.js";
import { lookupArchivedDoc, scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { resolveHandoverDir } from "./commandSupport.js";

/**
 * Print a multi-line settle refusal, prefixing only the first line so the verb is named once.
 *
 * @param lines the refusal, the first line of which is the sentence
 * @returns the verb's exit code, always an error — this is only reached on a refusal
 */
export function printSettleRefusal({ lines }: { lines: readonly string[] }): number {
  lines.forEach((line, index) => {
    logger.error({ msg: index === 0 ? `handover settle: ${line}` : line });
  });
  return EXIT_ERROR;
}

/**
 * The row a settle names, off the board as it stands under the row's lock.
 *
 * @param dir `--dir`, the board to read; the home's own when absent
 * @param slug the ask being settled
 * @param witness `--witness`, which a `filed` settlement must name a doc by
 * @returns the row and the board it sits on, or the exit code of the refusal already printed
 */
export function readSettleRow({
  dir,
  home,
  settlement,
  slug,
  witness,
}: {
  dir: string | undefined;
  home: string;
  settlement: AskSettlement;
  slug: string;
  witness: string;
}): { readonly docs: readonly HandoverDoc[]; readonly row: HandoverDoc } | number {
  const handoverDir = resolveHandoverDir({ dir, home });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover settle: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  // One single-file read, never an archive scan, and only when a `filed` witness is not live. A doc whose
  // front matter has problems is one the board trusts none of, so it witnesses nothing. A witness
  // that is not one bare file name is never looked up: `../outside` would read a doc beyond the archive whose
  // own slug says `../outside`.
  const witnessArchived =
    settlement === "filed" &&
    basename(witness) === witness &&
    !scan.value.docs.some((doc) => doc.slug === witness) &&
    lookupArchivedDoc({ handoverDir, slug: witness })?.problems.length === 0;
  const target = settleTarget({ docs: scan.value.docs, settlement, slug, witness, witnessArchived });
  if ("refusal" in target) {
    return printSettleRefusal({ lines: target.refusal });
  }
  return { docs: scan.value.docs, row: target.row };
}

/**
 * The row this settlement is about, or why the board refuses to settle it.
 *
 * The `filed` case checks that the doc slug named as the witness is a row somebody can actually go and read, so
 * "this ask became work" cannot be asserted about work that does not exist. An archived doc is one: a later
 * top-up generation is usually settled and swept into the archive before the dead one it replaced is.
 *
 * @param docs the board scan read under the settle's lock
 * @param slug the ask being settled
 * @param witness `--witness`, a doc slug for `filed`
 * @param witnessArchived whether `handovers/archive/` holds a readable doc carrying the witness slug
 * @returns the row, or the refusal lines to print
 */
export function settleTarget({
  docs,
  slug,
  settlement,
  witness,
  witnessArchived,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
  settlement: AskSettlement;
  witness: string;
  witnessArchived: boolean;
}): { readonly refusal: readonly string[] } | { readonly row: HandoverDoc } {
  const row = docs.find((doc) => doc.slug === slug);
  if (row === undefined) {
    return { refusal: [`no row on the board claims the slug "${slug}"`] };
  }
  if (row.kind !== "ask") {
    return { refusal: [`${slug} is a ${row.kind} row — only an ask row is settled this way`] };
  }
  const settled = alreadySettledRefusalLines({ doc: row });
  if (settled !== undefined) {
    return { refusal: settled };
  }
  if (settlement === "filed" && !witnessArchived && !docs.some((doc) => doc.slug === witness)) {
    return { refusal: [`--witness "${witness}" names no doc on the board or in its archive — file the doc first`] };
  }
  return { row };
}
