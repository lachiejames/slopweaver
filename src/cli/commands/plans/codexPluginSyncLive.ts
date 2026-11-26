/**
 * The one-home Slopweaver install `plans add --provider codex` and the `plans connect` worker run on the home each
 * has just registered — the same fleet core a foreground `codex plugin-sync` runs (`src/codexPlugin/sync.ts`), over
 * exactly that home.
 *
 * This module resolves paths and nothing else. Whether the given checkout may publish (only a declared main checkout
 * does, so a feature worktree's add prints `skipped` and installs nothing), the marketplace seed, the lock, the
 * export, the add, its read-back and the hook-trust pass are all the core's, unchanged.
 */
import { homedir } from "node:os";

import { errorMessage } from "#lib/errorMessage.js";
import { codeCheckoutRoot, runningCheckoutRoot } from "#lib/gitRepo.js";
import { cachePaths } from "../../../cacheHome.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import type { SyncOutcome } from "../../../codexPlugin/plan.js";
import { performFleetSync } from "../../../codexPlugin/sync.js";
import { spawnCodexAdd } from "../../../codexPlugin/syncEffects.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { trustPluginHooks } from "../codex/pluginTrust.js";

/**
 * The checkout a detached `plans connect` worker publishes from: the repository its own code was loaded from.
 *
 * Never its cwd: `launchConnectWorker` (`src/plans/connectLaunch.ts`) starts the worker IN the state home on purpose,
 * so `runningCheckoutRoot()` there answers the state home, which is no declared main checkout, and every install
 * from the console's Connect would print `skipped`. The code's own checkout is the one whose launcher `plans connect`
 * spawned, so it is the checkout that ran the verb — the same one `plans add` publishes from. Only under a
 * marketplace mirror, which carries no `.git`, is there no code checkout, and the cwd answer stands; for the worker
 * that is the state home, never a declared main checkout, so the core skips and says which checkout it read.
 *
 * @param codeRoot the code's own repository root, `undefined` when it sits in none
 * @param cwdRoot the cwd anchor's answer, read only when there is no code root
 * @returns the checkout to hand the fleet core
 */
export function connectWorkerCheckout({
  codeRoot,
  cwdRoot,
}: {
  codeRoot: string | undefined;
  cwdRoot: () => string;
}): string {
  if (codeRoot !== undefined) {
    return codeRoot;
  }
  return cwdRoot();
}

/**
 * The checkout the `plans connect` worker running in this process publishes from.
 *
 * @returns the code's own checkout, else the cwd anchor's answer
 */
export function liveConnectWorkerCheckout(): string {
  return connectWorkerCheckout({ codeRoot: codeCheckoutRoot(), cwdRoot: () => runningCheckoutRoot() });
}

/**
 * Install Slopweaver into one newly registered Codex home, as a foreground sync would.
 *
 * @param checkout the checkout that ran the verb, which publishes only when it is a declared main checkout
 * @param codexHome the `$CODEX_HOME` the register row just published names
 * @param stateHome the Slopweaver home whose profile declares the main checkouts
 * @returns what the run did; a throw becomes a `failed` outcome, never a rejection
 */
export function syncCodexPluginHomeLive({
  checkout,
  codexHome,
  stateHome,
}: {
  checkout: string;
  codexHome: string;
  stateHome: string;
}): SyncOutcome {
  try {
    return performFleetSync({
      deps: { codexAdd: spawnCodexAdd, nowMs: () => Date.now(), trustHooks: trustPluginHooks },
      homes: [{ codexHome, registered: true }],
      mainCheckouts: mainCheckoutsFromProfile({ home: stateHome }).map((config) => config.path),
      paths: { checkout, exportRoot: cachePaths().codexPlugin, userHome: homedir() },
      scope: "install-every-home",
    });
  } catch (error: unknown) {
    return { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: errorMessage({ error }) }) };
  }
}
