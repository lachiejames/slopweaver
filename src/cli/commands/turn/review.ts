/**
 * `slopweaver turn review` — opening the independent reviewer for one composed answer, and reading its verdict.
 *
 * Three modes, all run by the session that composed the answer (the worker, from the dispatched workspace; or
 * the loop, for an `inline` answer it wrote itself):
 *
 * - open (`--answer` with `--dispatch <id>` or `--brief`/`--decision`): re-validate the answer against the
 *   decision and brief exactly as `turn resume --answer` does, compute its digest, compose the reviewer's
 *   packet from those bytes (`../../../live/turn/review.ts`), boot a fresh visible cmux workspace pinned to a
 *   model, record where it is, and only then send the pickup line — the same boot-then-record-then-deliver
 *   order `turn dispatch` uses, for the same race.
 * - `--poll`: read the verdict file the reviewer was told to write, fresh, and print the path
 *   `turn answer --verdict` takes once it is there. It closes nothing, and it presses no key either, which is
 *   why a stranded reviewer is REPORTED here and RE-SUBMITTED by `./dispatchSweep.ts`. The one file it moves
 *   is a PREVIOUS round's verdict that landed after this round opened: archived and recorded as loop breakage
 *   (`./reviewLedger.ts`'s `archiveLateReviewerVerdict`). One read and out unless `--wait` is passed, and
 *   waiting only re-READS on the shared wait contract: it still presses nothing and still closes nothing. See
 *   "A reviewer that never started is not a slow one" below.
 * - `--close`: release the reviewer's workspace, and only when it is provably not working.
 *
 * No model runs here and nothing reaches Slack. What this verb guarantees is narrower and is the point: the
 * reviewer's instructions were composed by this program from the answer's own bytes, so the session pressing
 * the button did not write them.
 *
 * ## Where each mode lives
 *
 * This file is the entry: it parses argv, refuses an impossible flag combination, and routes to exactly one
 * mode. The modes are separate modules because the seam below is an IMPORT GRAPH rather than a convention —
 * `./reviewPollRun.ts` cannot reach a teardown it does not import.
 *
 * - `./reviewCommon.ts` — the shared leaf: `refuse`, and `readReviewTruth`, which both reading modes stand on.
 * - `./reviewOpen.ts` — the open mode: validate, boot, record, deliver, report.
 * - `./reviewPacket.ts` — what one round inherits, and the packet its reviewer reads.
 * - `./reviewPollRun.ts` — `--poll`. Imports the leaf and the ledger writer (`./reviewLedger.ts`), nothing
 *   else of this verb's own.
 * - `./reviewClose.ts` — `--close`. The ONLY module here that imports `./reviewReap.ts`.
 *
 * ## Reading a verdict and closing a reviewer are two acts
 *
 * They used to be one, and that was a defect with a measured cost. `--poll` closed `record.reviewer` whenever
 * a verdict file parsed — and the verdict path is fixed per ask, so a file a PREVIOUS round's reviewer left
 * there made every poll tear down the reviewer that was mid-verdict. Twelve reviewer workspaces died that way
 * across two hours, each matched to the poll that killed it within a second by cmux's own
 * closed-item history, and the line the poll printed said only that the digest did not match — never that it
 * had just closed the session. Two verbs now, and neither can be reached by accident from the other.
 *
 * The three properties that keep it fixed, none of which is a convention anyone has to remember:
 *
 * - **Opening a review ARCHIVES any verdict already at the path**, before the spawn and again when the record
 *   is written (`reviewStore.ts`'s `archiveSupersededVerdict`).
 * - **The READ refuses to hand back a foreign verdict as `present`** — `reviewStore.ts`'s `readVerdictFile`
 *   classifies it `superseded`, so no caller can consume one by looking at a single field. A previous round's
 *   reviewer can still write AFTER the open, so `--poll` archives such a late file itself.
 * - **Closing is gated on proof the reviewer stopped** — `reviewPollClosure`, which accepts this reviewer's
 *   own written verdict or cmux reporting the host exited, and nothing else. Never elapsed time.
 *
 * ## A reviewer that never started is not a slow one — and a missing record is not a stopped reviewer
 *
 * `--poll` used to infer "still working" from the absence of a verdict, which is false in the reassuring
 * direction and cost fourteen silent minutes (`../../../live/turn/reviewDelivery.ts` carries
 * the measurement). It asks cmux for its own delivery record for the reviewer's workspace — the same witness
 * `./dispatchSweep.ts` has always reconciled a WORKER's pickup against. Only when a verdict is already on
 * disk is that read skipped, for the same reason liveness is: a reviewer that wrote its verdict plainly got
 * its pickup.
 *
 * The first cut of that then asserted the mirror-image certainty — a missing delivery record printed
 * `NEVER STARTED` and prescribed `turn dispatch --sweep` over a reviewer that was mid-verification
 * (observed working at 5m22s). So the SCREEN this poll already reads is what
 * decides, through the one classifier the sweep's re-submission arm routes on too
 * (`reviewerStrandedness`): visibly mid-turn is `working`, a pickup typed into an idle box is
 * `pickup-unsent`, and anything else is `delivery-unwitnessed` — a doubt whose remedy is to look.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { askIdentityFromDispatchId } from "../../../live/turn/dispatch.js";
import { DEFAULT_REVIEWER_MODEL } from "../../../live/turn/workerModel.js";
import { parseWaitOptions, type WaitOptions } from "../../../wait/flags.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS } from "../../../wait/loop.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str, TURN_REVIEW_FLAG_SPEC } from "./core.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";
import { runClose } from "./reviewClose.js";
import { refuse } from "./reviewCommon.js";
import { openReview, validatedAnswer } from "./reviewOpen.js";
import { runPoll } from "./reviewPollRun.js";
import { briefSubject, dispatchSubject, type ReviewSubject } from "./reviewSubject.js";
import { readThroughTs } from "./threadFreshnessArgs.js";
import { TURN_REVIEW_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, review, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/*
 * An early return rather than `str({ key: "model", values }) ?? DEFAULT_REVIEWER_MODEL`: `no-silent-fallback`
 * refuses the `??`, and oxlint's `prefer-nullish-coalescing` refuses the ternary and the let-reassign
 * spelling of the same idea, so a returning statement is the shape that satisfies both (`resolveHome`,
 * `src/cli/optionParsers.ts`). Naming the substitution matters here: an operator who mistypes `--model`
 * silently gets the default reviewer model rather than the one they asked for.
 */
