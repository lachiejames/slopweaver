/**
 * `handover ask`'s later-owner-words check, as both of its moments run it: at the top of the verb over the board
 * `resolve` already scanned, and again at the append over a fresh read of the `talk-*` rows
 * (`../../../handover/laterOwnerWords.ts`). The second read is what catches a row the owner's words landed on while a
 * sign-in or a shape admission was awaited.
 *
 * **The residue, stated**: the append re-read takes no lock on the board, only on the asking row, so a row
 * registered between that read and the append still lands unrefused. Its words are on the Queue regardless; only
 * this seat's refusal is missed.
 */

import type { HandoverDoc } from "../../../handover/doc.js";
import {
  type LaterOwnerWordsVerdict,
  laterOwnerWordsVerdict,
  READ_OWNER_WORDS_FLAG,
  TALK_ROW_PREFIX,
} from "../../../handover/laterOwnerWords.js";
import { scanBoardPrefixed } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { commaListFlag } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import type { Resolved } from "./lifecycleRunCore.js";

/** The door every refusal here names. */
const COMMAND = "slopweaver handover ask";

/**
 * The slugs the seat named in `--read-owner-words`, none when it named nothing.
 *
 * @param parsed the verb's parsed flags
 * @returns the named slugs, trimmed, empties dropped
 */
export function readOwnerWordsOf({ parsed }: { parsed: ParsedFlags }): readonly string[] {
  return commaListFlag({ fallback: [], name: READ_OWNER_WORDS_FLAG, values: parsed.values });
}

/** The refusal's lines, or `undefined` for an ask that may proceed. */
function linesOf({ verdict }: { verdict: LaterOwnerWordsVerdict }): readonly string[] | undefined {
  return verdict.kind === "refused" ? verdict.lines : undefined;
}

/**
 * The check over a board already scanned, refusing when that scan failed outright: an empty board proves nothing.
 *
 * @param doc the asking row
 * @param rows the docs the scan read
 * @param gaps the scan's failure, or the files it could not read
 * @param read the slugs the seat named as read
 * @returns the refusal lines, or `undefined` when the ask may proceed
 */
export function laterOwnerWordsRefusal({
  doc,
  gaps,
  read,
  rows,
}: {
  doc: HandoverDoc;
  gaps: { readonly failed: string | undefined; readonly unreadable: readonly string[] };
  read: readonly string[];
  rows: readonly HandoverDoc[];
}): readonly string[] | undefined {
  if (gaps.failed !== undefined && doc.hisWords.kind === "held") {
    return [
      `handover ask: cannot read the board to list the owner's later words before the write: ${gaps.failed}`,
      "NOTHING was recorded. Fix the board directory, then ask again.",
    ];
  }
  return linesOf({
    verdict: laterOwnerWordsVerdict({ command: COMMAND, doc, read, rows, unreadable: gaps.unreadable }),
  });
}

/**
 * The check at the top of `handover ask`, over the board `resolve` scanned: the refusal printed and its exit, or
 * `undefined` when the ask may go on to its other checks.
 *
 * @param resolved the run context, carrying the asking row, the board and the scan's gaps
 * @param read the slugs the seat named as read
 * @returns `EXIT_USAGE` after printing a refusal, else `undefined`
 */
export function laterOwnerWordsExit({
  read,
  resolved,
}: {
  read: readonly string[];
  resolved: Resolved;
}): number | undefined {
  const lines = laterOwnerWordsRefusal({
    doc: resolved.context.doc,
    gaps: resolved.boardGaps,
    read,
    rows: resolved.all,
  });
  if (lines === undefined) {
    return undefined;
  }
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_USAGE;
}

/**
 * The same check over a fresh read of the `talk-*` rows, for the append.
 *
 * @param doc the asking row as re-read at the append
 * @param handoverDir the board directory to re-read
 * @param read the slugs the seat named as read
 * @returns the refusal lines, or `undefined` when the ask may proceed
 */
export function freshLaterOwnerWordsRefusal({
  doc,
  handoverDir,
  read,
}: {
  doc: HandoverDoc;
  handoverDir: string;
  read: readonly string[];
}): readonly string[] | undefined {
  if (doc.hisWords.kind !== "held") {
    return undefined;
  }
  const scan = scanBoardPrefixed({ handoverDir, prefix: TALK_ROW_PREFIX });
  if (scan.isErr()) {
    return laterOwnerWordsRefusal({ doc, gaps: { failed: scan.error.message, unreadable: [] }, read, rows: [] });
  }
  return laterOwnerWordsRefusal({
    doc,
    gaps: { failed: undefined, unreadable: scan.value.unreadable },
    read,
    rows: scan.value.docs,
  });
}
