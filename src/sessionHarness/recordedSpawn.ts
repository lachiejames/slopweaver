/**
 * Launching visible cmux sessions through the seam: the production spawn deps over a connection opened HERE (and,
 * for an app-hosted spawn, deps that open none), and one session opened from a plan with its ledger row written by
 * the seam's recorder.
 *
 * `src/sessionHarness/` is the only tree that opens a cmux connection (`./cmuxHost.ts`; the
 * `session-harness-lifecycle` gate). What the deps do is `../cmux/spawnDeps.ts`'s; this file owns only where the
 * socket comes from. Unlike `./cmuxHost.ts`'s `withCmuxSessionHost`, the deps outlive a body: a launch holds the
 * connection and the event witness across a boot that polls, and the caller closes both through `SpawnDeps.close`.
 *
 * Both drawdown investigations (Claude spend and Codex spend) open their session through
 * {@link openRecordedCmuxSession}, so neither can come up without a `spawned` row the session board and
 * `closeDispatchedSession` read.
 */
import type { Result } from "#lib/result.js";
import { realCmuxClient } from "../cmux/client.js";
import type { VisibleSessionPlan } from "../cmux/plan.js";
import type { SpawnDeps } from "../cmux/spawn.js";
import {
  type AppSpawnDeps,
  type ProductionSpawnOptions,
  productionAppSpawnDeps,
  productionSpawnDepsOver,
} from "../cmux/spawnDeps.js";
import { cmuxSessionLauncherOver, launchSpecFromPlan, spawnFailureFromLaunch } from "./cmuxLaunch.js";
import type { HarnessName } from "./harnessChoice.js";
import { recordingSessionLauncher } from "./recordingHarness.js";
import { sessionLedgerDeps } from "./sessionLedger.js";

/**
 * The production spawn deps over a fresh cmux connection. The caller MUST close them.
 *
 * @param options `cmux spawn`'s pass-through flags, each defaulted as the verb defaults it
 * @returns the deps, holding the connection their `close` releases
 */
export function productionSpawnDeps(options: ProductionSpawnOptions = {}): SpawnDeps {
  return productionSpawnDepsOver({ ...options, client: realCmuxClient() });
}

/**
 * One spawn's deps, tagged with the harness they are for. Only the cmux arm holds a connection, so only the cmux
 * arm has anything to close, and an app-hosted spawn's code cannot read a cmux member it was never given.
 */
export type HarnessSpawnDeps =
  { readonly harness: "cmux"; readonly deps: SpawnDeps } | { readonly harness: "app"; readonly deps: AppSpawnDeps };

/**
 * Pick one spawn's deps by harness, calling ONLY that harness's opener, so an app spawn never opens cmux.
 *
 * @param harness where the session opens
 * @param options `cmux spawn`'s pass-through flags, handed to whichever opener runs
 * @param openCmux builds a cmux-hosted spawn's deps, connection included
 * @param openApp builds an app-hosted spawn's deps, which hold no handle
 * @returns the deps tagged with their harness
 */
export function harnessSpawnDepsOver({
  harness,
  options,
  openCmux,
  openApp,
}: {
  harness: HarnessName;
  options: ProductionSpawnOptions;
  openCmux: (options: ProductionSpawnOptions) => SpawnDeps;
  openApp: (options: ProductionSpawnOptions) => AppSpawnDeps;
}): HarnessSpawnDeps {
  switch (harness) {
    case "app":
      return { deps: openApp(options), harness };
    case "cmux":
      return { deps: openCmux(options), harness };
    default: {
      const unhandled: never = harness;
      throw new Error(`no spawn deps for harness ${String(unhandled)}`);
    }
  }
}

/**
 * Release whatever one spawn's deps hold: the cmux arm's connection and event witness; the app arm holds nothing.
 * Exhaustive over the union, so a harness added later fails to compile here rather than silently skipping a close.
 *
 * @param harnessDeps the deps the spawn ran on
 */
export function closeHarnessSpawnDeps({ harnessDeps }: { harnessDeps: HarnessSpawnDeps }): void {
  switch (harnessDeps.harness) {
    case "app":
      return;
    case "cmux":
      harnessDeps.deps.close();
      return;
    default: {
      const unhandled: never = harnessDeps;
      throw new Error(`no close for harness deps ${String(unhandled)}`);
    }
  }
}

/**
 * The production deps one spawn runs on, for its harness: a fresh cmux connection only when cmux hosts it. The caller
 * MUST close the cmux arm's deps.
 *
 * @param harness where the session opens
 * @param options `cmux spawn`'s pass-through flags, each defaulted as the verb defaults it
 * @returns the deps tagged with their harness
 */
export function productionHarnessSpawnDeps({
  harness,
  options,
}: {
  harness: HarnessName;
  options: ProductionSpawnOptions;
}): HarnessSpawnDeps {
  return harnessSpawnDepsOver({ harness, openApp: productionAppSpawnDeps, openCmux: productionSpawnDeps, options });
}

/**
 * Open the session one plan describes through the recording cmux launcher.
 *
 * @param deps the spawn dependencies to launch over; the caller closes them
 * @param plan the session to open, whose workspace name is its ledger key
 * @param home the state home the row is written under; omitted, the ambient one
 * @returns the workspace it came up in, or the failure reason with the workspace that may still be standing
 */
export async function openRecordedCmuxSession({
  deps,
  plan,
  home,
}: {
  deps: SpawnDeps;
  plan: VisibleSessionPlan;
  home?: string;
}): Promise<Result<{ workspaceRef: string }, { reason: string; workspaceRef: string }>> {
  const launcher = recordingSessionLauncher({
    implementation: "cmux",
    launcher: cmuxSessionLauncherOver({ deps }),
    ledger: sessionLedgerDeps({ home }),
  });
  const launched = await launcher.open({ spec: launchSpecFromPlan({ ledgerKey: plan.workspaceName, plan }) });
  // Back through cmux's own failure shape, which names the empty ref when the launch left no workspace.
  return launched
    .map(({ handle }) => ({ workspaceRef: handle }))
    .mapErr((failure) => {
      const { reason, workspaceRef } = spawnFailureFromLaunch({ failure });
      return { reason, workspaceRef };
    });
}
