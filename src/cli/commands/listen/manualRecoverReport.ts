/**
 * What a MANUAL `listen recover` pass says, and what it exits with — the pure half, so the decision that
 * was wrong is a function a test can call rather than a branch buried in an effectful sweep.
 *
 * ## The defect this module exists to close
 *
 * MEASURED: one manual pass over more than a hundred channels could
 * not open most of them and printed `{"excludedBy": {…}, "recoverable": []}`, exit 3. A second pass over the
 * few readable ones printed the same shape, exit 3. The first answer means "I could not look"; the second means
 * "I looked and there is nothing". A consumer reading only `--json` — which is what the loop's own
 * gap-closing procedure does — had no field to tell them apart, and the skipped channels read as all clear.
 *
 * ## Why a requested channel the bot is not in still makes the pass PARTIAL
 *
 * The scheduled sweep treats `not-a-member` as an EXCLUSION that does not count against completeness, and
 * that is correct THERE: its channel set is DISCOVERED from the bot's own membership, so a channel it is
 * not in was never in scope, and counting it pinned the watermark for six days
 * (`../../../live/listen/recoverShared.ts`). Manual mode is the other case. `--channels` is typed by an
 * operator and is the verb's own WHERE gate — a channel on that list IS in scope, and a pass that could not
 * read it did not answer the question it was asked. So the same classifier sorts the diagnostic, and the
 * CALLER decides what it means for coverage. Manual mode has no watermark for the count to pin.
 */
import type { RecoveryReport } from "../../../live/listen/recover.js";
import { zeroExclusionCounts } from "../../../live/listen/recoverExclusionCounts.js";
import type { RecoverSlackAsksResult } from "../../../live/listen/recoverScan.js";
import type { RecoveryChannelExclusion, RecoveryCoverageFailure } from "../../../live/listen/recoverShared.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/**
 * The manual pass's `--json` document.
 *
 * `excludedBy` and `recoverable` keep their exact old names and shapes — every field here is ADDITIVE, so a
 * consumer selecting either still reads what it always did. `completeness`, `failures` and
 * `excludedChannels` are spelled the way `scheduledRecover.ts`'s own output spells them, deliberately: one
 * reader should learn one vocabulary rather than two that differ only in which half of the verb produced
 * them. The scheduled-only fields (`kind`, `nextDueAtIso`, `threadCoverage`) are absent because manual mode
 * has no cadence and no thread budget, and `recovered` stays `recoverable` because the two are not the same
 * thing: scheduled `recovered` holds ADMITTED, captured mentions, while `recoverable` holds raw verdicts.
 */
export interface ManualRecoverOutput {
  readonly excludedBy: RecoveryReport["excludedBy"];
  readonly recoverable: RecoveryReport["recoverable"];
  /** `complete` only when every requested channel was read; see this file's header for why. */
  readonly completeness: "complete" | "partial";
  readonly failures: readonly RecoveryCoverageFailure[];
  readonly excludedChannels: readonly RecoveryChannelExclusion[];
  /** How many DISTINCT channels `--channels` named. */
  readonly requestedChannels: number;
  /** How many of them were read completely. */
  readonly scannedChannels: number;
}

/**
 * Build the manual pass's whole output document from what the scan produced. Pure.
 *
 * Completeness is derived HERE and exactly once, rather than at each place that wants to print it — the
 * defect was two facts (the report, and what was skipped) never being joined, so joining them in one
 * function is the fix rather than a tidy-up.
 *
 * **A pass that requested NOTHING is never complete**, and that clause is load-bearing rather than
 * defensive. Every other term here compares counts, and `0 === 0` with no failures and no exclusions is
 * arithmetically a perfect pass — so a breadth that came back empty (a `--discover-channels` walk that
 * named no conversation the bot may act in) would print `complete`, exit `3`, and certify a workspace
 * nobody opened. Discovery refuses an empty set at source (`../../../live/listen/recoverDiscovery.ts`);
 * this is the same claim stated where the verdict is actually computed, so no future breadth can
 * reintroduce it.
 *
 * @param scan what the whole scan produced, counts included
 * @returns the document to print, and the value every completeness read goes through
 */
export function manualRecoverOutput({ scan }: { scan: RecoverSlackAsksResult }): ManualRecoverOutput {
  const complete =
    scan.requestedChannels > 0 &&
    scan.scannedChannels === scan.requestedChannels &&
    scan.failures.length === 0 &&
    scan.excludedChannels.length === 0;
  return {
    completeness: complete ? "complete" : "partial",
    excludedBy: scan.report.excludedBy,
    excludedChannels: scan.excludedChannels,
    failures: scan.failures,
    recoverable: scan.report.recoverable,
    requestedChannels: scan.requestedChannels,
    scannedChannels: scan.scannedChannels,
  };
}

