/**
 * The finished-cycle gate: the shared effectful edge over `../../../handover/permanentRefusal.ts`'s
 * `finishedCycleRefusal`, used by BOTH execution doors.
 *
 * It lives in its own module rather than inside either door because there are two of them and they are in
 * different command families — `handover start` and `cmux spawn` — and the whole measured defect was each
 * door judging closure from a different, incomplete set of facts. One copy of the sentence, one copy of the
 * break-glass, so the two cannot drift apart the way `isTerminalDocStatus` and `settlement:` did.
 */

import { ALLOW_RERUN } from "../../../handover/boardRefusal.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { finishedCycleRefusal } from "../../../handover/permanentRefusal.js";
import { logger } from "../../../lib/logger.js";

/**
 * Whether the finished-run break-glass is set in an environment.
 *
 * Read at each verb's own edge and threaded in, exactly as `./lifecycle.ts`'s `forcedBy` is, so the decision
 * stays a value a test can pass rather than ambient state a test has to mutate.
 *
 * @param env the environment to read
 * @returns whether {@link ALLOW_RERUN} is set to `1`
 */
export function rerunAllowedBy({ env }: { env: NodeJS.ProcessEnv }): boolean {
  return env[ALLOW_RERUN] === "1";
}

/**
 * Whether a journal that already reads `finished` stops this door, printing why.
 *
 * A forced re-open prints too. A break-glass nobody ever sees used is the silent second cycle this gate
 * exists to make visible — the same reasoning `./lifecycle.ts` gives for printing a waived probe gap.
 *
 * @param doc the doc the door was pointed at
 * @param events its run journal, in order
 * @param unreadableLines line numbers the journal reader could not decode
 * @param rerunAllowed whether the caller's environment set {@link ALLOW_RERUN}
 * @param verb the door's own name, for the printed line
 * @returns true when the door must refuse, having already printed why
 */
export function finishedCycleRefuses({
  doc,
  events,
  unreadableLines,
  rerunAllowed,
  verb,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
  rerunAllowed: boolean;
  verb: string;
}): boolean {
  const refusal = finishedCycleRefusal({ doc, events, unreadableLines });
  if (refusal === undefined) {
    return false;
  }
  if (rerunAllowed) {
    logger.error({ msg: `${verb}: re-opening a finished run on purpose (${ALLOW_RERUN})` });
    return false;
  }
  logger.error({ msg: `${verb}: ${refusal}` });
  return true;
}
