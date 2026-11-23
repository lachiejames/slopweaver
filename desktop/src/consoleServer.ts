/**
 * Bring the console up through the script that already owns it, `scripts/docs-site.sh`, and check it answers.
 * The shell never starts a second server and never stops one: the script's run record says what is serving,
 * `--serve` brings the owner's production console back (rebuilding when it is down), and quitting the shell leaves it
 * running for the browser. Effectful; the parsing is `consoleEndpoint.ts`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { err, errAsync, ok, type Result, ResultAsync } from "neverthrow";

import { childEnv, parseConsoleEndpoint } from "./consoleEndpoint";
import { type CheckoutError, CheckoutErrors, type ConsoleError, ConsoleErrors } from "./errors";

/** The most output kept from one script run; the tail is where it says what went wrong. */
const OUTPUT_CAP = 64 * 1024;

/** `--status` reads a record and a pid: seconds, not minutes. */
const STATUS_TIMEOUT_MS = 20_000;

/** `--serve` may build the console before it starts it — measured near 25s, bounded well above. */
const SERVE_TIMEOUT_MS = 300_000;

/**
 * How long a timed-out run has to exit after SIGTERM before it is killed outright and given up on. Without it a
 * script that ignored SIGTERM, or a child still holding its output pipes, kept the run — and the fleet launches that
 * wait on it — pending forever.
 */
const KILL_GRACE_MS = 5_000;

/** A console that has not answered its probe in this long is not answering. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * What the probe asks: a file the server hands out without rendering a page (`site/app/icon.svg`), so the probe
 * reads whether the console answers, never how long a page takes. Asking `/queue` took 3.1 to 4.0s at rest
 * against the 5s bound, and a call's load tipped it over, recovering a console that was serving the owner mid-call
 * (`consoleHealth.ts`). Measured, `/icon.svg` 3 to 89ms on the same server:
 * `SLOPWEAVER_ALLOW_BASH=1 node -e 'const go=async()=>{for(const p of ["/queue","/icon.svg"]){const t=Date.now();const r=await fetch("http://localhost:3000"+p,{redirect:"manual"});await r.arrayBuffer();console.log(p,r.status,Date.now()-t,"ms")}};go()'`
 */
const PROBE_PATH = "/icon.svg";

/**
 * Whether a directory is a Slopweaver checkout the console can be served from.
 *
 * @param path the candidate directory
 * @returns the path, or why it is not one
 */
export function validateCheckout({ path }: { path: string }): Result<string, CheckoutError> {
  if (existsSync(join(path, "scripts", "docs-site.sh")) && existsSync(join(path, "site", "package.json"))) {
    return ok(path);
  }
  return err(CheckoutErrors.invalid({ path }));
}

/**
 * Run `scripts/docs-site.sh <flag>` in the checkout, bounded, under a PATH that carries node and yarn.
 *
 * @param checkout the checkout's root
 * @param flag the script's flag, `--status` or `--serve`
 * @param timeoutMs how long it may run before it is killed
 * @returns everything it printed, or why it failed
 */
function runConsoleScript({
  checkout,
  flag,
  timeoutMs,
}: {
  checkout: string;
  flag: "--status" | "--serve";
  timeoutMs: number;
}): ResultAsync<string, ConsoleError> {
  const command = `docs-site.sh ${flag}`;
  const env = childEnv({ home: homedir(), inherited: process.env });
  return ResultAsync.fromPromise(
    new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve, reject) => {
      const child = spawn("bash", [join("scripts", "docs-site.sh"), flag], {
        cwd: checkout,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let timedOut = false;
      const keep = (chunk: Buffer): void => {
        output = `${output}${chunk.toString("utf8")}`.slice(-OUTPUT_CAP);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      let abandon: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        abandon = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: null, output, timedOut });
        }, KILL_GRACE_MS);
      }, timeoutMs);
      child.on("error", (cause) => {
        clearTimeout(timer);
        clearTimeout(abandon);
        reject(cause);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        clearTimeout(abandon);
        resolve({ code, output, timedOut });
      });
    }),
    (cause) => ConsoleErrors.processFailed({ command, detail: cause instanceof Error ? cause.message : String(cause) }),
  ).andThen(({ code, output, timedOut }) => {
    if (timedOut) {
      return err(ConsoleErrors.processTimeout({ command, seconds: Math.round(timeoutMs / 1000) }));
    }
    if (code !== 0) {
      return err(ConsoleErrors.processFailed({ command, detail: output }));
    }
    return ok(output);
  });
}

/**
 * Whether the console answers its probe ({@link PROBE_PATH}). Any answer under 500 counts: a redirect or a 404 is
 * still a server.
 *
 * @param endpoint the console's origin
 * @returns the origin when it answered
 */
export function probeConsole({ endpoint }: { endpoint: string }): ResultAsync<string, ConsoleError> {
  return ResultAsync.fromPromise(
    fetch(new URL(PROBE_PATH, endpoint), { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
    (cause) => ConsoleErrors.unreachable({ detail: cause instanceof Error ? cause.message : String(cause), endpoint }),
  ).andThen((response) => {
    if (response.status >= 500) {
      return err(ConsoleErrors.unreachable({ detail: `HTTP ${String(response.status)}`, endpoint }));
    }
    return ok(endpoint);
  });
}

/**
 * The console as the script records it, if it is serving and answers. Starts nothing.
 *
 * @param checkout the checkout's root
 * @returns the origin, or why it is not serving
 */
export function readConsole({ checkout }: { checkout: string }): ResultAsync<string, ConsoleError> {
  return runConsoleScript({ checkout, flag: "--status", timeoutMs: STATUS_TIMEOUT_MS })
    .andThen((output) => parseConsoleEndpoint({ output }))
    .andThen((endpoint) => probeConsole({ endpoint }));
}

/**
 * The console, brought back when it is not serving: read it, and only when that fails run `--serve` once and
 * read it again. One attempt — a second failure is the owner's to see, never a loop.
 *
 * @param checkout the checkout's root
 * @returns the origin, or why the recovery failed
 */
export function ensureConsole({ checkout }: { checkout: string }): ResultAsync<string, ConsoleError> {
  return readConsole({ checkout }).orElse(() =>
    runConsoleScript({ checkout, flag: "--serve", timeoutMs: SERVE_TIMEOUT_MS }).andThen(() =>
      readConsole({ checkout }),
    ),
  );
}

/**
 * Refuse at once when there is no checkout, so the menu bar says so rather than spinning.
 *
 * @param checkout the checkout, when one is known
 * @param start whether a console that is not serving is started; a test instance (`./e2eMode.ts`) only reads one
 * @returns the console, or the checkout problem as a console failure
 */
export function ensureConsoleIn({
  checkout,
  start,
}: {
  checkout: Result<string, CheckoutError>;
  start: boolean;
}): ResultAsync<string, ConsoleError | CheckoutError> {
  if (checkout.isErr()) {
    return errAsync(checkout.error);
  }
  return start ? ensureConsole({ checkout: checkout.value }) : readConsole({ checkout: checkout.value });
}
