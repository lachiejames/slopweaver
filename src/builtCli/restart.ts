/**
 * Restart this process on the fresh build, in place: `process.execve` replaces the image and keeps the pid and the
 * three standard descriptors. A console child's parent (`site/lib/spawnVerb.ts`) is holding this pid's pipes and its
 * timeout kill, so the fresh image answers on the same pipes and dies to the same kill — a spawned grandchild would
 * outlive that kill.
 *
 * The entrypoint the restart runs is this process's own `argv[1]`: `dev build` rewrites the built tree in place, so
 * the same path now holds the fresh build. The console marker is CLOSED for the new image, so a source change racing
 * the restart refuses there at once rather than starting a second wait (`./consoleRebuildWait.ts`). Every other
 * variable is kept, `SLOPWEAVER_ALLOW_STALE_BUILD` included.
 *
 * MEASURED on v24.21.0 (`src/cli/commands/talk/courierReexec.ts`): an exec of a missing file ABORTS the
 * process rather than throwing, so what can be checked first is checked first.
 */
import { existsSync } from "node:fs";

import { CONSOLE_CHILD_ENV } from "./consoleRebuildWait.js";

/**
 * The new image's argv: the same Node, the same Node flags, the same entrypoint and verb.
 *
 * @param execPath this Node's own binary
 * @param execArgv the Node flags this process started with
 * @param argv this process's argv — Node, then the entrypoint, then the verb's words
 * @returns the argv to exec, its first entry the binary
 */
export function restartArgv({
  execPath,
  execArgv,
  argv,
}: {
  execPath: string;
  execArgv: readonly string[];
  argv: readonly string[];
}): readonly string[] {
  return [execPath, ...execArgv, ...argv.slice(1)];
}

/**
 * The new image's environment: this one, with the console marker present but EMPTY, which reads as closed.
 *
 * Emptied rather than deleted because a deleted variable can come back: Node's `--env-file`, kept in the execArgv the
 * restart preserves, fills in a variable the environment lacks but never overrides one it carries
 * (`src/__tests__/subprocess/builtCli/restartEnvFile.test.ts` measures exactly that).
 *
 * @param env this process's environment; never mutated
 * @returns the copy
 */
export function restartEnv({ env }: { env: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  return { ...env, [CONSOLE_CHILD_ENV]: "" };
}

/**
 * Exec the fresh build in place of this process. It returns only when the exec cannot be attempted.
 *
 * @param argv this process's argv
 * @param env this process's environment
 * @returns why the restart could not be attempted
 */
export function restartOnFreshBuild({ argv, env }: { argv: readonly string[]; env: NodeJS.ProcessEnv }): string {
  if (process.execve === undefined) {
    return `slopweaver: [stale-build] this Node (${process.version}) has no process.execve, so it cannot restart on the fresh build`;
  }
  const entry = argv[1];
  if (entry === undefined || !existsSync(entry)) {
    return `slopweaver: [stale-build] the fresh build's entrypoint (${String(entry)}) is not there to restart on`;
  }
  return process.execve(
    process.execPath,
    [...restartArgv({ argv, execArgv: process.execArgv, execPath: process.execPath })],
    restartEnv({ env }),
  );
}
