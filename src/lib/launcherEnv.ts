/**
 * The environment to hand a child process that may launch `slopweaver` again.
 *
 * `bin/slopweaver` prints advisories to stderr BEFORE it runs the verb — a cross-worktree warning, a
 * `[foreign-cli]` override notice, a one-time worktree dependency install. Each is a note for a human at a
 * terminal, and each precedes a SUCCESSFUL run, so none of them changes an exit code.
 *
 * MEASURED, and it is the reason this module exists rather than a comment somewhere. A
 * `command:` probe on one run read
 * `cd <main checkout> && ./bin/slopweaver codex watch --once --dry-run 2>&1 | head -1 | grep -qE '<verdict>'`.
 * Run from a session standing in a WORKTREE, that child launcher resolved the worktree's code from the
 * `PLUGIN_ROOT` its slopweaver PARENT exports while standing in the main checkout, saw two different
 * worktrees of one repo, and printed the cross-worktree warning — which `2>&1` merged and `head -1` then
 * took INSTEAD of the verdict line. The probe exited 1. Every hand re-run passed, because a plain shell
 * exports no `PLUGIN_ROOT` and so triggers no warning at all. Reproduce both halves in one command, from
 * any worktree of this repo:
 *
 * ```bash
 * (cd <main> && ./bin/slopweaver codex watch --once --dry-run 2>&1 | head -1)
 * (export PLUGIN_ROOT="$PWD"; cd <main> && ./bin/slopweaver codex watch --once --dry-run 2>&1 | head -1)
 * ```
 *
 * **Silencing the advisory is the fix; scrubbing `PLUGIN_ROOT` is NOT.** Stripping the launcher's code-root
 * variables was the first shape of this and a review pass refuted it: `resolve_plugin_root` PREFERS an
 * inherited root, and the `slopweaver` on `PATH` is a symlink into the plugin mirror, so a probe written as
 * a bare `slopweaver <verb>` — 33 of them stood on this board when this was measured — would have stopped
 * testing the session's own branch and started testing the mirror, silently and in the green direction. A
 * quiet marker changes which LINES are printed and nothing at all about which code runs.
 *
 * A hard launcher failure is never suppressed: those exit non-zero, which a probe already reads correctly.
 *
 * **The console is the second caller.** `site/lib/spawnVerb.ts` sets the same marker on every verb it launches,
 * through `site/lib/launcherQuiet.ts` — a restated copy of {@link withQuietLauncher}, because `site/` never
 * imports `src/` — so a tile's stderr tail is the verb's own and the stale-seat check's git work is skipped.
 */

import { gitEnv } from "#lib/gitRepo.js";

/**
 * The marker `bin/slopweaver`'s `advise` helper reads, and `src/cli/staleSeat.ts`'s `ADVISORY_QUIET_ENV` with it.
 * Kept in step with both deliberately, and with `site/lib/launcherQuiet.ts`'s restated copy — a rename on one
 * side with no rename on the others silently restores the defect above.
 */
export const LAUNCHER_QUIET_VAR = "SLOPWEAVER_LAUNCHER_QUIET";

/**
 * The one-shot marker telling `bin/slopweaver` to start the source as tsx's CHILD tier — `node --require
 * <tsx>/dist/preflight.cjs --import <loader url>` — rather than through a new tsx CLI wrapper. A process already
 * under a wrapper that `execve`s the launcher (the courier's re-exec, `src/cli/commands/talk/courierReexec.ts`)
 * would otherwise turn its own pid into a second wrapper and leave the first one waiting on it forever. Only exactly
 * `1` counts, and the launcher unsets it before anything else runs, so no descendant inherits it.
 */
export const LAUNCHER_NO_TSX_WRAPPER_VAR = "SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER";

/**
 * A copy of one environment carrying the launcher-quiet marker.
 *
 * Pure, and separate from {@link quietLauncherEnv} so the marker can be asserted on an input a test states
 * in full rather than on whatever the test runner happened to inherit.
 *
 * @param env the environment to copy
 * @returns the copy, with the marker set
 */
export function withQuietLauncher({ env }: { env: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  return { ...env, [LAUNCHER_QUIET_VAR]: "1" };
}

/**
 * The environment for a child whose OUTPUT is being read, and which may invoke `bin/slopweaver` itself.
 *
 * @returns this process's environment with git's redirect variables scrubbed by {@link gitEnv} and the
 *   launcher-quiet marker set on top
 */
export function quietLauncherEnv(): NodeJS.ProcessEnv {
  return withQuietLauncher({ env: gitEnv() });
}
