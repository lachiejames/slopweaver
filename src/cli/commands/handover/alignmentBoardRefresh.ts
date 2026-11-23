/**
 * Refresh the Alignment board projection from a board composition both of its writers have just run — `handover
 * list` after printing the board, `handover alignment-board` after rebuilding a missing or broken file.
 *
 * Writes only a composition {@link alignmentBoardWriteRefusal} calls whole, and only ever WARNS: the board a caller
 * asked for has already been, or is about to be, printed, and a projection that could not be refreshed is a stale
 * cache the console marks as such, never a reason to fail the verb.
 */

import {
  type AlignmentBoardProjection,
  alignmentBoardWriteRefusal,
} from "../../../handover/alignmentBoardProjection.js";
import { writeAlignmentBoardProjection } from "../../../handover/alignmentBoardProjectionStore.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type TagFilter } from "../../../handover/tagFilter.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { alignmentBoardProjectionOf } from "./alignmentBoardRows.js";
import { type ListRecovery } from "./listRecovery.js";

/**
 * Project the composition, and write it when it is the whole default board.
 *
 * @param verb the command's name, prefixing what it writes to stderr
 * @param scanStartedIso when the doc scan behind the composition began
 * @param sweep the probe sweep's own count of docs it did not finish
 * @param unreadable the doc files the scan could not read
 * @returns the projection; `refused` when the composition is not the whole default board (so it is not the board at
 *   all), `notWritten` when it is whole but the file would not write
 */
export function refreshAlignmentBoard({
  verb,
  models,
  scanStartedIso,
  handoverDir,
  home,
  filter,
  base,
  runCommands,
  sweep,
  unreadable,
  recovery,
}: {
  verb: string;
  models: readonly BoardModel[];
  scanStartedIso: string;
  handoverDir: string;
  home: string;
  filter: TagFilter;
  base: string | undefined;
  runCommands: boolean;
  sweep: { readonly unresolved: number };
  unreadable: readonly string[];
  recovery: ListRecovery;
}): {
  readonly projection: AlignmentBoardProjection;
  readonly refused: string | undefined;
  readonly notWritten: string | undefined;
} {
  const paths = stateHomePaths({ home });
  const projection = alignmentBoardProjectionOf({ builtAtIso: new Date().toISOString(), models, scanStartedIso });
  const refusal = alignmentBoardWriteRefusal({
    base,
    defaultHandoverDir: paths.handovers,
    handoverDir,
    runCommands,
    tagTerms: filter.terms.length,
    unreadJournals: recovery.unreadJournals.length,
    unreadable: unreadable.length,
    unresolved: sweep.unresolved,
  });
  if (refusal !== undefined) {
    return { notWritten: undefined, projection, refused: refusal };
  }
  const written = writeAlignmentBoardProjection({ path: paths.alignmentBoardJson, projection });
  if (written.isErr()) {
    logger.warn({ msg: `${verb}: ${written.error.message}` });
    return { notWritten: written.error.message, projection, refused: undefined };
  }
  return { notWritten: undefined, projection, refused: undefined };
}
