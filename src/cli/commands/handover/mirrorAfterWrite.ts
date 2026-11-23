/**
 * The one call every handover verb that WRITES a board document makes after the write succeeds.
 *
 * Thin on purpose: `../../../store/fleet/boardMirror.ts` owns what a mirror is and why its failure is loud
 * but not yet fatal. This file only prints and answers whether the verb must now fail. Every handover verb that
 * rewrites a board document calls it — find them with `grep -rn "mirrorAfterWrite({" src/cli/commands` rather
 * than trusting a list here; `rule` is not one, because it appends to the run journal and leaves the document
 * — and so its hash — untouched.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import {
  type BoardMirrorError,
  type BoardMirrorOutcome,
  boardStoreIsAuthoritative,
  mirrorBoardDoc,
  mirrorFailureLines,
} from "../../../store/fleet/boardMirror.js";

/**
 * Mirror a just-written document into `board_row`, printing a failure loudly.
 *
 * @param verb the handover verb that wrote it, named in the failure
 * @param path the document the verb wrote
 * @param home the state home the verb resolved
 * @param mirror the store upsert; production is `mirrorBoardDoc`, a test passes a plain fake result
 * @param storeIsAuthoritative the authority switch deciding whether a failed mirror fails the verb
 * @param reportError where each failure line goes; production is the logger's stderr channel
 * @returns true when the verb must fail because of the mirror — never while the file is authoritative
 */
export async function mirrorAfterWrite({
  verb,
  path,
  home,
  mirror = mirrorBoardDoc,
  storeIsAuthoritative = boardStoreIsAuthoritative,
  reportError = logger.error,
}: {
  verb: string;
  path: string;
  home: string;
  mirror?: (target: { home: string; path: string }) => Promise<Result<BoardMirrorOutcome, BoardMirrorError>>;
  storeIsAuthoritative?: () => boolean;
  reportError?: (line: { msg: string }) => void;
}): Promise<boolean> {
  const mirrored = await mirror({ home, path });
  if (mirrored.isOk()) {
    return false;
  }
  mirrorFailureLines({ error: mirrored.error, path, verb }).forEach((msg) => {
    reportError({ msg });
  });
  return storeIsAuthoritative();
}