function reviewerModel({ named }: { named: string | undefined }): string {
  if (named === undefined) {
    return DEFAULT_REVIEWER_MODEL;
  }
  return named;
}

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn review`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnReviewArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_REVIEW_FLAG_SPEC.boolean], string: [...TURN_REVIEW_FLAG_SPEC.string] },
  });
}

/** The ask a `--poll` names, from whichever flag form was given. */
function pollAskIdentity({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<AskIdentity, TurnCommandError> {
  const dispatchId = str({ key: "dispatch", values });
  if (dispatchId !== undefined) {
    const askIdentity = askIdentityFromDispatchId({ dispatchId });
    return askIdentity === undefined ? err(TurnCommandErrors.dispatchTokenInvalid({ dispatchId })) : ok(askIdentity);
  }
  const briefPath = str({ key: "brief", values });
  if (briefPath === undefined) {
    return err(TurnCommandErrors.reviewTargetMissing({ mode: "poll", usage: TURN_REVIEW_USAGE }));
  }
  const brief = readBrief({ path: briefPath });
  return brief.isErr()
    ? err(TurnCommandErrors.upstreamRefused({ reasons: [brief.error.message] }))
    : ok({ channel: brief.value.channel, messageTs: brief.value.messageTs, threadTs: brief.value.threadTs });
}

/**
 * The mode flags' combinations refused before anything is read: `--poll` with `--close`, and a `--wait` with
 * nothing to wait on.
 */
function modeFlags({ values }: { values: Readonly<Record<string, string | boolean>> }): {
  readonly error: TurnCommandError | undefined;
  readonly wait: WaitOptions;
} {
  const wait = parseWaitOptions({ values });
  const refused = TurnCommandErrors.reviewModeRefused({
    pollWithClose: values["poll"] === true && values["close"] === true,
    upstream: wait.isErr() ? wait.error : [],
    waitWithoutPoll: values["wait"] === true && values["poll"] !== true,
  });
  return {
    error: refused.reasons.length > 0 ? refused : undefined,
    wait: wait.unwrapOr({ timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS, wait: false }),
  };
}

/** The open mode's subject, from whichever flag form was given. */
function openSubject({
  home,
  values,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<ReviewSubject, TurnCommandError> {
  const dispatchId = str({ key: "dispatch", values });
  if (dispatchId !== undefined) {
    return dispatchSubject({ dispatchId, home });
  }
  const briefPath = str({ key: "brief", values });
  const decisionPath = str({ key: "decision", values });
  if (briefPath === undefined || decisionPath === undefined) {
    return err(TurnCommandErrors.reviewTargetMissing({ mode: "open", usage: TURN_REVIEW_USAGE }));
  }
  return briefSubject({ briefPath, decisionPath });
}

/**
 * Route one invocation to exactly one mode, once its flags are known to be coherent.
 *
 * Split out of {@link runTurnReview} so the entry stays argv handling and this stays the routing table: the
 * two reading modes and the open mode are reached from here and from nowhere else in the verb.
 *
 * @param values the parsed flag values
 * @param home the resolved state home
 * @param wait what `--wait` asked for, already parsed
 * @returns the process exit code
 */
async function runMode({
  home,
  values,
  wait,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
  wait: WaitOptions;
}): Promise<number> {
  if (values["poll"] === true || values["close"] === true) {
    if (values["delta-cleared"] === true || str({ key: "read-through", values }) !== undefined) {
      return refuse({
        code: EXIT_USAGE,
        errors: [
          "--read-through and --delta-cleared belong to opening a review, not --poll or --close",
          TURN_REVIEW_USAGE,
        ],
      });
    }
    const askIdentity = pollAskIdentity({ values });
    if (askIdentity.isErr()) {
      return refuse({ code: EXIT_USAGE, errors: turnCommandErrorLines({ error: askIdentity.error }) });
    }
    return values["close"] === true
      ? runClose({ askIdentity: askIdentity.value, home })
      : runPoll({ askIdentity: askIdentity.value, home, wait });
  }
  const answerPath = str({ key: "answer", values });
  if (answerPath === undefined) {
    return refuse({
      code: EXIT_USAGE,
      errors: ["--answer is required to open a review (or pass --poll)", TURN_REVIEW_USAGE],
    });
  }
  const readThrough = readThroughTs({ values });
  if (readThrough.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: [readThrough.error.message, TURN_REVIEW_USAGE] });
  }
  const subject = openSubject({ home, values });
  if (subject.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: subject.error }) });
  }
  const answer = validatedAnswer({ answerPath, home, subject: subject.value });
  if (answer.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: answer.error }) });
  }
  return openReview({
    answer: answer.value,
    answerPath,
    home,
    model: reviewerModel({ named: str({ key: "model", values }) }),
    subject: subject.value,
    threadRead: { cleared: values["delta-cleared"] === true, readThrough: readThrough.value },
  });
}

/**
 * Run the review verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnReview(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_REVIEW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnReviewArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: [...parsed.error, TURN_REVIEW_USAGE] });
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: str({ key: "home", values }) });
  const mode = modeFlags({ values });
  if (mode.error !== undefined) {
    return refuse({ code: EXIT_USAGE, errors: [...turnCommandErrorLines({ error: mode.error }), TURN_REVIEW_USAGE] });
  }
  return runMode({ home, values, wait: mode.wait });
}

export const turnReviewCommand = defineCommand({ run: runTurnReview });
