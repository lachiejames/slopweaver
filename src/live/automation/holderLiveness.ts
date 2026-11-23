/**
 * Whether the process named on an open slot attempt still runs — the one effect behind
 * `./slotAttempt.ts#judgeSlotAttempt`'s `holderAlive`.
 *
 * Only a definite "no such process" reads dead. `process.kill(pid, 0)` sends no signal; ESRCH is the kernel
 * saying the pid is not addressable, EPERM says it exists under another user, and any other failure is a
 * probe that could not tell — which must read ALIVE, because reading it dead would abandon a live attempt
 * and hand its firing to a second run. Pid reuse fails the same safe way: a recycled pid reads alive and the
 * attempt stays held until its cadence-derived lease, exactly as before the pid was recorded.
 *
 * A pid carries no host, so this is meaningful only because `$SLOPWEAVER_HOME` is one local machine
 * (`docs/constraints.md`).
 */
import { isRecord } from "../../lib/parsers.js";
import type { RecipeSlotAttempt } from "./slotAttempt.js";

/** Reads whether one pid is still a running process. Injected so every caller's tests pass a plain fake. */
export type ProcessAlive = (args: { readonly pid: number }) => boolean;

/**
 * Whether a failed `kill(pid, 0)` still means the process exists. PURE.
 *
 * @param code the error's `code`, or `undefined` when it carried none
 * @returns false only for ESRCH, the one answer that proves the process is gone
 */
export function killFailureReadsAlive({ code }: { readonly code: unknown }): boolean {
  return code !== "ESRCH";
}

/**
 * The production {@link ProcessAlive}: probe the pid with signal 0.
 *
 * @param pid the process to look for
 * @returns true unless the kernel answered that no such process exists
 */
export function recipeHolderAlive({ pid }: { readonly pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (!isRecord(error)) {
      return true;
    }
    return killFailureReadsAlive({ code: error["code"] });
  }
}

/**
 * The `holderAlive` reading for one stored row: `null` when there is no row or it names no process, so the
 * probe is never run for a PID-less attempt, otherwise what the injected probe answers.
 *
 * @param processAlive the probe to ask
 * @param stored the slot's row, or `null`
 * @returns the reading `judgeSlotAttempt` takes
 */
export function holderAliveFor({
  processAlive,
  stored,
}: {
  readonly processAlive: ProcessAlive;
  readonly stored: RecipeSlotAttempt | null;
}): boolean | null {
  const holderPid = stored?.holderPid;
  if (holderPid == null) {
    return null;
  }
  return processAlive({ pid: holderPid });
}
