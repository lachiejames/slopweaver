/**
 * The one-home Slopweaver install `plans add --provider codex` runs on the home it has just registered — the
 * same fleet core a foreground `codex plugin-sync` runs (`src/codexPlugin/sync.ts`), over exactly that home.
 *
 * This module resolves paths and nothing else. Whether this checkout may publish (only a declared main checkout
 * does, so a feature worktree's add prints `skipped` and installs nothing), the marketplace seed, the lock, the
 * export, the add, its read-back and the hook-trust pass are all the core's, unchanged.
 */
import { homedir } from "node:os";

import { errorMessage } from "#lib/errorMessage.js";
import { runningCheckoutRoot } from "#lib/gitRepo.js";
import { cachePaths } from "../../../cacheHome.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import type { SyncOutcome } from "../../../codexPlugin/plan.js";
import { performFleetSync } from "../../../codexPlugin/sync.js";
import { spawnCodexAdd } from "../../../codexPlugin/syncEffects.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { trustPluginHooks } from "../codex/pluginTrust.js";

/**
 * Install Slopweaver into one newly registered Codex home, as a foreground sync would.
 *
 * @param codexHome the `$CODEX_HOME` the register row just published names
 * @param stateHome the Slopweaver home whose profile declares the main checkouts
 * @returns what the run did; a throw becomes a `failed` outcome, never a rejection
 */
export function syncCodexPluginHomeLive({
  codexHome,
  stateHome,
}: {
  codexHome: string;
  stateHome: string;
}): SyncOutcome {
  try {
    return performFleetSync({
      deps: { codexAdd: spawnCodexAdd, nowMs: () => Date.now(), trustHooks: trustPluginHooks },
      homes: [{ codexHome, registered: true }],
      mainCheckouts: mainCheckoutsFromProfile({ home: stateHome }).map((config) => config.path),
      paths: { checkout: runningCheckoutRoot(), exportRoot: cachePaths().codexPlugin, userHome: homedir() },
      scope: "install-every-home",
    });
  } catch (error: unknown) {
    return { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: errorMessage({ error }) }) };
  }
}
