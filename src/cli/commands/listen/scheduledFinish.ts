/**
 * One scheduled sweep's FINISH stage: persist the watermark, gripe once when it has stalled under a live
 * listener, print the sweep's single stdout object, and return the exit code completeness demands. Split out of
 * `./scheduledRecover.ts`, which keeps the capture and the cycle shell.
 *
 * The {@link ScheduledRecoverOutput} declaration moved here too, rather than staying in the sweep and being
 * imported back: the sweep prints its clock-wake arm, so it imports the type from this leaf, which keeps this
 * module free of any import of `./scheduledRecover.ts`. The prefixed `log` narration moved for the same reason.
 */
import { publishSupervisorEvent, readSupervisorEventsTail } from "../../../events/store.js";
import type { IncidentDetectReport } from "../../../incident/detect.js";
import { logger } from "../../../lib/logger.js";
import type { EmittedMention } from "../../../live/listen/handoff.js";
import type { RecoveryReport } from "../../../live/listen/recover.js";
import type { RecoverySweepState, RecoveryWindow } from "../../../live/listen/recoverSchedule.js";
import { writeRecoverySweepState } from "../../../live/listen/recoverScheduleStore.js";
import type { RecoveryChannelExclusion, RecoveryCoverageFailure } from "../../../live/listen/recoverShared.js";
import type { RecoveryWorkspaceResult } from "../../../live/listen/recoverSweep.js";
import type { RecoveryThreadCoverage } from "../../../live/listen/recoverThreadPlan.js";
import { currentLiveness } from "../../../live/listen/supervise/currentLiveness.js";
import { listenerGrade } from "../../../live/listen/supervise/report.js";
import { newestListenerKind, recoveryStalledEvent } from "../../../live/listen/supervise/streamEvents.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { nextSweepState } from "./scheduledRecoverState.js";
import type { WorkspaceScan } from "./scheduledScan.js";

/** One scheduled sweep's stdout — exactly one of these, ever, per invocation. */
export type ScheduledRecoverOutput =
  | { readonly kind: "clock-wake"; readonly deadlineMs: number }
  | {
      readonly kind: "recovery-sweep";
      readonly completeness: "complete" | "partial";
      readonly window: RecoveryWindow;
      /** Every ADMITTED survivor, after the same capture UX a live socket tag gets. */
      readonly recovered: readonly EmittedMention[];
      readonly excludedBy: RecoveryReport["excludedBy"];
      readonly failures: readonly RecoveryCoverageFailure[];
      /**
       * Channels this sweep is permanently unable to read, and why — reported rather than counted against
       * completeness. See `recoverShared.ts#RecoveryChannelExclusion`: this list is how an operator finds out
       * WHICH channel the bot needs inviting to, instead of watching the watermark sit still and not knowing.
       */
      readonly excludedChannels: readonly RecoveryChannelExclusion[];
      /**
       * Remembered threads whose root Slack no longer has — reported, retired from the checkpoint inventory
       * by a complete sweep, and never counted against completeness. See `recoverShared.ts#goneThread`.
       */
      readonly goneThreads: RecoveryWorkspaceResult["goneThreads"];
      readonly nextDueAtIso: string;
      /** How this sweep spent its thread-read budget — see `recoverThreadPlan.ts#RecoveryThreadCoverage`. */
      readonly threadCoverage: RecoveryThreadCoverage;
      /**
       * Each live incident channel this sweep registered as a board row, and each candidate it skipped with why
       * (`../../../incident/detect.ts`). Never counted against completeness: a row is not a reply.
       */
      readonly incidents: IncidentDetectReport;
    };

/** Where this module's own progress/failure narration goes — prefixed so it reads distinctly in a shared log. */
export const log = ({ line }: { line: string }): void => {
  logger.error({ msg: `listen recover --scheduled: ${line}` });
};

