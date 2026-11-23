/**
 * The EFFECTFUL half of a Codex Connect: run `./loginProgram.ts` over one store, blocking until the sign-in ends,
 * and hand back what it printed for `./loginExchangeParse.ts` to decide.
 *
 * One `spawnSync` of `/usr/bin/tclsh` — the shape `./accountLive.ts` already uses, and why is written there. It
 * blocks for as long as a person takes in the browser, so only the backgrounded Connect worker calls it, never the
 * console's request. No model turn runs: the app-server is asked to sign in, and the credential it mints lands in
 * the store's own `auth.json`, which nothing here reads.
 *
 * The binary resolves through `./accountLive.ts`'s {@link resolveAppServerExecutable}, so every test lane's
 * `SLOPWEAVER_CODEX_APP_SERVER` (a path that does not exist, or a fake a subprocess test writes) decides it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchFlags, resolveAppServerExecutable } from "./accountLive.js";
import { codexClientEnvironment } from "./client.js";
import { CODEX_SIGN_IN_PREFIX, codexLoginRequests } from "./loginExchangeParse.js";
import { LOGIN_PROGRAM } from "./loginProgram.js";

/** Bytes the app-server may write over a whole sign-in before it is cut off — every answer is a few hundred. */
const BYTE_CAP = 256 * 1024;
/** How far past the program's own deadline the outer kill lands: the program ends itself first. */
const OUTER_MARGIN_MS = 30_000;

/** What one sign-in printed, or why it could not run at all. */
export type CodexLoginRun =
  | { readonly kind: "ran"; readonly lines: readonly string[] }
  | { readonly kind: "cli-missing"; readonly reason: string }
  | { readonly kind: "not-run"; readonly reason: string };

/** The environment the login program runs under: the store's own Codex client environment and the requests it sends. */
function loginEnvironment({ codexHome }: { codexHome: string }): NodeJS.ProcessEnv {
  const requests = codexLoginRequests();
  return {
    ...codexClientEnvironment({ codexHome, env: process.env }),
    SLOPWEAVER_CODEX_LOGIN_ACCOUNT: requests.account,
    SLOPWEAVER_CODEX_LOGIN_CANCEL: requests.cancelTemplate,
    SLOPWEAVER_CODEX_LOGIN_START: requests.start.join("\n"),
    SLOPWEAVER_CODEX_LOGIN_URL_PREFIX: CODEX_SIGN_IN_PREFIX,
  };
}

/**
 * Hold one store's app-server through a ChatGPT sign-in.
 *
 * @param codexHome the store the sign-in lands in, which must exist
 * @param cancelPath the marker whose appearance cancels the sign-in
 * @param signInUrlPath where the program writes the sign-in page once it has one
 * @param deadlineMs how long a person has to finish
 * @param opener the absolute path of the program that opens the page, run with the page as its one argument
 * @returns the program's lines, or why it never ran
 */
export function runCodexLoginExchange({
  cancelPath,
  codexHome,
  deadlineMs,
  opener,
  signInUrlPath,
}: {
  cancelPath: string;
  codexHome: string;
  deadlineMs: number;
  opener: string;
  signInUrlPath: string;
}): CodexLoginRun {
  const executable = resolveAppServerExecutable({ env: process.env });
  if ("reason" in executable) {
    return { kind: "cli-missing", reason: executable.reason };
  }
  if (!existsSync(executable.path)) {
    return { kind: "cli-missing", reason: `the Codex CLI is not at ${executable.path}` };
  }
  const dir = mkdtempSync(join(tmpdir(), "sw-codex-login-"));
  try {
    const programPath = join(dir, "login.tcl");
    writeFileSync(programPath, LOGIN_PROGRAM, { mode: 0o600 });
    const run = spawnSync(
      // By absolute path: a `tclsh` found on PATH would run in place of the program that holds the page-prefix
      // check and the argv-only opener.
      "/usr/bin/tclsh",
      [
        programPath,
        String(deadlineMs),
        cancelPath,
        signInUrlPath,
        String(BYTE_CAP),
        opener,
        "--",
        executable.path,
        ...launchFlags({ scope: "account" }),
      ],
      {
        encoding: "utf8",
        env: loginEnvironment({ codexHome }),
        killSignal: "SIGKILL",
        maxBuffer: BYTE_CAP * 2,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: deadlineMs + OUTER_MARGIN_MS,
      },
    );
    if (run.error !== undefined) {
      return { kind: "not-run", reason: `the sign-in program could not run: ${run.error.message}` };
    }
    return { kind: "ran", lines: run.stdout.split("\n").filter((line) => line !== "") };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}
