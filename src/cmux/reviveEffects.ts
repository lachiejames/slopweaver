/**
 * The effects of `cmux revive`: list processes, knock on the control socket from outside cmux, and quit and reopen
 * the app. The judgement is `./hang.ts` and `./appProcess.ts`; this file only touches processes and the socket.
 *
 * ## Why a raw connect, and not `./socket.ts`
 *
 * `openCmuxSocket` folds cmux's access refusal and a refused connect into one `SOCKET_UNAVAILABLE`, and from outside
 * cmux the refusal is exactly the answer that proves the app alive. So the probe writes one frame with no
 * capability and listens for ANY byte, or an orderly close, before its bound.
 *
 * ## Why `kill` and `open -a`, and nothing launchd
 *
 * The one-time runner that first did this was handed to launchd as a job, which re-ran it every few minutes until
 * removed, under a PATH with no node. This runs in the caller's own process — the
 * desktop app, started by Finder — and sends no Apple Event, so it needs no Automation consent either.
 */
import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { cmuxAppOf, type PsRow, parsePsRows, parsePsRowsStrict } from "./appProcess.js";
import { encodeRequest } from "./socketFrames.js";
import { productionSocketPathSources, resolveCmuxSocketPath } from "./socketPath.js";

/** How long one probe waits for any byte. A responsive app answers in milliseconds; a paged-out one in seconds. */
export const PROBE_TIMEOUT_MS = 5_000;

/** How long the app gets to honour TERM before KILL — the runner measured TERM honoured inside this. */
const TERM_GRACE_MS = 10_000;

/** How long a KILLed app gets to disappear. */
const KILL_GRACE_MS = 5_000;

/** How long a reopened app gets to answer its socket: its restore re-runs every seat's `claude`. */
const REOPEN_ANSWER_MS = 5 * 60_000;

/** Between two checks while waiting. */
const STEP_MS = 1_000;

/** What one knock on the socket heard. */
export interface SocketKnock {
  readonly replied: boolean;
  readonly connectRefused: boolean;
  readonly detail: string;
}

/** Why the hung app could not be quit or reopened. */
type RestartError =
  | { readonly code: "SIGNAL_FAILED"; readonly message: string; readonly pid: number }
  | { readonly code: "SURVIVED_KILL"; readonly message: string; readonly pid: number }
  | { readonly code: "OPEN_FAILED"; readonly message: string };

