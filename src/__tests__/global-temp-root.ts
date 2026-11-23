/**
 * The per-RUN half of the temp-root sandbox — one parent directory that every test file's root lives inside,
 * and the sweep that removes it when the run ends.
 *
 * `src/__tests__/setup-temp-root.ts` is the per-FILE half and does the work; read its header for the leak
 * this closes and the 1,409,874-entry measurement behind it. This file exists for the two cases a per-file
 * `afterAll` provably cannot reach, both MEASURED while building it:
 *
 * - **A file whose tests are ALL skipped never runs its `afterAll`.** A `describe.skip` file still imports
 *   the setup, still mints a root, and leaves it behind — empty, but one per skipped file per run, which is
 *   exactly the silent accumulation the sandbox exists to end.
 * - **A worker that dies mid-file runs no hook at all.** This repo has had one (a fixture looping until a
 *   worker's heap died), and that root is NOT empty.
 *
 * A `process.on("exit")` inside the worker was tried first and does not fire: Vitest's forks pool kills its
 * workers rather than letting them exit, proved with a handler that wrote a marker file and never did.
 * `globalSetup` runs in the MAIN process, which does exit cleanly, so the sweep belongs here.
 *
 * **The sweep is one `rmSync`, never a `readdir` of the shared temp directory.** Every root of this run nests
 * inside one parent named for the main process's pid, so removing the parent removes all of them — and a
 * concurrent vitest in another session, under its own pid, is untouchable by construction. Scanning the
 * shared directory instead would reintroduce the 309.9-second `os.scandir` that started this whole incident.
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The variable each worker reads to find this run's parent directory. Workers inherit the main env. */
export const TEMP_ROOT_PARENT_VAR = "SLOPWEAVER_TEST_TEMP_PARENT";

/** This run's parent directory: named for the main process's pid, so it can only ever collect its own roots. */
function runParent(): string {
  return join(tmpdir(), `sw-tmp-${String(process.pid)}`);
}

/**
 * Publish this run's parent directory to every worker, before any of them is forked.
 *
 * It is deliberately NOT created here — `mkdtempSync` in a worker creates it on demand, so a run whose
 * workers never mint anything leaves nothing behind at all.
 *
 * @internal Vitest calls this through `globalSetup`; nothing in the repo imports it.
 */
export function setup(): void {
  process.env[TEMP_ROOT_PARENT_VAR] = runParent();
}

/**
 * Remove this run's parent directory and every per-file root still inside it, in one call.
 *
 * @internal Vitest calls this through `globalSetup`; nothing in the repo imports it.
 */
export function teardown(): void {
  rmSync(runParent(), { force: true, recursive: true });
}
