/**
 * Whether a checkout may serve the console, or a desktop walk may read it, given where its built CLI stands — the
 * pure half. The read is `./servingCheckoutRead.ts`.
 *
 * MEASURED: a worktree's dev console answered every page in about 30 s and drew "Organisation required".
 * Its server log read `GET /queue 200 in 31.2s (next.js: 226ms, application-code: 30.9s)`. Every console page's root
 * layout reads `org show --json` as a console child (`site/lib/placementOrganisationLive.ts`), and against a stale
 * `dist-cli` that child waits `CONSOLE_REBUILD_WAIT_MS` for a rebuild (`./consoleRebuildWait.ts`). On main the
 * post-merge hook starts that rebuild; in a worktree whose head moved under a rebase nothing does, so every page waits
 * out the bound and then refuses. Repro in a built worktree: `touch src/cli/index.ts`, then
 * `SLOPWEAVER_CONSOLE_CHILD=1 SLOPWEAVER_CLI_DIR=$PWD ./bin/slopweaver org show --json` takes 30 s and exits 1.
 *
 * So the dev console starts and a worktree walk refuse a STALE build at once, naming the one command that fixes it,
 * rather than serving pages that each burn the wait. They refuse rather than build: a build beside another seat's
 * test lap is a load decision. Every other standing passes — `unbuilt` runs source, and an `unjudgeable` manifest
 * makes the built launcher refuse at once, so neither costs the wait.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { BuiltState } from "./builtState.js";

/**
 * Why a checkout's console must not be served or walked.
 *
 * @internal
 */
export interface StaleBuiltCliError {
  readonly code: "STALE_BUILT_CLI";
  readonly message: string;
  readonly checkout: string;
  /** The guard's own sentence naming the first source file that moved since the build. */
  readonly evidence: string;
}

/** The one way a serving checkout is refused. */
export type ServingCheckoutError = StaleBuiltCliError;

/** Build a {@link ServingCheckoutError}. */
export const ServingCheckoutErrors = {
  staleBuiltCli: ({ checkout, evidence }: { checkout: string; evidence: string }): ServingCheckoutError => ({
    checkout,
    code: "STALE_BUILT_CLI",
    evidence,
    message:
      `refusing to serve or walk the console from ${checkout}: its built CLI is stale (${evidence}), so every ` +
      "console page would wait 30s for a rebuild nothing here starts — run `slopweaver dev build` in that checkout",
  }),
} as const;

/**
 * Whether a desktop walk checks the serving checkout's built CLI before it launches: only for a checkout `--checkout`
 * NAMED and git does not confirm as a main worktree. A worktree is where nothing rebuilds a stale `dist-cli`. The main
 * checkout is left alone, named or not: its post-merge hook rebuilds it, and refusing there would refuse a rebuild that
 * is already in flight.
 *
 * @param checkoutWasNamed whether `--checkout` named the checkout rather than the declared main one being resolved
 * @param mainWorktree whether git confirms the checkout is a main worktree
 * @returns true when the walk must check the built CLI first
 */
export function walkChecksServingBuild({
  checkoutWasNamed,
  mainWorktree,
}: {
  checkoutWasNamed: boolean;
  mainWorktree: boolean;
}): boolean {
  return checkoutWasNamed && !mainWorktree;
}

/**
 * Judge whether a checkout's console may be served or walked, from where its built CLI stands.
 *
 * @param checkout the checkout whose console it is, named in the refusal
 * @param state its built CLI's standing, as `readBuiltState` read it
 * @returns ok for every standing but `stale`, which is the refusal naming `slopweaver dev build`
 */
export function judgeServingCheckoutBuild({
  checkout,
  state,
}: {
  checkout: string;
  state: BuiltState;
}): Result<void, ServingCheckoutError> {
  if (state.kind === "stale") {
    return err(ServingCheckoutErrors.staleBuiltCli({ checkout, evidence: state.evidence }));
  }
  return ok(undefined);
}
