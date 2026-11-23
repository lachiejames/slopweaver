/**
 * The runner for `command:` probes — the ONE place this repo executes a shell string a doc supplied.
 *
 * ## Why this is its own file
 *
 * It is a sanctioned direct seam, and a sanction should name the smallest thing that needs it. Folding this
 * into the `handover` command module would bless a file that also parses flags, reads the board and prints it,
 * so a later shell call added anywhere in it would inherit the exemption silently. The sanction is keyed by
 * FILE, so keeping the file to one job is what keeps the exemption narrow.
 *
 * ## What bounds it
 *
 * - **Opt-in per invocation.** `--probe` is the ONLY route here — no verb supplies a runner without it, not
 *   even the single-doc ones. So a bare `handover list` never reaches this, which is what stops printing the
 *   board from running arbitrary shell from every doc on it.
 * - **Bounded.** A timeout, and output discarded rather than piped — a probe reports an exit code, and a
 *   pipe that nobody drains is how a diagnostic wedges.
 * - **Reaped.** The shell runs under `src/worktree/shell.ts`'s supervisor, so a probe that runs `yarn build` or
 *   `yarn typecheck` and hits the bound takes its whole process group with it — TERM, then SIGKILL after the
 *   grace. Timing out only the `/bin/sh` leader left the compiler it started running on, and the native
 *   TypeScript 7 compiler ignores SIGTERM. One consequence the outcome shows: a job
 *   killed by a signal reaches this file as the supervisor's exit status, 128 plus the signal's number.
 * - **Never throws.** A command that cannot even launch has not passed. The board still has to print.
 * - **It reports HOW it ended, not merely whether.** A `boolean` makes a timeout, a shell that never
 *   launched and an honest exit 1 the same answer, and the refusal that prints it can then only say
 *   "command exited non-zero" — which is what sent a session hunting an unreproducible mismatch for an hour.
 * - **The child's launcher says nothing it did not have to** ({@link #lib/launcherEnv}). `bin/slopweaver`
 *   prints advisories to stderr before running a verb; a probe written as `… 2>&1 | head -1 | grep -q …`
 *   reads whichever line comes first, so one of those advisories can fail a probe whose command was fine.
 *   That module carries the measured defect and the one-command repro.
 *
 * A `command:` probe is strictly weaker evidence than a declarative one, and the module header of
 * {@link ./evaluate} carries the measurement that shows why: a text tool decides for itself whether a file is
 * text, and one stray NUL byte makes `grep` blind to a whole file while reporting a clean exit. Prefer
 * `present:`/`absent:`/`path:` wherever the question can be put that way.
 */

import { execFileSync } from "node:child_process";

import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { isRecord } from "#lib/parsers.js";

import { SUPERVISOR_GRACE_SECONDS, SUPERVISOR_SHELL, supervisorArgv } from "../worktree/shell.js";
import type { CommandProbeOutcome } from "./probe.js";

/** How long a single `command:` probe may run before it is abandoned. A board must never hang. */
export const COMMAND_PROBE_TIMEOUT_MS = 30_000;

/**
 * How one probe ended, read off whatever `execFileSync` threw.
 *
 * Pure, and exported so the mapping is asserted directly: the endings a caller must be able to tell apart — an
 * exit status the command chose, a signal, the runner's own budget running out, and a shell that never
 * launched — are indistinguishable once they have been collapsed into a boolean, which is exactly what this
 * replaced.
 *
 * **A timeout is read off `code`, never off the status or the signal.** Node sends `SIGTERM` when the budget
 * runs out, and a child that traps it exits with a status of its own choosing. MEASURED: a
 * `yarn lint` probe came back `{ code: "ETIMEDOUT", status: 143, signal: null }`, read as "command exited 143",
 * and `handover finish` reported a failure the probe never observed. Repro, with a 500ms budget, prints
 * `ETIMEDOUT 143 null`:
 * `node -e 'const{execFileSync}=process.getBuiltinModule("node:child_process");try{execFileSync("/bin/sh",["-c","trap \"exit 143\" TERM; sleep 5 & wait"],{timeout:500})}catch(e){console.log(e.code,e.status,e.signal)}'`
 *
 * @param error the value `execFileSync` threw
 * @param budgetMs the timeout the runner gave the command, reported back when it is what ended the run
 * @returns the outcome to report, never throwing and never inventing a status
 */
export function commandProbeFailure({ error, budgetMs }: { error: unknown; budgetMs: number }): CommandProbeOutcome {
  // A thrown value is `unknown`, and `status`/`signal` arrive as `null` — not absent — on the paths that do
  // not set them, so every field is read through a guard rather than asserted into a shape.
  const thrown = isRecord(error) ? error : {};
  const rawStatus = thrown["status"];
  const rawSignal = thrown["signal"];
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  const signal = typeof rawSignal === "string" ? rawSignal : undefined;
  if (thrown["code"] === "ETIMEDOUT") {
    return { launchFailure: undefined, signal, status, timedOutAfterMs: budgetMs };
  }
  if (status !== undefined || signal !== undefined) {
    return { launchFailure: undefined, signal, status, timedOutAfterMs: undefined };
  }
  const rawMessage = thrown["message"];
  const message = typeof rawMessage === "string" ? rawMessage : "no reason reported";
  return { launchFailure: message, signal: undefined, status: undefined, timedOutAfterMs: undefined };
}

/**
 * A runner for `command:` probes, scoped to one repository.
 *
 * The child's environment comes from {@link quietLauncherEnv} rather than `process.env`, so a nested
 * `bin/slopweaver` prints no advisory that a probe's own pipeline could read as the verb's answer. Which
 * code that launcher resolves is deliberately UNCHANGED — see that module for why scrubbing `PLUGIN_ROOT`
 * was the wrong fix.
 *
 * @param repo the working directory the command runs in
 * @returns a function reporting how the command ended — never throwing, because a probe that could not run
 *   has not passed and the caller still has to report
 */
export function commandProbeRunner({ repo }: { repo: string }): (args: { command: string }) => CommandProbeOutcome {
  return ({ command }) => {
    try {
      const argv = supervisorArgv({
        args: ["-c", command],
        graceSeconds: SUPERVISOR_GRACE_SECONDS,
        name: "probe",
        program: "/bin/sh",
      });
      execFileSync(SUPERVISOR_SHELL, argv, {
        cwd: repo,
        env: quietLauncherEnv(),
        stdio: ["ignore", "ignore", "ignore"],
        timeout: COMMAND_PROBE_TIMEOUT_MS,
      });
      return { launchFailure: undefined, signal: undefined, status: 0, timedOutAfterMs: undefined };
    } catch (error: unknown) {
      return commandProbeFailure({ budgetMs: COMMAND_PROBE_TIMEOUT_MS, error });
    }
  };
}
