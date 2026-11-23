/**
 * The environment the console hands every `bin/slopweaver` child: its own, with the launcher-quiet marker set and
 * the launcher pinned to the checkout serving the page ({@link consoleChildEnv}).
 *
 * `bin/slopweaver` prints advisories to stderr BEFORE it runs a verb, and `src/cli/main.ts` adds the stale-seat
 * warning on top — four lines or more, after the git work that measures the drift. Each is a note for a human at a
 * terminal and each precedes a successful run. The console is not that reader, and it pays for them twice:
 *
 * - **Time.** The stale-seat check runs git before the verb does; the marker makes `maybeWarnStaleSeat`
 *   (`src/cli/staleSeatEffects.ts`) return before any of it, on every tile's every read.
 * - **The failure reason.** `spawnVerb` names a non-zero exit by the last three stderr lines, so a verb that
 *   failed with little stderr of its own was reported by the advisory printed before it ran.
 *
 * The marker changes which LINES are printed and nothing about which code runs, the property
 * `src/lib/launcherEnv.ts` records for the other caller — WHICH code runs is the pin's business. It mirrors that module's `withQuietLauncher` rather than
 * importing it: `site/` never imports `src/`, and that module pulls in `#lib/gitRepo.js`. It imports NOTHING, for
 * the reason `./queueFreshness.ts` gives: the unit lane reaches it from a root that resolves modules differently.
 */

/**
 * The marker `bin/slopweaver`'s `advise` helper and `src/cli/staleSeat.ts`'s `ADVISORY_QUIET_ENV` read. Restated
 * rather than imported, and pinned by `site/__tests__/unit/launcherQuiet.test.ts` as `src/`'s copy is by its own
 * test, so a rename on one side fails a test instead of silently restoring the advisory lines.
 */
export const LAUNCHER_QUIET_VAR = "SLOPWEAVER_LAUNCHER_QUIET";

/**
 * A copy of one environment carrying the launcher-quiet marker, whatever value it inherited for it.
 *
 * Generic over the environment's shape rather than typed `NodeJS.ProcessEnv`: the site's Next types make
 * `NODE_ENV` required there, and a test states its input in full rather than inheriting the runner's.
 *
 * @param env the environment to copy; never mutated
 * @returns the copy, with the marker set to `1`
 */
export function withQuietLauncher<E extends Readonly<Record<string, string | undefined>>>({
  env,
}: {
  env: E;
}): E & { readonly [LAUNCHER_QUIET_VAR]: string } {
  return { ...env, [LAUNCHER_QUIET_VAR]: "1" };
}

/**
 * The launcher's EXPLICIT code-root override — `bin/slopweaver` runs `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}`. Restated
 * rather than imported for the reason {@link LAUNCHER_QUIET_VAR} is, and pinned by the same test.
 */
export const CLI_DIR_VAR = "SLOPWEAVER_CLI_DIR";

/**
 * The console-child marker `src/builtCli/consoleRebuildWait.ts` reads as `CONSOLE_CHILD_ENV`. Restated rather than
 * imported for the reason {@link LAUNCHER_QUIET_VAR} is, and pinned by the same test.
 *
 * It selects WAITING, never stale execution. MEASURED: a pull to the main checkout left its built CLI
 * stale until the post-merge `dev build` finished, and in that window every child refused with `[stale-build]` —
 * the root layout's organisation read included, so every console page drew "Organisation required" until the owner
 * reloaded. A marked child that meets that shape waits up to 30 s for the fresh build and restarts on it; past that,
 * it refuses as before. `SLOPWEAVER_ALLOW_STALE_BUILD` is not set here and never will be.
 */
export const CONSOLE_CHILD_VAR = "SLOPWEAVER_CONSOLE_CHILD";

/**
 * The launcher's one-shot marker, `src/lib/launcherEnv.ts`'s `LAUNCHER_NO_TSX_WRAPPER_VAR`, restated for the reason
 * {@link LAUNCHER_QUIET_VAR} is and pinned by the same test. Set, a checkout with no built CLI starts the source as
 * tsx's CHILD tier in the launched pid itself, rather than under a tsx wrapper that forks it.
 *
 * Without it, `spawnVerb`'s SIGKILL at a verb's bound reached only the wrapper, which cannot relay an uncatchable
 * signal, and the verb ran on as an orphan after its reading had been answered "did not answer" (the voice record's 18 s deadline). With it, the pid killed is the verb, built or not. The launcher unsets it before
 * anything runs, so no descendant inherits it. The same-pid start is what
 * `src/__tests__/subprocess/cli/commands/talk/courierReexec.test.ts` proves of the marked launcher.
 */
export const LAUNCHER_NO_TSX_WRAPPER_VAR = "SLOPWEAVER_LAUNCHER_NO_TSX_WRAPPER";

/**
 * The environment a console child runs with: {@link withQuietLauncher}'s, with the launcher pinned to `root` and
 * the console-child marker ({@link CONSOLE_CHILD_VAR}) set.
 *
 * Resolving the serving checkout's `bin/slopweaver` (`./slopweaverBin.ts`) is only half of "the console runs the real
 * verbs from the tree it is served out of": the launcher then runs `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}`, and a
 * `PLUGIN_ROOT` the server inherited from whichever launcher started it outranks the launcher's own tree. MEASURED
 * on the console at :3000, served from the main checkout: every verb ran
 * `.claude/worktrees.noindex/<seat>/bin/../dist-cli`, a supervisor seat's older build,
 * so `handover list --json` printed no `referenceContext` and a draft's issue key stayed words while
 * a bare number beside it linked. The cross-worktree warning that would have said so is an advisory the quiet marker
 * silences. Repro: `ps -A -o command= | grep 'handover list --json'` while the queue page loads.
 *
 * The explicit override rather than a scrubbed `PLUGIN_ROOT`: that variable has launcher and plugin duties of its own
 * (`src/lib/launcherEnv.ts`), while `SLOPWEAVER_CLI_DIR` decides code and nothing else. It is set whatever the server
 * inherited for it, since an inherited one names some other tree just the same.
 *
 * @param env the environment to copy; never mutated
 * @param root the serving checkout — the directory holding the `bin/slopweaver` about to be launched
 * It also starts the source in the launched pid itself ({@link LAUNCHER_NO_TSX_WRAPPER_VAR}), so a child killed at its
 * bound is the verb and not a wrapper over it.
 *
 * @param env the environment to copy; never mutated
 * @param root the serving checkout — the directory holding the `bin/slopweaver` about to be launched
 * @returns the copy, quiet, pinned and marked
 */
export function consoleChildEnv<E extends Readonly<Record<string, string | undefined>>>({
  env,
  root,
}: {
  env: E;
  root: string;
}): E & {
  readonly [LAUNCHER_QUIET_VAR]: string;
  readonly [CLI_DIR_VAR]: string;
  readonly [CONSOLE_CHILD_VAR]: string;
  readonly [LAUNCHER_NO_TSX_WRAPPER_VAR]: string;
} {
  return {
    ...withQuietLauncher({ env }),
    [CLI_DIR_VAR]: root,
    [CONSOLE_CHILD_VAR]: "1",
    [LAUNCHER_NO_TSX_WRAPPER_VAR]: "1",
  };
}
