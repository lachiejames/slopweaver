/**
 * Which verbs a stale build may hand to the checkout's source, and which keep the stale-build refusal.
 *
 * Almost every verb runs the same from source as from a build — CI and every checkout that never built run nothing
 * else — so a stale build restarts on the source (`./sourceRestart.ts`). The exceptions are the verbs whose own
 * contract treats a BUILT tree as a prerequisite or an execution target: running one from source would change what
 * it installs, serves, waits on or re-executes into, so each refuses exactly as before and `slopweaver dev build`
 * is still the remedy. A module merely MENTIONING `dist-cli` does not put its verb here.
 *
 * - `desktop install` and `desktop update` install the app over a built checkout (`src/cli/commands/desktop/installRun.ts`,
 *   `updateRun.ts`).
 * - `desktop e2e` reads the serving checkout's build (`checkServingCheckoutBuild`, `src/cli/commands/desktop/e2eRun.ts`).
 * - `talk courier` re-executes into main's built tree (`src/cli/commands/talk/courierExecChecks.ts`).
 * - `supervisor tick-capture` and `supervisor tick` gate their child on the selected binary's built tree
 *   (`src/cli/commands/supervisor/scratchBuildGate.ts`).
 *
 * A console child is the other exception, and it is not a verb: `./invocationGuard.ts` waits its rebuild out first.
 */

/** Every noun and verb that keeps the stale-build refusal, as `argv[2]` and `argv[3]` spell them. */
export const BUILT_TREE_VERBS: readonly { readonly noun: string; readonly verb: string }[] = [
  { noun: "desktop", verb: "install" },
  { noun: "desktop", verb: "update" },
  { noun: "desktop", verb: "e2e" },
  { noun: "talk", verb: "courier" },
  { noun: "supervisor", verb: "tick-capture" },
  { noun: "supervisor", verb: "tick" },
];

/**
 * Whether a stale build may restart this invocation on its checkout's source.
 *
 * @param argv the canonical process argv — Node, the entrypoint, then the noun and verb
 * @returns false for a verb that needs the built tree itself
 */
export function sourceFallbackAllowed({ argv }: { argv: readonly string[] }): boolean {
  const noun = argv[2];
  const verb = argv[3];
  return !BUILT_TREE_VERBS.some((entry) => entry.noun === noun && entry.verb === verb);
}
