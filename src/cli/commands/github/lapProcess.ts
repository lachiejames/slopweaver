/**
 * How `slopweaver github lap` runs its OWN short commands — git, docker, the `slopweaver` verbs it lands
 * through — as opposed to a lane, whose environment `lapCore.ts`'s `lapEnvironment` decides and passes whole.
 *
 * Those commands start from the seat's environment less every `GIT_*` variable (a hook-exported `GIT_DIR`
 * overrides an explicit `cwd`; `gitAncestry.ts` records the incident) and every `SLOPWEAVER_ALLOW_*` hatch,
 * which a landing never inherits.
 */

import { execFileSync } from "node:child_process";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type LapError, LapErrors } from "./lapErrors.js";

/** How long a git fetch or worktree change may take before it is killed — a network fetch, so longer than a read. */
const LAP_COMMAND_TIMEOUT_MS = 5 * 60_000;

/**
 * The environment the lap's own commands start from: the seat's, less git's variables and every open hatch.
 *
 * @param env the seat's environment
 * @returns a fresh copy, safe to hand a child
 */
export function lapOwnEnv({ env }: { env: NodeJS.ProcessEnv }): Record<string, string> {
  const base = stripGitEnv({ env });
  for (const key of Object.keys(base)) {
    if (key.startsWith("SLOPWEAVER_ALLOW_")) {
      delete base[key];
    }
  }
  return base;
}

/** The most a plan-source read may print: one source file's blob, far past any of them. */
const LAP_READ_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Run one short read without a shell, killed at its timeout, answering its stdout UNTRIMMED as bytes: a blob
 * compared byte for byte, or a path whose trailing whitespace is part of the name, must reach the caller exact.
 *
 * @param file the program
 * @param args its arguments
 * @param cwd the directory it runs in
 * @returns its exact stdout, or the command and why it failed
 */
export function runLapRead({
  file,
  args,
  cwd,
}: {
  file: string;
  args: readonly string[];
  cwd: string;
}): Result<Buffer, LapError> {
  try {
    return ok(
      execFileSync(file, args, {
        cwd,
        env: lapOwnEnv({ env: process.env }),
        killSignal: "SIGKILL",
        maxBuffer: LAP_READ_MAX_BYTES,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: LAP_COMMAND_TIMEOUT_MS,
      }),
    );
  } catch (error: unknown) {
    return err(
      LapErrors.commandFailed({
        cause: error instanceof Error ? error.message : String(error),
        command: `${file} ${args.join(" ")}`,
      }),
    );
  }
}

/**
 * Run one short command without a shell, killed at its timeout.
 *
 * @param file the program
 * @param args its arguments
 * @param cwd the directory it runs in
 * @returns its trimmed stdout, or the command and why it failed
 */
export function runLapCommand({
  file,
  args,
  cwd,
}: {
  file: string;
  args: readonly string[];
  cwd: string;
}): Result<string, LapError> {
  return runLapRead({ args, cwd, file }).map((stdout) => stdout.toString("utf8").trim());
}
