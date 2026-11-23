/**
 * `cmux spawn`'s `worktree create` pass-throughs — the parse, and the shape both `run.ts`'s spawn target and
 * `cmux/spawnDeps.ts` carry.
 *
 * Its own file rather than four more lines in `run.ts`, for the reason the file-size gate exists: `run.ts` is
 * the verb's decision tree and this is a leaf parse with no part in it.
 */
import { logger } from "../../../lib/logger.js";
import type { DepsMode } from "../../../worktree/deps.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { depsMode as spawnDepsMode, switchPair } from "../worktree/core.js";

/**
 * What `cmux spawn` passes through to `worktree/provision.ts` — named because both the parse and the spawn
 * target carry it, and a four-boolean shape restated twice is a field waiting to disagree with itself.
 */
export interface SpawnWorktreeOptions {
  readonly install: boolean;
  readonly deps: DepsMode;
  readonly build: boolean;
  readonly devBuild: boolean;
}

/**
 * `cmux spawn`'s four `worktree create` pass-throughs, validated.
 *
 * Their defaults are the verb's own (`worktree/provision.ts`'s `defaultRequest`) rather than a second copy:
 * install on, a per-worktree tree, no tsc build, and the built CLI emitted. A `--deps` value naming neither
 * mode is a usage error here, not a silent fall back to the default — a caller who typed a mode meant one.
 *
 * `--dev-build` resolves through the SAME {@link switchPair} `worktree create` uses, so the one option both
 * front doors gained together is spelled identically at both of them and `--dev-build --no-dev-build`
 * contradicts rather than picking a winner. It was `--no-dev-build`-only for one commit, matching this verb's
 * older habit of carrying just the flag that changes a default, and a Codex review pass caught the two doors
 * disagreeing about a flag they had been given in the same change.
 *
 * @param parsed the verb's parsed flags
 * @returns the options, or the exit code to stop on
 */
export function spawnWorktreeOptions({ parsed }: { parsed: ParsedFlags }): SpawnWorktreeOptions | number {
  const mode = spawnDepsMode({ parsed });
  if (mode.isErr()) {
    logger.error({ msg: `cmux spawn: ${mode.error.join("; ")}` });
    return EXIT_USAGE;
  }
  const devBuild = switchPair({ fallback: true, name: "dev-build", parsed });
  if (devBuild.isErr()) {
    logger.error({ msg: `cmux spawn: ${devBuild.error.join("; ")}` });
    return EXIT_USAGE;
  }
  return {
    build: parsed.values["build"] === true,
    deps: mode.value,
    devBuild: devBuild.value,
    install: parsed.values["no-install"] !== true,
  };
}
