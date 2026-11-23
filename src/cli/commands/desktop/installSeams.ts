/**
 * Every effect `slopweaver desktop install` has on this Mac, behind one injected object, so the install's own
 * logic runs in a unit test over an in-memory Applications folder and this file is the only one that touches
 * the real filesystem, process table or a child program.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { withoutSeatEnv } from "../../../cmux/outsideEnv.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";

/** One program run with an argv array, never a shell string. */
export interface ProgramCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/** What the install does to the machine. Each filesystem effect throws on failure, as `node:fs` does. */
export interface InstallSeams {
  /** Run a program to completion: its stdout, or why it failed. */
  readonly run: (call: ProgramCall) => Result<string, DesktopInstallError>;
  readonly exists: (target: { path: string }) => boolean;
  /** Move a file or folder; throws when it cannot. */
  readonly move: (paths: { from: string; to: string }) => void;
  /** Delete a file or folder and everything in it; nothing to delete is not a failure. */
  readonly remove: (target: { path: string }) => void;
  /** A folder's entries, each with its modification time. */
  readonly entries: (folder: { path: string }) => readonly { name: string; mtimeMs: number }[];
  /**
   * A folder's entry names alone, never stat'd: a call lease's heartbeat renames a temporary file in beside it every
   * 15s, so a stat of each name could fail on one renamed away between the listing and the stat.
   */
  readonly names: (folder: { path: string }) => readonly string[];
  readonly readText: (target: { path: string }) => string;
  /** Replace a small text file whole, atomically; throws when it cannot. */
  readonly writeText: (target: { path: string; text: string }) => void;
  /** A fresh, empty temporary folder. */
  readonly tempFolder: () => string;
  /** Ask a process to quit (SIGTERM); one already gone is not a failure. */
  readonly quit: (target: { pid: number }) => void;
  readonly pause: (wait: { ms: number }) => Promise<void>;
  readonly out: (print: { line: string }) => void;
  /** The declared main checkout the app is opened on, resolved from the state home. */
  readonly mainCheckout: (from: { home: string }) => Result<string, DesktopInstallError>;
  /** The checkout this verb is running from, whose `desktop/` is built. */
  readonly runningRoot: () => string;
  /** A value unique to this run, naming its hidden folders. */
  readonly nonce: string;
  /** The clock, epoch milliseconds, for judging a voice call's lease. */
  readonly nowMs: () => number;
}

/**
 * Run one program, reporting a non-zero exit with the last lines it printed. None of them needs the seat running this
 * verb, and `open` hands the app it launches this environment, so no seat's cmux, session or plan key reaches any of
 * them (`cmux/outsideEnv.ts`).
 */
function runProgram({ command, args, cwd }: ProgramCall): Result<string, DesktopInstallError> {
  const shown = [command, ...args].join(" ");
  const env = withoutSeatEnv({ env: process.env });
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024 });
  if (result.error !== undefined) {
    return err(DesktopInstallErrors.stepFailed({ command: shown, detail: result.error.message }));
  }
  if (result.status !== 0) {
    const tail = `${result.stdout}${result.stderr}`.trim().split("\n").slice(-5).join(" | ");
    const exit = `exit ${String(result.status)}`;
    const detail = tail === "" ? exit : `${tail} (${exit})`;
    return err(DesktopInstallErrors.stepFailed({ command: shown, detail }));
  }
  return ok(result.stdout);
}

/**
 * The seams over this Mac: `node:fs`, `spawnSync`, `process.kill` and the real clock.
 *
 * @returns the seams the verb runs on
 */
export function machineSeams(): InstallSeams {
  return {
    entries: ({ path }) => readdirSync(path).map((name) => ({ mtimeMs: statSync(join(path, name)).mtimeMs, name })),
    exists: ({ path }) => existsSync(path),
    mainCheckout: ({ home }) =>
      checkoutForRunningRepo({ home, verb: "desktop install" }).mapErr((problems) =>
        DesktopInstallErrors.checkoutUnresolved({ detail: problems.join("; ") }),
      ),
    // A bundle is a folder, so it moves by rename rather than through `writeFileAtomic`, which writes one file.
    // A crash that leaves a moved bundle unflushed is covered by the backup the next install restores.
    move: ({ from, to }) => {
      renameSync(from, to);
    },
    names: ({ path }) => readdirSync(path),
    nonce: String(process.pid),
    nowMs: () => Date.now(),
    out: ({ line }) => {
      logger.out({ line });
    },
    pause: async ({ ms }) => {
      await new Promise((settle) => setTimeout(settle, ms));
    },
    quit: ({ pid }) => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Gone between the read and the signal, which is the outcome being asked for.
      }
    },
    readText: ({ path }) => readFileSync(path, "utf8"),
    remove: ({ path }) => {
      rmSync(path, { force: true, recursive: true });
    },
    run: runProgram,
    runningRoot: runningCheckoutRoot,
    tempFolder: () => mkdtempSync(join(tmpdir(), "slopweaver-desktop-")),
    writeText: ({ path, text }) => {
      writeFileAtomic({ contents: text, path });
    },
  };
}
