/**
 * How one bounded `slopweaver` child ended — a NAMED outcome, never a bare `number | null`.
 *
 * `null` used to stand for three different things at once: the child was killed by the budget, killed by
 * somebody else, or never started. A tick that cannot tell them apart cannot say which of its readings is
 * stale because the machine was loaded, which is the one it most needs to say: over the chair's passes
 * 597–616 the session-start refresh overran its 180-second wait on 14 of about 18 passes, at a
 * load average of 25–61. Every child now carries a budget, and a budget spent is its own outcome.
 *
 * No I/O, no clock.
 */

/** One child's ending. `durationMs` is wall time from launch to the end the outcome names. */
export type ChildOutcome =
  | { readonly kind: "exited"; readonly exitCode: number; readonly durationMs: number }
  | { readonly kind: "signalled"; readonly signal: string; readonly durationMs: number }
  | {
      readonly kind: "timed-out";
      readonly timeoutMs: number;
      readonly signal: "SIGKILL";
      readonly durationMs: number;
    }
  | { readonly kind: "launch-failed"; readonly message: string; readonly durationMs: number };

/**
 * The exit code an outcome carries, for a caller that still speaks exit codes.
 *
 * @returns the exit code, or null when the child never reached one
 */
export function exitCodeOf({ outcome }: { outcome: ChildOutcome }): number | null {
  return outcome.kind === "exited" ? outcome.exitCode : null;
}

/**
 * One clause saying how a child ended, for a summary line.
 *
 * @returns e.g. `exit 1`, `timed out after 120s (killed)`, `killed by SIGTERM`, `did not start: ENOENT`
 */
export function describeChildOutcome({ outcome }: { outcome: ChildOutcome }): string {
  switch (outcome.kind) {
    case "exited":
      return `exit ${String(outcome.exitCode)}`;
    case "signalled":
      return `killed by ${outcome.signal}`;
    case "timed-out":
      return `timed out after ${String(Math.round(outcome.timeoutMs / 1000))}s (killed)`;
    case "launch-failed":
      return `did not start: ${outcome.message}`;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
