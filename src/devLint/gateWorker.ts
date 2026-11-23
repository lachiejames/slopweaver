/**
 * One gate, run to completion on a worker thread — the other end of `devLint.ts`'s `runOneGate`.
 *
 * This module exists so `dev lint` can overlap gates WITHOUT an async `spawn`. The `no-headless` gate (rule
 * 2) bans `spawn`/`exec`/`execFile`/`fork` across this tree with no allowlist and no exemption marker, and
 * its own doc states why the sync forms stay legal: they block the caller, so they cannot outlive the
 * process that started them. A thread blocked on `spawnSync` keeps exactly that property — the child is
 * dead before the thread posts, and the thread is joined before the lap returns — while still letting four
 * gates be in flight at once. Nothing here starts a model; the concurrency is threads waiting on blocking
 * calls.
 *
 * It is deliberately the whole file: a worker entry that also exported helpers would be loaded twice, once
 * as a module and once as a thread, which is how a worker file grows a second life nobody meant it to have.
 */
import { spawnSync } from "node:child_process";
import { parentPort, workerData } from "node:worker_threads";
import { gateDeathNote, gateProcessPassed } from "./gateExit.js";
import type { GateReport } from "./gateRunner.js";

/** What `runOneGate` puts on the wire: the exact command, where to run it, and the ceiling. */
interface GateRequest {
  readonly args: readonly string[];
  readonly cmd: string;
  readonly cwd: string;
  /** The gate's own variables, laid over this process's environment; empty when the gate declares none. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

// `workerData` is `any` by declaration, so it is narrowed by a guard rather than asserted into shape: this
// is a process boundary, and the one caller that writes it lives in another module.
const request = gateRequestOf({ value: workerData as unknown });
const startedAt = Date.now();

// SIGKILL rather than the default SIGTERM: this ceiling exists for a process that is not responding, and a
// TERM it can ignore would leave the lap exactly as stuck as before. `maxBuffer` is Infinity because a
// gate's whole finding list is the thing being captured — a truncated one is a lint report that lies.
const finished = spawnSync(request.cmd, [...request.args], {
  cwd: request.cwd,
  encoding: "utf8",
  env: { ...process.env, ...request.env },
  killSignal: "SIGKILL",
  maxBuffer: Number.POSITIVE_INFINITY,
  stdio: ["ignore", "pipe", "pipe"],
  timeout: request.timeoutMs,
});

// `spawnSync` reports the ceiling as an ETIMEDOUT error rather than an exit code, and reports a command
// that never started the same way with a different code — so the error is read for WHICH, never just for
// whether. A gate killed at the ceiling is `hung`; anything else that failed to run is simply a failed gate
// whose message becomes its output, so the lap continues past it.
const hung = spawnHitCeiling({ error: finished.error });
const end = { error: finished.error, signal: finished.signal, status: finished.status };
const deathNote = gateDeathNote({ end });
const failureNote =
  (finished.error === undefined ? "" : `${finished.error.message}\n`) +
  (deathNote === undefined ? "" : `${deathNote}\n`);

// `stdio: "pipe"` plus `encoding: "utf8"` makes both streams strings, but the TYPE still admits null for
// the call shapes this one never uses, so the absent case is named rather than defaulted away.
const rawStdout = typeof finished.stdout === "string" ? finished.stdout : "";
const rawStderr = typeof finished.stderr === "string" ? finished.stderr : "";

const report: GateReport = {
  elapsedMs: Date.now() - startedAt,
  hung,
  // Fail closed: `./gateExit.ts` passes only a self-chosen 0, so a gate killed before its verdict is red.
  ok: gateProcessPassed({ end }),
  stderr: `${rawStderr}${failureNote}`,
  stdout: rawStdout,
};

parentPort?.postMessage(report);

/**
 * Whether a `spawnSync` failure was the per-gate ceiling firing rather than a command that never ran.
 *
 * Node reports the timeout kill through `error.errno`/`error.code` rather than through an exit status, and
 * the two are not the same fact: ETIMEDOUT means the gate ran too long and was killed, while ENOENT means
 * it was never there. Only the first earns the HUNG label in the summary.
 */
function spawnHitCeiling({ error }: { error: Error | undefined }): boolean {
  return errnoCodeOf({ error }) === "ETIMEDOUT";
}

/** The `code` field Node hangs off a spawn error, read without asserting a shape onto an unknown value. */
function errnoCodeOf({ error }: { error: Error | undefined }): string | undefined {
  if (error === undefined) {
    return undefined;
  }
  const code: unknown = Reflect.get(error, "code");
  if (typeof code !== "string") {
    return undefined;
  }
  return code;
}

/**
 * Narrow the thread's `workerData` to the request this worker was started with.
 *
 * A worker that was handed something else cannot run a gate at all, so this throws rather than inventing a
 * default — `runOneGate` turns the thrown error into a failed gate and the lap continues past it.
 */
function gateRequestOf({ value }: { value: unknown }): GateRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("dev lint gate worker: workerData was not an object");
  }
  const { args, cmd, cwd, env, timeoutMs } = value as Partial<GateRequest>;
  if (!Array.isArray(args) || typeof cmd !== "string" || typeof cwd !== "string" || typeof timeoutMs !== "number") {
    throw new Error("dev lint gate worker: workerData did not carry a gate request");
  }
  if (!isStringRecord(env)) {
    throw new Error("dev lint gate worker: workerData's env was not a map of strings");
  }
  return { args, cmd, cwd, env, timeoutMs };
}

/**
 * Whether a value is a plain map whose every value is a string, the only shape a child's environment takes.
 *
 * @param value what arrived as the request's `env`
 * @returns true when every own value is a string
 */
function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entries: readonly unknown[] = Object.values(value);
  return entries.every((entry) => typeof entry === "string");
}
