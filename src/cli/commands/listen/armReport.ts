/**
 * What `slopweaver listen arm` PRINTS — the connection budget it reports, and the plan it hands the session.
 *
 * Split out of `supervise.ts` when that file passed the size ratchet: the deciding half (`planArm` in
 * {@link ./armPlan.js}, the refusal when a live arm already exists) and the reporting half are separate
 * concerns, and only this one reads the Socket Mode observation the listener itself wrote.
 */

import { type Logger, logger } from "../../../lib/logger.js";
import { armConnectionLines, type SocketConnectionObservation } from "../../../live/listen/supervise/socketBudget.js";
import { readSocketConnectionObservation } from "../../../live/listen/supervise/store.js";
import type { ArmPlan } from "./armPlan.js";

/**
 * What this home last heard from Slack about the app's Socket Mode connection count, ready to print: the
 * reading when it could be read, and the read failure NAMED when it could not.
 *
 * A failure renders as itself rather than as "no reading" — those are different facts, and printing the
 * second when the first is true is the class of confident lie this whole report exists to end.
 *
 * @param home the Slopweaver home the record lives under
 * @param nowMs the clock, so the reading's age can be rendered
 * @returns the lines to narrate, and the reading itself for `--json`
 */
function connectionBudget({ home, nowMs }: { home: string; nowMs: number }): {
  readonly lines: readonly string[];
  readonly observation: SocketConnectionObservation | undefined;
  readonly problem: string | undefined;
} {
  const read = readSocketConnectionObservation({ home });
  if (read.isErr()) {
    const problem = `could not read the last Socket Mode connection count (${read.error.message}) — arming without it`;
    return { lines: [problem], observation: undefined, problem };
  }
  return {
    lines: armConnectionLines({ nowMs, observation: read.value }),
    observation: read.value,
    problem: undefined,
  };
}

/**
 * Print an arm plan as JSON, or as the command plus the two paths a human wants to see.
 *
 * The connection budget is narrated FIRST, ahead of every other stderr line, because it is the one thing a
 * session needs BEFORE it decides to open another socket — an earlier cut had that number reaching a dead
 * process's stderr seconds after the arm record had already been written.
 *
 * @param home the Slopweaver home the connection observation is read from
 * @param json emit the machine shape instead of the human one
 * @param nowMs the clock, so the reading's age can be rendered
 * @param plan the already-decided arm
 * @param log where the narration and the plan go; omitted, the process logger
 */
export function printArmPlan({
  home,
  json,
  nowMs,
  plan,
  log = logger,
}: {
  home: string;
  json: boolean;
  nowMs: number;
  plan: ArmPlan;
  log?: Logger;
}): void {
  const { lines, observation, problem } = connectionBudget({ home, nowMs });
  // Narrated on BOTH shapes, and first on both: `--json` puts its document on stdout, so stderr is still
  // free to carry the sentence a human reads, and dropping it there made the machine caller the only one
  // told anything.
  for (const line of lines) {
    log.error({ msg: line });
  }
  if (json) {
    // Spelled as statements rather than defaulting expressions: `null` is the JSON shape for "never
    // observed", and this repo's no-silent-fallback rule wants each absent case named out loud.
    // `socketConnectionsProblem` is what keeps the two absences apart — a record that could not be READ is
    // a different fact from one that was never written, and a machine reader handed only `null` would
    // narrate "this arm opens blind" about a corrupt file.
    let socketConnections: SocketConnectionObservation | null = null;
    if (observation !== undefined) {
      socketConnections = observation;
    }
    let socketConnectionsProblem: string | null = null;
    if (problem !== undefined) {
      socketConnectionsProblem = problem;
    }
    log.out({ line: JSON.stringify({ ...plan, socketConnections, socketConnectionsProblem }) });
    return;
  }
  log.out({ line: plan.command });
  log.error({
    msg: plan.background
      ? `arm ${plan.armId} — mentions (watch this) ${plan.mentionsPath}, narration ${plan.logPath}, queue ${plan.queuePath}`
      : `arm ${plan.armId} — queue ${plan.queuePath}`,
  });
  log.error({
    msg: plan.background
      ? "run that in THIS session's own shell — backgrounded but NOT detached, so it dies when the session does"
      : "run that as THIS session's own long-lived shell call — not detached, so it dies when the session does",
  });
  // Printed on EVERY arm, deliberately, because it is the one thing an operator has to do at a moment this
  // program never sees. `listen reconcile` derives a death from the journal, and an arm stopped without a
  // journalled `disarmed` is indistinguishable from one something reaped — measured: two
  // ordered stops and three harness reaps left the identical trace. And do not start a watcher beside it:
  // a sibling background task of the same session dies in the same reap, three times for three that day.
  log.error({
    msg:
      "to stop it later, run `slopweaver listen disarm` FIRST and then kill it — an unjournalled stop is " +
      "counted as a death. Do not start a death-watch beside it; it dies in the same reap.",
  });
}
