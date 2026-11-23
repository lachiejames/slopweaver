/**
 * The instant a parent will kill this process, handed down so a verb whose work grows with what it reads can
 * answer inside it.
 *
 * `slopweaver talk verb` kills its child on a fixed deadline (`src/cli/commands/talk/verbRun.ts`), and an
 * unbounded `codex route` launches every registered Codex store's app-server and then scans each store's rollout
 * log in turn, so a long enough register would be killed before it printed a line — the voice answering "I can't
 * see the meter", the very failure the route was put on its list to end. Given this
 * instant, the route sizes its live read to it and opens no rollout log at all (`src/codex/fleetRead.ts`). The
 * parent names an ABSOLUTE instant rather than a budget, so the child's own start-up is already spent from it.
 *
 * The instant is wall-clock time, read by two processes, while the parent's kill is a duration. So a wall clock
 * stepped BACKWARD mid-read (NTP slews rather than steps, so this takes a manual set or a large correction) widens
 * the child's view past the kill, exactly as a suspension of the child would, and the parent's SIGKILL still ends
 * it — the route killed as it was before this existed. Kept rather than built around,
 * as a judgement: handing down a steady-clock reading instead would close it for the outer timeout, never for
 * `tclsh`, whose deadline reads `clock milliseconds`, wall time.
 *
 * Absent is a real answer, not a missing one: a verb run from a seat or a terminal has no parent waiting to
 * kill it, and reads the way it always has.
 */
import { err, ok, type Result } from "./result.js";

/** The variable carrying the instant, in epoch milliseconds. */
export const CHILD_DEADLINE_ENV = "SLOPWEAVER_CHILD_DEADLINE_AT_MS";

/**
 * The environment entry a parent adds to its child's environment to hand the deadline down.
 *
 * @param deadlineAtMs the epoch-millisecond instant the parent kills the child at
 * @returns the one entry to spread into the child's environment
 */
export function childDeadlineEnv({ deadlineAtMs }: { deadlineAtMs: number }): Readonly<Record<string, string>> {
  return { [CHILD_DEADLINE_ENV]: String(deadlineAtMs) };
}

/** A deadline variable that is set but does not hold an instant — a parent's bug, never read as "no deadline". */
export interface MalformedChildDeadlineError {
  readonly code: "MALFORMED_CHILD_DEADLINE";
  readonly message: string;
  readonly raw: string;
}

/** Every way reading the deadline fails. */
export type ChildDeadlineError = MalformedChildDeadlineError;

/** Builds each {@link ChildDeadlineError}. */
export const ChildDeadlineErrors = {
  malformed: ({ raw }: { raw: string }): MalformedChildDeadlineError => ({
    code: "MALFORMED_CHILD_DEADLINE",
    message: `${CHILD_DEADLINE_ENV} is not an epoch-millisecond instant: ${JSON.stringify(raw)}`,
    raw,
  }),
} as const;

/**
 * Read the deadline a parent handed this process, if it handed one.
 *
 * @param env the environment to read, `process.env` at a composition root
 * @returns the epoch-millisecond instant, null when no parent set one, or why the value set is not an instant
 */
export function readChildDeadline({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<number | null, ChildDeadlineError> {
  const raw = env[CHILD_DEADLINE_ENV];
  if (raw === undefined) {
    return ok(null);
  }
  const atMs = Number(raw);
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(atMs)) {
    return err(ChildDeadlineErrors.malformed({ raw }));
  }
  return ok(atMs);
}