/**
 * Gripe, loudly and once, when the watermark this sweep just persisted has been sitting still for an hour or
 * more while the listener itself is alive.
 *
 * This is the alarm for the failure whose only other symptom is silence. Measured: every
 * scheduled sweep for seven hours ran on cadence, printed `completeness: "partial"` and `recovered: []`, and
 * left `completedThroughTs` exactly where it was — under a listener that was healthy the whole time. Nothing
 * in that output is wrong, and nothing in it is read, so the recovery safety net was down all night and was
 * found by hand. An `alert`-severity event on the supervisor stream is the surface a supervisor is already
 * obliged to read. Publishing is best-effort by the stream's own contract: a failure to publish is narrated
 * and never sinks the sweep.
 *
 * @param home the state home the listener's arm/heartbeat and the supervisor stream live under
 * @param nowMs the current instant, epoch milliseconds
 * @param state the sweep state just persisted
 * @param failures how many coverage failures this sweep reported
 */
function gripeIfStalled({
  home,
  nowMs,
  state,
  failures,
}: {
  home: string;
  nowMs: number;
  state: RecoverySweepState;
  failures: number;
}): void {
  const { liveness } = currentLiveness({ home, nowMs });
  const tail = readSupervisorEventsTail({ home });
  const event = recoveryStalledEvent({
    armId: "armId" in liveness ? liveness.armId : undefined,
    atIso: new Date(nowMs).toISOString(),
    completedThroughTs: state.completedThroughTs,
    failures,
    grade: listenerGrade({ liveness }),
    nowMs,
    pid: "pid" in liveness ? liveness.pid : undefined,
    previousKind: tail.isOk() ? newestListenerKind({ events: tail.value }) : undefined,
  });
  if (event === undefined) {
    return;
  }
  const problem = publishSupervisorEvent({ event, home });
  log({ line: problem === undefined ? event.why : `could not publish recovery-stalled: ${problem}` });
}

/**
 * Persist the watermark, print the sweep's result, and return the exit code the completeness/output demand.
 *
 * @param home the Slopweaver home
 * @param incidents what this sweep's live-incident detection did
 * @param migrating whether this sweep is the one-time V1 → V2 bootstrap
 * @param nowMs the clock, epoch milliseconds
 * @param previous the durable sweep state before this cycle, or `undefined`
 * @param recovered every survivor this pass captured — scanned AND stranded
 * @param report the scan's own classified report
 * @param scan the underlying workspace scan
 * @param strandedCaptured how many stranded asks this pass picked up, which the report cannot carry
 * @param window this sweep's own window
 * @returns the process exit code
 */
export function finishSweep({
  home,
  incidents,
  migrating,
  nowMs,
  previous,
  recovered,
  report,
  scan,
  strandedCaptured,
  window,
}: {
  home: string;
  incidents: IncidentDetectReport;
  migrating: boolean;
  nowMs: number;
  previous: RecoverySweepState | undefined;
  recovered: readonly EmittedMention[];
  report: RecoveryReport;
  scan: WorkspaceScan;
  strandedCaptured: number;
  window: RecoveryWindow;
}): number {
  const state = nextSweepState({
    complete: scan.complete,
    latestExclusiveTs: window.latestExclusiveTs,
    migrating,
    nowMs,
    previous,
    threadCheckpoints: scan.threadCheckpoints,
  });
  const written = writeRecoverySweepState({ home, state });
  const failures = written.isOk()
    ? scan.failures
    : [...scan.failures, { reason: written.error.message, stage: "discovery" as const }];
  const complete = scan.complete && written.isOk();
  gripeIfStalled({ failures: failures.length, home, nowMs, state });
  const output: ScheduledRecoverOutput = {
    completeness: complete ? "complete" : "partial",
    excludedBy: report.excludedBy,
    excludedChannels: scan.excludedChannels,
    failures,
    goneThreads: scan.goneThreads,
    incidents,
    kind: "recovery-sweep",
    nextDueAtIso: state.nextDueAtIso,
    recovered,
    threadCoverage: scan.threadCoverage,
    window,
  };
  logger.out({ line: JSON.stringify(output) });
  if (!complete) {
    return EXIT_ERROR;
  }
  // `report.recoverable` alone stopped being the whole answer with the stranded lane: those survivors never
  // appear in the SCAN's report, so a pass that picked up only stranded asks would report itself empty while
  // handing the caller real work. The scan's own half is left exactly as it was — a candidate the responder
  // whitelist then refused still counts as recoverable, which is what several cases below assert.
  return report.recoverable.length > 0 || strandedCaptured > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}
