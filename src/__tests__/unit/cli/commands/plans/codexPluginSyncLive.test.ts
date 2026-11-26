/**
 * The one-home install `plans add --provider codex` and the `plans connect` worker run, over the real fleet core
 * with throwaway homes, and the checkout the worker hands it.
 *
 * Neither case reaches Codex: a state home whose profile declares no main checkout skips before anything is
 * exported, and a Codex home inside the export root is refused before the lock is taken. The export root is
 * the per-file cache sandbox `setup-temp-root.ts` points `SLOPWEAVER_CACHE_HOME` at, so no case writes outside it.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../../../cacheHome.js";
import {
  connectWorkerCheckout,
  liveConnectWorkerCheckout,
  syncCodexPluginHomeLive,
} from "../../../../../cli/commands/plans/codexPluginSyncLive.js";
import { CodexPluginSyncErrors } from "../../../../../codexPlugin/errors.js";
import { codeCheckoutRoot, runningCheckoutRoot } from "../../../../../lib/gitRepo.js";

const roots: string[] = [];

/** A throwaway root holding a state home with no profile and a Codex home that does not exist yet. */
function throwawayHomes(): { readonly codexHome: string; readonly stateHome: string } {
  const root = mkdtempSync(join(tmpdir(), "plans-codex-sync-live-"));
  roots.push(root);
  return { codexHome: join(root, "codex-two"), stateHome: join(root, "state") };
}

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

describe("the one-home Codex install a plans add runs", () => {
  it("skips, naming the checkout it was handed, when the state home's profile declares no main checkout", () => {
    const { codexHome, stateHome } = throwawayHomes();

    expect(syncCodexPluginHomeLive({ checkout: runningCheckoutRoot(), codexHome, stateHome })).toEqual({
      did: "skipped",
      why: `${runningCheckoutRoot()} is not a declared main checkout, and only one publishes the Codex install`,
    });
    expect(existsSync(codexHome)).toBe(false);
  });

  it("refuses a Codex home that sits inside the export root before anything is exported", () => {
    const { stateHome } = throwawayHomes();
    const exportRoot = cachePaths().codexPlugin;
    const codexHome = join(exportRoot, "nested-codex-home");

    expect(syncCodexPluginHomeLive({ checkout: runningCheckoutRoot(), codexHome, stateHome })).toEqual({
      did: "failed",
      error: CodexPluginSyncErrors.codexHomeOverlapsExport({ codexHome, exportRoot }),
    });
  });
});

describe("the checkout a plans connect worker publishes from", () => {
  it("is the code's own checkout, never the state home the worker stands in", () => {
    const { stateHome } = throwawayHomes();

    expect(connectWorkerCheckout({ codeRoot: "/checkouts/main", cwdRoot: () => stateHome })).toBe("/checkouts/main");
  });

  it("falls to the cwd anchor's answer only when the code sits in no repository", () => {
    const { stateHome } = throwawayHomes();

    expect(connectWorkerCheckout({ codeRoot: undefined, cwdRoot: () => stateHome })).toBe(stateHome);
  });

  it("answers this test's own code checkout when run live", () => {
    expect(liveConnectWorkerCheckout()).toBe(codeCheckoutRoot());
  });
});
