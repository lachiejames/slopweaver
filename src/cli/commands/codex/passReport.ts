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

/** Report a set of completed passes and pick the exit code. */
function report({ passes }: { passes: readonly CompletedPass[] }): number {
  for (const line of codexHumanLines({ passes })) {
    logger.info({ msg: line });
  }
  logger.out({ line: codexResultJson({ passes }) });
  // A pass whose artifact could not be written is a FAULT: the answer exists but was not persisted, and
  // saying otherwise would claim a durable record that is not there.
  if (passes.some((p) => p.persistError !== undefined)) {
    logger.error({ msg: "an artifact could not be written — the result above exists but was NOT persisted" });
    return EXIT_ERROR;
  }
  return aggregateExitCode({ outcomes: passes.map((p) => p.record.outcome) });
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
