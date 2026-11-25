/**
 * The GUARDIAN of a lock holder `/bin/ps` cannot stamp: an unsandboxed ancestor that read its own exact start stamp
 * and handed `{ pid, start }` down through two environment fields, so a holder inside Codex's sandbox still carries
 * an identity a never-stale lease can trust.
 *
 * Why it exists, measured: inside an app Codex seat (codex-acp under Codex's seatbelt sandbox) `/bin/ps` cannot be
 * exec'd at all — `codex sandbox -c 'sandbox_mode="workspace-write"' -- /bin/ps -o lstart= -p 1` exits 71, "execvp()
 * of '/bin/ps' failed: Operation not permitted" — so `./lockHolder.ts`'s `ownProcessStart` answers `undefined` there
 * and every never-stale lease was refused. Signal 0 still answers from inside: `codex sandbox -c
 * 'sandbox_mode="workspace-write"' -- /bin/kill -0 <a live pid of the same user>` prints "Operation not permitted"
 * (EPERM, which the probe counts as alive) and the same against a finished pid prints "No such process" (ESRCH).
 *
 * The desktop's Codex worker (`desktop/src/sessionWorker/processGuardian.ts`) is the writer of these fields; the
 * desktop builds apart from `src/` and restates the two names, and `desktop/__tests__/unit/processGuardian.test.ts`
 * fails the moment they differ. They are NOT an override: a guardian can only keep a holder standing that the kernel
 * still answers for, never declare one dead.
 */
import { isRecord } from "#lib/parsers.js";

import { holderRunning, type StartOf } from "../talk/relayLease.js";

/** The process vouching for a holder: its pid, and the exact start stamp it read for itself before handing it down. */
export interface ProcessGuardian {
  readonly pid: number;
  readonly start: string;
}

/** The environment field carrying the guardian's pid, as a decimal positive integer. */
export const GUARDIAN_PID_ENV = "SLOPWEAVER_SESSION_GUARDIAN_PID";

/** The environment field carrying the guardian's start stamp, byte for byte what `ps -o lstart=` printed for it. */
export const GUARDIAN_START_ENV = "SLOPWEAVER_SESSION_GUARDIAN_START";

/** A pid as the environment carries it: decimal digits, no sign, no leading zero, no padding. */
const DECIMAL_PID = /^[1-9]\d*$/u;

/**
 * The guardian a recorded value names, or `undefined` for anything that is not exactly one: a positive safe-integer
 * pid and a non-blank stamp. A malformed guardian is dropped rather than refused, so the record it rode in is judged
 * exactly as one that never carried a guardian.
 *
 * @param value the decoded `guardian` field of a lock record, or what the environment fields parsed to
 * @returns the guardian, or `undefined` when the value does not name one
 */
export function guardianOf({ value }: { value: unknown }): ProcessGuardian | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { pid, start } = value;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (typeof start !== "string" || start.trim().length === 0) {
    return undefined;
  }
  return { pid, start };
}

/**
 * The guardian this process's environment names, parsed strictly: both fields present, the pid a decimal positive
 * integer, the stamp non-blank. Anything else is no guardian at all.
 *
 * @param env the environment to read, `process.env` in production
 * @returns the guardian, or `undefined` when the environment names none
 */
export function guardianFromEnvironment({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): ProcessGuardian | undefined {
  const pid = env[GUARDIAN_PID_ENV];
  const start = env[GUARDIAN_START_ENV];
  if (pid === undefined || start === undefined || !DECIMAL_PID.test(pid)) {
    return undefined;
  }
  return guardianOf({ value: { pid: Number(pid), start } });
}

/**
 * Whether a guardian still vouches for the holder that recorded it: its pid running and not since handed to another
 * process — the same `holderRunning` rule every holder in the tree is judged by. A current stamp that DIFFERS from
 * the recorded one is a recycled pid and vouches for nothing; a current stamp that cannot be READ (a reader inside
 * the sandbox, where `/bin/ps` cannot run) leaves the guardian's pid alone to decide, erring toward a held lock rather
 * than toward two writers — the exact comparison is made by any reader that can run `ps`.
 *
 * @param guardian the guardian a record or this process carries, if any
 * @param startOf a pid's current state — injected so a dead or recycled guardian is a fixture, not a process
 * @returns true when there is a guardian and it is still the process that handed its identity down
 */
export function guardianVouches({
  guardian,
  startOf,
}: {
  guardian: ProcessGuardian | undefined;
  startOf: StartOf;
}): boolean {
  if (guardian === undefined) {
    return false;
  }
  return holderRunning({ holder: guardian, startOf });
}
