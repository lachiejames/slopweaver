/*
 * `--poll`: the OBSERVING mode, alone in its own module.
 *
 * Its import list is the seam. This file reaches `./reviewCommon.js` and nothing else of the review verb's
 * own — not `./reviewClose.js`, not `./reviewReap.js` — so there is no call path from reading a verdict to
 * releasing a workspace for an edit to widen by accident. See `./review.ts` § "Reading a verdict and closing
 * a reviewer are two acts" for what that path cost when it existed.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { dispatchIdOf } from "../../../live/turn/dispatch.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { type ReviewPollTruth, reviewPollLines, reviewWaitSettled } from "../../../live/turn/reviewPoll.js";
import type { WaitOptions } from "../../../wait/flags.js";
import {
  PROVIDER_WAIT_CEILING_MS,
  PROVIDER_WAIT_SCHEDULE_MS,
  realWaitClock,
  waitUntilSettled,
} from "../../../wait/loop.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type TurnCommandError, turnCommandErrorLines } from "./errors.js";
import { readReviewTruth, refuse } from "./reviewCommon.js";
import { archiveLateReviewerVerdict, recordReviewerDeath } from "./reviewLedger.js";

/**
 * The `--poll` mode: read the verdict fresh and report. It never closes, presses or releases a workspace; the
 * one thing it moves is a late PREVIOUS-round verdict at the fixed path, archived and recorded
 * ({@link readPollTruthRecoveringLateVerdict}).
 *
 * It closes nothing, and that is the fix rather than an omission. Measured live, twelve times
 * across two hours: this function used to close `record.reviewer` whenever a verdict file parsed, so a file
 * a PREVIOUS round's reviewer had left at the fixed path made every poll tear down the reviewer that was
 * mid-verdict — and the line it printed said only that the digest did not match, never that it had just
 * killed the session. Observing a verdict and consuming it are now two verbs; `--close` is the second.
 *
 * With `--wait` it re-reads on the one wait contract while the reviewer is `working`, then reports whatever
 * it settled on through the same lines a single read prints — so waiting can never print a different verdict.
 *
 * @param askIdentity which ask's review to read
 * @param home the state home the review lives under
 * @param wait whether to re-read while the reviewer is still working, and for how long
 * @returns the exit code: OK on a settled verdict, DEFERRED on a wait timeout, ERROR otherwise
 */
export async function runPoll({
  askIdentity,
  home,
  wait,
}: {
  askIdentity: AskIdentity;
  home: string;
  wait: WaitOptions;
}): Promise<number> {
  const outcome = await waitUntilSettled({
    ceilingMs: PROVIDER_WAIT_CEILING_MS,
    clock: realWaitClock(),
    emit: (line) => {
      logger.out({ line });
    },
    lines: (reading) =>
      reading.isErr()
        ? turnCommandErrorLines({ error: reading.error })
        : reviewPollLines({ truth: reading.value.truth }).lines,
    read: () =>
      readPollTruthRecoveringLateVerdict({
        deps: {
          archiveLate: (record) => archiveLateReviewerVerdict({ home, record }),
          read: () => readReviewTruth({ askIdentity, home }),
        },
      }),
    schedule: PROVIDER_WAIT_SCHEDULE_MS,
    settled: (reading) => !wait.wait || reading.isErr() || reviewWaitSettled({ truth: reading.value.truth }),
    timeoutSeconds: wait.timeoutSeconds,
  });
  if (outcome.kind === "timed-out") {
    logger.out({ line: `WAIT-TIMEOUT reviewer still working after ${String(wait.timeoutSeconds)}s — no verdict yet` });
    return EXIT_DEFERRED;
  }
  const read = outcome.reading;
  if (read.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: read.error }) });
  }
  const { record, truth } = read.value;
  if (truth.kind === "phantom") {
    recordReviewerDeath({ home, record, truth });
  }
  const { done, lines } = reviewPollLines({ truth });
  for (const line of lines) {
    logger.out({ line });
  }
  if (done) {
    logger.out({
      line: `when you are finished with the reviewer: slopweaver turn review --dispatch ${dispatchIdOf({ askIdentity })} --close`,
    });
  }
  return done ? EXIT_OK : EXIT_ERROR;
}

/** One read of a review: its record, and what is true of it. */
type ReviewTruthReading = Result<{ readonly record: ReviewRecord; readonly truth: ReviewPollTruth }, TurnCommandError>;

/** The two effects a poll's read is built from, injected so their ORDER is testable with plain fakes. */
export interface ReviewPollReadDeps {
  /** Read the review's truth fresh. */
  readonly read: () => Promise<ReviewTruthReading>;
  /** Archive a late previous-round verdict and record its breakage; throws when either cannot be done. */
  readonly archiveLate: (record: ReviewRecord) => string | undefined;
}

/**
 * Read a review's truth, and when the fixed verdict path holds a PREVIOUS round's verdict, archive it and read
 * again — so `--poll` reports this round's reviewer rather than refusing on a file no verb could clear.
 *
 * It runs INSIDE the wait loop's read, which is the point: done after `waitUntilSettled` returned,
 * `--poll --wait` would already have stopped on the stale file, because `superseded` settles a wait. It is
 * asked on EVERY reading but this reviewer's own verdict, not only a `superseded` one: a dead or phantom
 * reviewer outranks the file in `reviewPollTruth`, so keying on `superseded` left a late verdict beside a dead
 * reviewer unarchived and unrecorded (measured on the real verb). The archive re-reads the file
 * itself and is a no-op unless it is foreign, so the extra ask costs one file read.
 *
 * One archive per read at most; a second late file arriving between the archive and the re-read is reported
 * as `superseded` and archived on the next read. Only an archive that moved something earns a re-read. An
 * archive that throws is logged and the first reading stands, so the caller still sees why it was refused.
 *
 * @param deps the read and the archive, real in `runPoll` and plain fakes in a test
 * @returns the reading to report
 */
export async function readPollTruthRecoveringLateVerdict({
  deps,
}: {
  deps: ReviewPollReadDeps;
}): Promise<ReviewTruthReading> {
  const first = await deps.read();
  if (first.isErr() || first.value.truth.kind === "verdict") {
    return first;
  }
  let archived: string | undefined;
  try {
    archived = deps.archiveLate(first.value.record);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    logger.error({
      msg: `turn review --poll: could not archive the late verdict at ${first.value.record.verdictPath}: ${why}`,
    });
    return first;
  }
  if (archived === undefined) {
    return first;
  }
  return deps.read();
}
