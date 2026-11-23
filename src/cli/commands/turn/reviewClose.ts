/*
 * `--close`: the CONSUMING mode, and the only module in this verb that may release a reviewer's workspace.
 *
 * `./reviewReap.js` is imported here and in no other module of the review verb. Keep it that way: the original
 * incident was a teardown reachable from a read, so a shared helper, an optional cleanup callback or a
 * `finally` that also released would rebuild exactly the path the split removed.
 */
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { reviewPollClosure, reviewPollLines } from "../../../live/turn/reviewPoll.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { turnCommandErrorLines } from "./errors.js";
import { readReviewTruth, refuse } from "./reviewCommon.js";
import { recordReviewerDeath } from "./reviewLedger.js";
import { releaseReviewerWorkspace } from "./reviewReap.js";

/**
 * The `--close` mode: tear the reviewer's workspace down, and only when it is provably not working.
 *
 * The gate is {@link reviewPollClosure}, never elapsed time and never "the file parsed" — a reviewer's own
 * written verdict, or cmux reporting the host has exited, are the only two things that prove it has stopped.
 *
 * @param askIdentity which ask's reviewer to close
 * @param home the state home the review lives under
 * @returns the exit code: OK once released, ERROR when the closure gate refuses
 */
export async function runClose({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): Promise<number> {
  const read = await readReviewTruth({ askIdentity, home });
  if (read.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: read.error }) });
  }
  const { record, truth } = read.value;
  if (truth.kind === "phantom") {
    recordReviewerDeath({ home, record, truth });
  }
  const closure = reviewPollClosure({ truth });
  if (!closure.releaseLedger) {
    return refuse({
      code: EXIT_ERROR,
      errors: [
        `refusing to close reviewer ${record.reviewer.workspaceRef}: ${closure.reason}`,
        ...reviewPollLines({ truth }).lines,
      ],
    });
  }
  const failure = await releaseReviewerWorkspace({ closeWorkspace: closure.closeWorkspace, home, record });
  if (failure !== undefined) {
    logger.error({ msg: `the reviewer workspace ${record.reviewer.workspaceRef} could not be closed: ${failure}` });
  }
  logger.out({
    line: `${closure.closeWorkspace ? "closed" : "released"} reviewer ${record.reviewer.workspaceRef} — ${closure.reason}`,
  });
  return EXIT_OK;
}
