/**
 * The effectful half of `slopweaver claude mint`: the throwaway directory a mint runs in, the worker that runs
 * the login under `/usr/bin/expect`, and the reads of what it left behind. Every decision is in `mintFlow.ts`.
 *
 * ## The directory, and why it lives under the home
 *
 * `$SLOPWEAVER_HOME/claude-accounts/minting/<uuid>/`, `0700`: the program, the `$BROWSER` capture script, the
 * captured URL, the abort file, the SCREEN LOG — which holds the token in the clear once the login prints it
 * — and a `store/` the login is pointed at, so a mint can never write into a store routing reads. The screen
 * log is pre-created `0600` before anything can write to it. Every path removes the directory before the verb
 * returns; a mint killed outright leaves it behind, so the next mint deletes every leftover OLDER than any
 * mint can live and says so. Only the old ones: two seats may mint two plans at once, and a live mint's
 * directory is its capture file and its login server's screen.
 *
 * ## Two deadlines, and which is a policy
 *
 * The authorize URL must reach the capture script within {@link MINT_URL_WAIT_MS}: the login hands it over
 * the moment it starts, so a minute is a measurement's margin, not a judgement. The whole mint may take
 * {@link MINT_DEADLINE_MS} — a POLICY choice, not a measurement: the seat drives the page but the owner may
 * be fetching a sign-in code from a mailbox, and fifteen minutes is long enough for that and short enough
 * that a forgotten mint does not hold a login server open all afternoon.
 */
import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { err, ok, type Result } from "#lib/result.js";

import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import { captureScript, MINT_PTY_PROGRAM, type MintPtyReport, type MintPtyRequest } from "./mintFlow.js";

/** How long the login has to hand its browser the authorize URL. */
const MINT_URL_WAIT_MS = 60_000;

/** How long a whole mint may take — a policy choice; see this file's header. */
export const MINT_DEADLINE_MS = 15 * 60_000;

/** How far past the program's own deadline the worker's `spawnSync` ceiling sits. */
const WORKER_CEILING_MARGIN_MS = 30_000;

/** How often the URL wait looks for the captured file. */
const URL_POLL_MS = 250;

/** Where every mint's directory lives, relative to the Slopweaver home. */
const MINTING_DIR = "claude-accounts/minting";

/**
 * The login the pty spawns, as DATA handed to expect's `$argv` — the program never names it.
 * Resolved on `PATH` by expect, exactly as the owner's own terminal would resolve it.
 */
const MINT_ARGV: readonly string[] = ["claude", "setup-token"];

/**
 * Inherited variables the login must not see. Whether an inherited OAuth token would steer `setup-token` is
 * UNMEASURED; stripping both costs nothing and removes the question.
 */
const STRIPPED_ENV: ReadonlySet<string> = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
]);

/** Every path inside one mint's directory. */
export interface MintPaths {
  readonly dir: string;
  readonly programPath: string;
  readonly scriptPath: string;
  readonly screenLogPath: string;
  readonly urlPath: string;
  readonly abortPath: string;
  readonly storeDir: string;
}

/** A running mint: the report expect's exit will produce, and the way to stop it early. */
export interface MintPtyHandle {
  readonly finished: Promise<MintPtyReport>;
  /** Ask the program to exit at its next one-second tick; it exits 4 and the login's server goes with it. */
  readonly abort: () => void;
}

/**
 * Create one mint's directory, first deleting every leftover a killed mint left behind.
 *
 * A leftover is a directory last modified before the longest a mint can run — its whole deadline plus the
 * worker's ceiling margin — so a mint another seat is running right now is never one of them.
 *
 * @param home the Slopweaver home
 * @param nowMs the instant to judge a leftover's age against
 * @returns the paths and how many leftovers were removed, or why the directory could not be made
 */
export function prepareMintDir({
  home,
  nowMs,
}: {
  home: string;
  nowMs: number;
}): Result<{ readonly paths: MintPaths; readonly cleared: number }, ClaudeRotationError> {
  const root = `${home}/${MINTING_DIR}`;
  const dir = `${root}/${randomUUID()}`;
  const paths: MintPaths = {
    abortPath: `${dir}/abort`,
    dir,
    programPath: `${dir}/program.exp`,
    screenLogPath: `${dir}/screen.log`,
    scriptPath: `${dir}/browser.sh`,
    storeDir: `${dir}/store`,
    urlPath: `${dir}/authorize-url`,
  };
  try {
    mkdirSync(root, { mode: 0o700, recursive: true });
    const oldest = nowMs - (MINT_DEADLINE_MS + WORKER_CEILING_MARGIN_MS);
    const leftovers = readdirSync(root).filter((entry) => statSync(`${root}/${entry}`).mtimeMs < oldest);
    for (const leftover of leftovers) {
      rmSync(`${root}/${leftover}`, { force: true, recursive: true });
    }
    mkdirSync(paths.storeDir, { mode: 0o700, recursive: true });
    writeFileSync(paths.programPath, MINT_PTY_PROGRAM, { mode: 0o600 });
    writeFileSync(paths.scriptPath, captureScript({ urlPath: paths.urlPath }), { mode: 0o700 });
    writeFileSync(paths.screenLogPath, "", { mode: 0o600 });
    return ok({ cleared: leftovers.length, paths });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown failure";
    return err(ClaudeRotationErrors.mintPtyFailed({ detail: `could not prepare the mint directory: ${detail}` }));
  }
}

/** Where the worker is loaded from in the source tree — a bare literal so `knip` sees the reference. */
const MINT_WORKER_SOURCE = new URL("./mintPtyWorker.ts", import.meta.url);

/** The same worker in the emitted tree, where every module is `.js`. */
const MINT_WORKER_BUILT = new URL("./mintPtyWorker.js", import.meta.url);

