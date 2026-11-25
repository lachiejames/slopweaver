/**
 * How `codex plan` and `codex review` report what their passes did, and which exit code that adds up to.
 * STDOUT carries the one machine document; every human line goes to stderr (`./run.ts` says why).
 */
import { aggregateExitCode } from "../../../codex/bounds.js";
import type { CompletedPass } from "../../../codex/orchestrate.js";
import { reportAdmission } from "../../../codex/passAdmission.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { codexHumanLines, codexResultJson } from "./core.js";
import type { PassInvocation } from "./passRoute.js";
import { scratchReclaimFailureLines } from "./scratchReclaimReport.js";

/**
 * The exit code a set of completed passes adds up to. Pure.
 *
 * A pass whose artifact could not be written is a FAULT: the answer exists but was not persisted, and saying
 * otherwise would claim a durable record that is not there. What became of a pass's scratch is deliberately
 * NOT read here — a scratch left behind is disk, not a wrong answer.
 *
 * @param passes every completed pass in this invocation
 * @returns `EXIT_ERROR` on any unpersisted artifact, else what the outcomes aggregate to
 */
export function completedPassesExitCode({ passes }: { passes: readonly CompletedPass[] }): number {
  if (passes.some((p) => p.persistError !== undefined)) {
    return EXIT_ERROR;
  }
  return aggregateExitCode({ outcomes: passes.map((p) => p.record.outcome) });
}

/** Report a set of completed passes and pick the exit code. */
function report({ passes }: { passes: readonly CompletedPass[] }): number {
  for (const line of codexHumanLines({ passes })) {
    logger.info({ msg: line });
  }
  logger.out({ line: codexResultJson({ passes }) });
  for (const line of scratchReclaimFailureLines({ passes })) {
    logger.error({ msg: line });
  }
  if (passes.some((p) => p.persistError !== undefined)) {
    logger.error({ msg: "an artifact could not be written — the result above exists but was NOT persisted" });
  }
  return completedPassesExitCode({ passes });
}

/**
 * Report a batch of invocations: every duplicate refusal, then every completed pass.
 *
 * A MIXED batch prints both halves and exits non-zero. That combination is the point: a fan-out where two
 * properties were duplicates and three ran must not report success and must not hide the three artifacts it
 * produced. A refusal is printed even when every pass was refused, so the caller is never left with an empty
 * report and a bare exit code. An unroutable pass printed its own refusal when routing made it.
 *
 * @param invocations what each pass returned
 * @returns the exit code — the routing refusal's on any unroutable pass, usage on any duplicate, else whatever
 *   the completed passes aggregate to
 */
export function reportInvocations({ invocations }: { invocations: readonly PassInvocation[] }): number {
  const refused = invocations.filter((invocation) => invocation.kind === "refused");
  for (const invocation of refused) {
    reportAdmission({ admission: invocation.admission });
  }
  const unrouted = invocations.find((invocation) => invocation.kind === "unrouted");
  const passes = invocations
    .filter((invocation) => invocation.kind === "completed")
    .map((invocation) => invocation.pass);
  const code = passes.length === 0 ? EXIT_USAGE : report({ passes });
  if (unrouted !== undefined) {
    return unrouted.exitCode;
  }
  return refused.length > 0 ? EXIT_USAGE : code;
}
