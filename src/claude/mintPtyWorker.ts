/**
 * The mint's pseudo-terminal, run to completion on a worker thread — the other end of `mintPty.ts`'s
 * `startMintPty`.
 *
 * Why a thread blocked on ONE `spawnSync` rather than an async `spawn`: the `no-headless` gate (rule 2) bans
 * the async `child_process` capability across this tree, and a `spawnSync` on the main thread would freeze
 * the loop that has to watch for the authorize URL while the login runs. A thread keeps the sync property —
 * the child is dead before the thread posts, the thread is joined before the verb returns, and the ceiling is
 * `spawnSync`'s own `timeout` plus SIGKILL — exactly the shape `src/devLint/gateWorker.ts` established. The
 * login it runs starts no model.
 *
 * It posts expect's status and the tail of expect's OWN stderr, never stdout: `log_user 0` keeps the screen
 * off stdout, and the screen, which carries the token, is read from its 0600 log by the verb alone. Reading
 * the request and shaping the report are `mintFlow.ts`'s, where a unit test reaches them; what is left here
 * is the one spawn.
 *
 * Deliberately the whole file: a worker entry that also exported helpers would be loaded twice.
 */
import { spawnSync } from "node:child_process";
import { parentPort, workerData } from "node:worker_threads";

import { mintPtyReportOf, mintPtyRequestOf } from "./mintFlow.js";

// `workerData` is `any` by declaration, so it is narrowed by a guard rather than asserted into shape.
const request = mintPtyRequestOf({ value: workerData as unknown });

const finished = spawnSync("/usr/bin/expect", ["-f", request.programPath, ...request.argv], {
  encoding: "utf8",
  env: request.env,
  killSignal: "SIGKILL",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: request.timeoutMs,
});

parentPort?.postMessage(mintPtyReportOf({ error: finished.error, status: finished.status, stderr: finished.stderr }));