/** The worker beside THIS module: TypeScript under tsx, emitted JavaScript under the built CLI. */
function mintWorkerUrl(): URL {
  if (import.meta.url.endsWith(".ts")) {
    return MINT_WORKER_SOURCE;
  }
  return MINT_WORKER_BUILT;
}

/**
 * The login's environment: the inherited one, minus the inherited tokens, plus the capture script as its
 * browser, the throwaway store, and the three variables the program reads.
 *
 * @param inherited the environment this process was started with
 * @param paths the mint's directory
 * @param deadlineMs the whole mint's deadline
 * @returns the environment expect and the login run under
 */
export function mintEnv({
  deadlineMs,
  inherited,
  paths,
}: {
  deadlineMs: number;
  inherited: Readonly<Record<string, string | undefined>>;
  paths: MintPaths;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined && !STRIPPED_ENV.has(name)) {
      env[name] = value;
    }
  }
  return {
    ...env,
    BROWSER: paths.scriptPath,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: paths.storeDir,
    SLOPWEAVER_MINT_ABORT: paths.abortPath,
    SLOPWEAVER_MINT_DEADLINE_S: String(Math.ceil(deadlineMs / 1000)),
    SLOPWEAVER_MINT_SCREEN_LOG: paths.screenLogPath,
  };
}

/**
 * Start the login under `/usr/bin/expect` on a worker thread.
 *
 * @param paths the mint's directory
 * @param deadlineMs the whole mint's deadline; the worker's own ceiling sits past it
 * @returns the report promise, which always settles, and the abort
 */
export function startMintPty({ deadlineMs, paths }: { deadlineMs: number; paths: MintPaths }): MintPtyHandle {
  const request: MintPtyRequest = {
    argv: [...MINT_ARGV],
    env: mintEnv({ deadlineMs, inherited: process.env, paths }),
    programPath: paths.programPath,
    timeoutMs: deadlineMs + WORKER_CEILING_MARGIN_MS,
  };
  const worker = new Worker(mintWorkerUrl(), { execArgv: process.execArgv, workerData: request });
  return watchMintWorker({ paths, worker });
}

/**
 * Turn a running worker into a mint handle: a report promise that ALWAYS settles, and the abort.
 *
 * A worker that errors, or exits having posted nothing, still settles the promise with a failed report, so
 * the verb's `finally` — which removes the directory holding the token — can never wait forever.
 *
 * @param worker the thread running the pty, or anything emitting the same three events
 * @param paths the mint's directory, whose abort file the abort writes
 * @returns the handle
 */
export function watchMintWorker({ paths, worker }: { paths: MintPaths; worker: EventEmitter }): MintPtyHandle {
  const finished = new Promise<MintPtyReport>((resolve) => {
    let reported = false;
    worker.on("message", (message: MintPtyReport) => {
      reported = true;
      resolve(message);
    });
    worker.on("error", (error: Error) => {
      reported = true;
      resolve({ hung: false, status: null, stderrTail: error.message });
    });
    // The backstop for a worker that goes away having posted nothing — deferred, so a message already in
    // flight is delivered first (`gateRunner.ts` measured `exit` arriving before `message` on a busy host).
    worker.on("exit", (code: number) => {
      setImmediate(() => {
        if (!reported) {
          resolve({
            hung: false,
            status: null,
            stderrTail: `the mint worker exited ${String(code)} and reported nothing`,
          });
        }
      });
    });
  });
  const abort = (): void => {
    try {
      writeFileSync(paths.abortPath, "");
    } catch {
      // The directory is already gone, which means the mint already finished — there is nothing to stop.
    }
  };
  return { abort, finished };
}

/**
 * Wait for the login to hand its browser the authorize URL.
 *
 * @param paths the mint's directory
 * @param pty the running mint, so a login that exits early ends the wait at once
 * @returns the captured URL, MINT_TIMED_OUT when none arrived in time, or MINT_PTY_FAILED when the login ended first
 */
export async function waitForAuthorizeUrl({
  paths,
  pty,
}: {
  paths: MintPaths;
  pty: MintPtyHandle;
}): Promise<Result<string, ClaudeRotationError>> {
  let ended: MintPtyReport | undefined;
  void pty.finished.then((report) => {
    ended = report;
    return report;
  });
  const deadline = Date.now() + MINT_URL_WAIT_MS;
  while (Date.now() < deadline) {
    const captured = readCaptured({ urlPath: paths.urlPath });
    if (captured !== undefined) {
      return ok(captured);
    }
    if (ended !== undefined) {
      const detail = `the login exited (${String(ended.status)}) before handing its browser a URL`;
      return err(ClaudeRotationErrors.mintPtyFailed({ detail }));
    }
    await new Promise((resolve) => setTimeout(resolve, URL_POLL_MS));
  }
  return err(ClaudeRotationErrors.mintTimedOut({ stage: "authorize-url" }));
}

/**
 * The captured URL, once the capture script's rename has landed it.
 *
 * @param urlPath where the capture script writes
 * @returns the URL, or undefined while nothing has been captured
 */
function readCaptured({ urlPath }: { urlPath: string }): string | undefined {
  try {
    return readFileSync(urlPath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The raw screen the pty recorded. An unreadable log reads as empty, which the scan reports as no token.
 *
 * @param paths the mint's directory
 * @returns the screen log's bytes as text
 */
export function readMintScreen({ paths }: { paths: MintPaths }): string {
  try {
    return readFileSync(paths.screenLogPath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Remove one mint's directory — the screen log, and the token in it, included.
 *
 * @param paths the mint's directory
 */
export function removeMintDir({ paths }: { paths: MintPaths }): void {
  rmSync(paths.dir, { force: true, recursive: true });
}