const RestartErrors = {
  openFailed: ({ cause }: { cause: unknown }): RestartError => ({
    code: "OPEN_FAILED",
    message: `open -g -a cmux failed:${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  signalFailed: ({ pid, cause }: { pid: number; cause: unknown }): RestartError => ({
    code: "SIGNAL_FAILED",
    message: `could not signal pid ${String(pid)}: ${String(cause)}`,
    pid,
  }),
  survivedKill: ({ pid }: { pid: number }): RestartError => ({
    code: "SURVIVED_KILL",
    message: `pid ${String(pid)} survived KILL`,
    pid,
  }),
} as const;

/** A failed connect's errno code (`ECONNREFUSED`, `ENOENT`), or its message when it carries none. */
function errnoName({ error }: { error: NodeJS.ErrnoException }): string {
  if (error.code !== undefined) {
    return error.code;
  }
  return error.message;
}

/** Wait. */
async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The listing's raw text, by `/bin/ps` under the C locale, so `lstart` prints as `./appProcess.ts` parses it. */
function psListing(): Result<string, string> {
  try {
    return ok(
      execFileSync("/bin/ps", ["-ax", "-o", "pid=,ppid=,lstart=,comm="], {
        encoding: "utf8",
        env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }),
    );
  } catch (error: unknown) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Every process, skipping a line that is not a row.
 *
 * @returns the rows, or why `ps` gave none
 */
export function listProcesses(): Result<readonly PsRow[], string> {
  return psListing().map((text) => parsePsRows({ text }));
}

/**
 * Every process, read whole: a line that is not a row fails the read (`parsePsRowsStrict`).
 *
 * @returns the rows, or why `ps` gave none or a line would not read
 */
export function listProcessesStrict(): Result<readonly PsRow[], string> {
  return psListing().andThen((text) => parsePsRowsStrict({ text }));
}

/**
 * The control socket this machine's cmux listens on.
 *
 * @returns its path
 */
export function cmuxSocketPath(): string {
  return resolveCmuxSocketPath({ sources: productionSocketPathSources() });
}

/**
 * Knock on the control socket once: connect, write one frame, and wait for any byte or an orderly close.
 *
 * @param socketPath the socket to knock on — {@link cmuxSocketPath} in production
 * @param timeoutMs how long to wait for it
 * @returns what was heard
 */
export async function knockOnSocket({
  socketPath,
  timeoutMs,
}: {
  socketPath: string;
  timeoutMs: number;
}): Promise<SocketKnock> {
  return new Promise((resolve) => {
    let connected = false;
    let settled = false;
    const socket = createConnection({ path: socketPath });
    const finish = ({ knock }: { knock: SocketKnock }): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(knock);
    };
    const timer = setTimeout(() => {
      finish({
        knock: {
          connectRefused: false,
          detail: `no reply within ${String(timeoutMs)}ms on ${socketPath}`,
          replied: false,
        },
      });
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      connected = true;
      socket.write(encodeRequest({ id: "revive-1", method: "system.identify", params: {} }));
    });
    socket.on("data", (chunk: string) => {
      finish({ knock: { connectRefused: false, detail: chunk.trim().slice(0, 160), replied: true } });
    });
    socket.on("close", () => {
      finish({ knock: { connectRefused: !connected, detail: "the app closed the connection", replied: connected } });
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        knock: { connectRefused: !connected, detail: `${errnoName({ error })} on ${socketPath}`, replied: false },
      });
    });
  });
}

/** Whether a pid still runs. */
function alive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}

/** Wait up to `ms` for a pid to be gone; whether it went. */
async function gone({ pid, ms }: { pid: number; ms: number }): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive({ pid })) {
    if (Date.now() >= deadline) {
      return false;
    }
    await pause({ ms: STEP_MS });
  }
  return true;
}

/**
 * `open -g -a cmux`, bounded. It returns once Launch Services has the app starting, not once it answers. `-g` keeps
 * the reopened app behind whatever the owner is reading: a revive is an automatic recovery, and the desktop app's own
 * automatic launch pulled cmux over a pull request the owner was reading (`desktop/src/fleetProcess.ts`).
 */
function openApp(): Result<void, RestartError> {
  try {
    execFileSync("open", ["-g", "-a", "cmux"], { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
    return ok(undefined);
  } catch (error: unknown) {
    return err(RestartErrors.openFailed({ cause: error }));
  }
}

/** How a restart ended. */
export interface RestartEnd {
  readonly outcome: "answering" | "not-answering" | "failed";
  readonly newAppPid: number | null;
  readonly detail: string;
}

/**
 * Quit the hung app — TERM, then KILL if it will not go — reopen it, and wait for its socket to answer.
 *
 * @param appPid the hung app's pid
 * @returns how it ended, with the new app's pid when one is running
 */
export async function restartCmuxApp({ appPid }: { appPid: number }): Promise<RestartEnd> {
  const quit = await quitApp({ appPid });
  if (quit.isErr()) {
    return { detail: quit.error.message, newAppPid: null, outcome: "failed" };
  }
  const opened = openApp();
  if (opened.isErr()) {
    return { detail: `${quit.value}; ${opened.error.message}`, newAppPid: null, outcome: "failed" };
  }
  return waitForAnswer({ how: quit.value });
}

/** TERM the app, KILL it if it will not go, and say how it went — or why it would not. */
async function quitApp({ appPid }: { appPid: number }): Promise<Result<string, RestartError>> {
  try {
    process.kill(appPid, "SIGTERM");
  } catch (error: unknown) {
    if (!isRecord(error) || error["code"] !== "ESRCH") {
      return err(RestartErrors.signalFailed({ cause: error, pid: appPid }));
    }
  }
  if (await gone({ ms: TERM_GRACE_MS, pid: appPid })) {
    return ok("quit on TERM");
  }
  process.kill(appPid, "SIGKILL");
  if (!(await gone({ ms: KILL_GRACE_MS, pid: appPid }))) {
    return err(RestartErrors.survivedKill({ pid: appPid }));
  }
  return ok(`ignored TERM for ${String(TERM_GRACE_MS / 1000)}s, so KILLed`);
}

/** Wait for a reopened app to run and answer its socket, for at most {@link REOPEN_ANSWER_MS}. */
async function waitForAnswer({ how }: { how: string }): Promise<RestartEnd> {
  const startedMs = Date.now();
  let newAppPid: number | null = null;
  while (Date.now() - startedMs < REOPEN_ANSWER_MS) {
    await pause({ ms: STEP_MS * 5 });
    const rows = listProcesses();
    const app = rows.isOk() ? cmuxAppOf({ rows: rows.value }) : undefined;
    newAppPid = app === undefined ? null : app.pid;
    if (app === undefined) {
      continue;
    }
    const knock = await knockOnSocket({ socketPath: cmuxSocketPath(), timeoutMs: PROBE_TIMEOUT_MS });
    if (knock.replied) {
      const seconds = String(Math.round((Date.now() - startedMs) / 1000));
      return {
        detail: `${how}; reopened as pid ${String(app.pid)}, answering after ${seconds}s`,
        newAppPid,
        outcome: "answering",
      };
    }
  }
  return {
    detail: `${how}; reopened but not answering after ${String(REOPEN_ANSWER_MS / 1000)}s`,
    newAppPid,
    outcome: "not-answering",
  };
}
