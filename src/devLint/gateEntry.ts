/**
 * The one lifecycle every lint-gate entry runs through: run the gate, close every TypeScript client, exit with
 * the gate's code. Every `src/devLint/*.entry.ts` is `await runGateEntry({ run })` and nothing else calls
 * `process.exit` — `gate-registration` holds that structurally (`gateRegistration.ts`).
 *
 * It adds no signal listener: a gate killed by `gateWorker.ts`'s timeout or by Ctrl-C dies with the default
 * disposition, and on TypeScript 7.1 its Go server exits on the closed pipe (`../lib/tsLifecycle.ts`).
 *
 * A process ending some way this wrapper never returns from — a `process.exit` in an imported module's top level, a
 * detached callback's uncaught throw inside `run` — still closes, through the registry's own exit-event backstop
 * (`../lib/tsLifecycle.ts`), which no text check of an entry could replace.
 */
import { closeTypeScript } from "../lib/tsLifecycle.js";

/**
 * Run one lint gate, close every TypeScript client whether it returned or threw, then exit with its code. A
 * thrown gate or a failed close is never swallowed: the exit is not reached, and the entry's top-level await
 * rejects, which Node reports as a non-zero exit.
 *
 * @param run runs the gate and answers its process exit code
 * @param close releases every TypeScript client; a test injects a recorder, an entry never passes it
 * @param exit ends the process with the gate's code; a test injects a recorder, an entry never passes it
 */
export async function runGateEntry({
  close = closeTypeScript,
  exit = process.exit,
  run,
}: {
  close?: () => void;
  exit?: (code: number) => void;
  run: () => number | Promise<number>;
}): Promise<void> {
  let code: number;
  try {
    code = await run();
  } finally {
    close();
  }
  exit(code);
}
