/**
 * The lap's detached checkout: where `slopweaver github lap` mints the tree it installs and runs its lanes in,
 * and how that tree is registered and removed. Apart from `./lapShell.ts`, which hands it the cache root's
 * `lap-trees.noindex` and spreads it into the lap's deps; git runs through `./lapProcess.ts`'s `runLapCommand`.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../../../lib/result.js";
import type { LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { runLapCommand } from "./lapProcess.js";

/**
 * Check `sha` out detached in a fresh `sw-lap-*` directory under the parent `resolveParent` answers, with the
 * repository's hooks off: a `post-checkout` hook expecting installed `node_modules` fails in a tree whose install is
 * the lap's first lane.
 *
 * Production resolves `cachePaths().lapTrees`, never the OS temp directory: macOS's `dirhelper` empties every file
 * there older than three days each night at 03:35, and an install keeps the package cache's old mtimes, so it
 * emptied a live tree's packages mid-lap (TS2307 on `@openai/codex-sdk`). Read the schedule with
 * `cat /System/Library/LaunchDaemons/com.apple.bsd.dirhelper.plist`. The parent is resolved HERE rather than when
 * the lap's deps are built, so a cache root that cannot be read is this step's typed failure, never a throw before
 * the lap's first step.
 *
 * @param cwd the seat's checkout, whose repository the tree is registered in
 * @param resolveParent answers the directory the tree is minted under, created when absent; a throw is the step's
 * typed failure
 * @returns the tree, disposed by removing its registration and then its directory; or a typed failure, nothing
 * left registered
 */
export function checkoutLapTree({
  cwd,
  sha,
  resolveParent,
}: {
  cwd: string;
  sha: string;
  resolveParent: () => string;
}): Result<LapResource<string>, LapError> {
  let dir: string;
  let parent = "the lap-tree parent";
  try {
    parent = resolveParent();
    mkdirSync(parent, { recursive: true });
    dir = mkdtempSync(join(parent, "sw-lap-"));
  } catch (error) {
    return err(
      LapErrors.commandFailed({
        cause: error instanceof Error ? error.message : String(error),
        command: `create the lap tree under ${parent}`,
      }),
    );
  }
  const added = runLapCommand({
    args: ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", dir, sha],
    cwd,
    file: "git",
  });
  if (added.isErr()) {
    // An add that failed after registering the tree (a hook, say) leaves it listed; remove it before the directory.
    runLapCommand({ args: ["worktree", "remove", "--force", dir], cwd, file: "git" });
    rmSync(dir, { force: true, recursive: true });
    return err(added.error);
  }
  return ok({
    dispose: () => {
      runLapCommand({ args: ["worktree", "remove", "--force", dir], cwd, file: "git" });
      rmSync(dir, { force: true, recursive: true });
      return Promise.resolve();
    },
    value: dir,
  });
}
