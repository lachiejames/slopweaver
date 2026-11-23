/**
 * How the lap runs a nested `slopweaver` verb — the hold, the merge and the release — under one ceiling, and what
 * it reports when that ceiling kills one. Apart from `./lapShell.ts` because a verb is not a lane: it inherits the
 * seat's terminal, and its exit decides whether a pull request landed.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { logger } from "../../../lib/logger.js";
import { bundledLauncherPath } from "../../../lib/pluginRoot.js";
import { LAP_STEP_TIMEOUT_EXIT } from "./lapCore.js";
import { lapOwnEnv } from "./lapProcess.js";

/**
 * How long a `slopweaver` verb the lap runs may take: a merge's own measurement and a hold, never a lane. The
 * merge walks one `git log` per modified path, twice. MEASURED: one walk for a pull request modifying 1335 paths
 * took about 442s (about 0.33s a path at that load), and both its landings were killed at the old 10 minutes; the
 * largest batch member then modified 1536, about 17 minutes for two walks at that rate. 45 minutes leaves load
 * room above that and matches `LAP_STEP_CEILING_MS` in `./lapCore.ts`. Repro of a member's path count:
 * `git diff --name-only --diff-filter=M <base>...<head> | wc -l`.
 */
const LAP_VERB_TIMEOUT_MS = 45 * 60_000;

/**
 * A finished verb's exit, and the line the lap owes when it killed the verb: the step ceiling's own exit
 * ({@link LAP_STEP_TIMEOUT_EXIT}) when the ceiling killed it, 127 only when it never started, 1 when a signal ended
 * it, else its own code.
 *
 * @param run the verb's spawn result, read for its error and status only
 * @param verb the verb's words, named in the line
 * @param ceilingMs the ceiling it ran under, named in the line in minutes
 * @returns the exit code, and the diagnostic line when the ceiling killed the verb
 */
export function verbExit({
  run,
  verb,
  ceilingMs,
}: {
  run: Pick<SpawnSyncReturns<Buffer>, "error" | "status">;
  verb: string;
  ceilingMs: number;
}): { readonly exitCode: number; readonly line: string | undefined } {
  if (run.error === undefined) {
    if (run.status === null) {
      return { exitCode: 1, line: undefined };
    }
    return { exitCode: run.status, line: undefined };
  }
  const timedOut = "code" in run.error && run.error.code === "ETIMEDOUT";
  if (!timedOut) {
    return { exitCode: 127, line: undefined };
  }
  const minutes = String(Math.round(ceilingMs / 60_000));
  return {
    exitCode: LAP_STEP_TIMEOUT_EXIT,
    line: `github lap: \`slopweaver ${verb}\` was killed at the lap's ${minutes}-minute verb ceiling before it finished — whether it acted first is unknown, so read the pull request before running it again`,
  };
}

/**
 * Run one `slopweaver` verb through this build's own launcher, with `input` as its stdin, under the verb ceiling.
 *
 * @param args the verb's argv, its first two words naming it in a ceiling line
 * @param input written to the verb's stdin, such as a pull request's body
 * @returns the verb's exit code as {@link verbExit} maps it
 */
export async function runLapVerb({ args, input }: { args: readonly string[]; input: string }): Promise<number> {
  const run = spawnSync(bundledLauncherPath({ importMetaUrl: import.meta.url }), args, {
    env: lapOwnEnv({ env: process.env }),
    input,
    killSignal: "SIGKILL",
    stdio: ["pipe", "inherit", "inherit"],
    timeout: LAP_VERB_TIMEOUT_MS,
  });
  const exit = verbExit({ ceilingMs: LAP_VERB_TIMEOUT_MS, run, verb: args.slice(0, 2).join(" ") });
  if (exit.line !== undefined) {
    logger.warn({ msg: exit.line });
  }
  return exit.exitCode;
}