/**
 * The output document for a pass whose `--discover-channels` walk failed before any channel was read. Pure.
 *
 * Discovery is complete-or-nothing: a truncated membership walk is indistinguishable from a smaller
 * workspace, so a pass over a partial set would report "nothing unanswered" about conversations it never
 * opened — the same class of lie this whole module exists to end, arrived at one step earlier. Reported as
 * a `discovery`-stage coverage failure rather than a bare exit code so the operator reads WHICH stage lost
 * the read; `renderCoverage` and {@link manualRecoverExitCode} then do exactly what they do for any other
 * incomplete pass, which is why neither needed a discovery branch.
 *
 * @param reason the walk failure's own message
 * @returns a partial document naming the discovery stage, with zero channels requested and none read
 */
export function discoveryFailureOutput({ reason }: { reason: string }): ManualRecoverOutput {
  return {
    completeness: "partial",
    excludedBy: zeroExclusionCounts(),
    excludedChannels: [],
    failures: [{ reason, stage: "discovery" }],
    recoverable: [],
    requestedChannels: 0,
    scannedChannels: 0,
  };
}

/**
 * The exit code a manual pass's own output demands. Pure.
 *
 * The order is the whole contract, and it mirrors `scheduledFinish.ts`'s `finishSweep` line for line: a
 * partial pass is {@link EXIT_ERROR} whether or not it found survivors, because "some of what you asked for
 * was never read" outranks "here is what I did find" — the survivors are printed either way and a caller
 * must still take them. Only a COMPLETE pass gets to use the recoverable count, where the existing meanings
 * hold: {@link EXIT_OK} for work to do, {@link EXIT_EXPECTED_EMPTY} for a proven-clean sweep.
 *
 * `EXIT_EXPECTED_EMPTY` is precisely what a partial pass must not return. Its own definition is "the verb
 * ran its full pipeline and is reporting a legitimate non-success STATUS" (`../../exitCodes.ts`) — a pass
 * that skipped most of its channels ran no such thing, and 3 is the code that read as all clear.
 *
 * @param output the document this pass is about to print
 * @returns the process exit code
 */
export function manualRecoverExitCode({ output }: { output: ManualRecoverOutput }): number {
  if (output.completeness === "partial") {
    return EXIT_ERROR;
  }
  if (output.recoverable.length > 0) {
    return EXIT_OK;
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * The coverage lines a human reader sees — one summary line always, then one line per channel left unread,
 * each saying what to actually do about it. Pure.
 *
 * An exclusion and a failure earn different sentences because they earn different acts: a bot that is not a
 * member answers identically on every future call until somebody invites it, so telling an operator to
 * "retry" there would be a lie the code already knows is a lie.
 *
 * @param output the document this pass is about to print
 * @returns the lines, in print order
 */
export function renderCoverage({ output }: { output: ManualRecoverOutput }): readonly string[] {
  const lines = [
    `${output.completeness}: read ${String(output.scannedChannels)} of ${String(output.requestedChannels)} requested channel(s)`,
  ];
  for (const excluded of output.excludedChannels) {
    const fix =
      excluded.reason === "not-a-member"
        ? "invite the bot, or drop it from --channels"
        : "the channel is gone or invisible to this token — check the id, or drop it from --channels";
    lines.push(`  NOT READ ${excluded.channel} (${excluded.reason}) — ${fix}; a re-run alone changes nothing`);
  }
  for (const failure of output.failures) {
    lines.push(
      `  NOT READ ${coverageSubject({ failure })} (${failure.stage}) — ${failure.reason}; a re-run may well read it`,
    );
  }
  return lines;
}

/**
 * What one coverage failure was reading when it failed, as a reader-facing subject. Pure.
 *
 * Every stage is spelled out rather than defaulted: manual mode produces only `history` and `thread` today,
 * and a `discovery` failure reaching this renderer would otherwise print an empty subject instead of saying
 * which stage lost the read.
 *
 * @param failure the coverage failure to name
 * @returns the subject, ready to print
 */
function coverageSubject({ failure }: { failure: RecoveryCoverageFailure }): string {
  if (failure.stage === "thread") {
    return `${failure.channel} thread ${failure.messageTs}`;
  }
  if (failure.stage === "history") {
    return failure.channel;
  }
  return "the workspace";
}
