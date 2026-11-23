/**
 * The verdict of one gate PROCESS, read from how it ended — the pure half of `gateWorker.ts`, which cannot
 * export it itself (a worker entry that also exported helpers would be loaded twice).
 *
 * The rule is FAIL CLOSED: a gate passes only when its process ran, exited by itself, and said `0`. Every
 * other ending is a failed gate — a signal (the out-of-memory abort V8 raises, or the SIGKILL the per-gate
 * ceiling sends), a spawn error, or any non-zero status. A violation that crashes a gate out of memory
 * before its verdict line prints must still fail it, because anything else is just another failure mode.
 *
 * MEASURED that the launcher every gate runs under carries the death through: a child grown past
 * `--max-old-space-size=64` under `node_modules/.bin/tsx` exits 134, and one that SIGKILLs itself exits 137.
 * Reproduce with any script that allocates without bound, run as
 * `node_modules/.bin/tsx --max-old-space-size=64 <script>`, then read `$?`.
 */

/** How a synchronous child ended: the three fields of `spawnSync`'s result this verdict reads. */
export interface GateProcessEnd {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: Error | undefined;
}

/**
 * Whether a gate's process ended in a PASS. Only a clean, self-chosen `0` does.
 *
 * @param end how the child ended
 * @returns true only for exit status 0 with no signal and no spawn error
 */
export function gateProcessPassed({ end }: { end: GateProcessEnd }): boolean {
  return end.error === undefined && end.signal === null && end.status === 0;
}

/**
 * The line naming a gate that died rather than exited, or `undefined` when it exited by itself.
 *
 * A gate killed before its verdict line printed leaves nothing in its own output to say so, so the runner
 * says it: without this, the summary's `✗` would be the only trace and the log would look truncated.
 *
 * @param end how the child ended
 * @returns the note to append to the gate's stderr, or `undefined`
 */
export function gateDeathNote({ end }: { end: GateProcessEnd }): string | undefined {
  if (end.signal !== null) {
    return `dev lint: this gate was killed by ${end.signal} before it exited, so it FAILS — an out-of-memory abort is SIGABRT, the per-gate ceiling is SIGKILL`;
  }
  if (end.status === null) {
    return "dev lint: this gate ended with no exit status, so it FAILS";
  }
  return undefined;
}
