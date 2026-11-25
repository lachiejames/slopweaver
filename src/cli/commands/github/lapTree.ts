/**
 * The lap's detached checkout: where `slopweaver github lap` mints the tree it installs and runs its lanes in,
 * and how that tree is registered, marked and removed. Apart from `./lapShell.ts`, which hands it the cache root's
 * `lap-trees.noindex` and spreads it into the lap's deps; git runs through `./lapProcess.ts`'s `runLapCommand`.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeLapTreeMarker } from "../../../worktree/lapTreeProvenance.js";
import type { LapResource } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { runLapCommand } from "./lapProcess.js";

/** The minting process as its tree's marker names it: its pid, and its start stamp where `ps` gave one. */
export interface LapTreeMinter {
  readonly pid: number;
  readonly processStart: string | undefined;
}

/**
 * Check `sha` out detached in a fresh `sw-lap-*` directory under the parent `resolveParent` answers, with the
 * repository's hooks off: a `post-checkout` hook expecting installed `node_modules` fails in a tree whose install is
 * the lap's first lane. Then mark it as this lap's (`../../../worktree/lapTreeProvenance.ts`), so a tree a killed
 * lap never disposed is one `worktree prune` can recognise and remove once its minter is gone.
 *
 * Production resolves `cachePaths().lapTrees`, never the OS temp directory: macOS's `dirhelper` empties every file
 * there older than three days each night at 03:35, and an install keeps the package cache's old mtimes, so it
 * emptied a live tree's packages mid-lap (TS2307 on `@openai/codex-sdk`). Read the schedule with
 * `cat /System/Library/LaunchDaemons/com.apple.bsd.dirhelper.plist`. The parent is resolved HERE rather than when
 * the lap's deps are built, so a cache root that cannot be read is this step's typed failure, never a throw before
 * the lap's first step.
 *
 * A minter `ps` could not stamp is refused before anything is created: a marker naming a pid alone would let a
 * recycled pid keep the tree forever, or a live lap's tree read as spent.
 *
 * @param cwd the seat's checkout, whose repository the tree is registered in
 * @param resolveParent answers the directory the tree is minted under, created when absent; a throw is the step's
 * typed failure
 * @param minter the lap's own process, written into the marker
 * @returns the tree, disposed by removing its registration and then its directory; or a typed failure, nothing
 * left registered
 */
export function checkoutLapTree({
  cwd,
  sha,
  resolveParent,
  minter,
}: {
  cwd: string;
  sha: string;
  resolveParent: () => string;
  minter: LapTreeMinter;
}): Result<LapResource<string>, LapError> {
  const processStart = minter.processStart;
  if (processStart === undefined) {
    return err(
      LapErrors.commandFailed({
        cause: `ps printed no start time for pid ${String(minter.pid)}, so the tree's marker could not name its minter`,
        command: "mark the lap tree",
      }),
    );
  }
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
  const remove = (): void => {
    runLapCommand({ args: ["worktree", "remove", "--force", dir], cwd, file: "git" });
    rmSync(dir, { force: true, recursive: true });
  };
  const added = runLapCommand({
    args: ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", dir, sha],
    cwd,
    file: "git",
  });
  // An add that failed after registering the tree (a hook, say) leaves it listed; remove it before the directory.
  const marked = added.andThen(() => markTree({ dir, pid: minter.pid, processStart }));
  if (marked.isErr()) {
    remove();
    return err(marked.error);
  }
  return ok({
    dispose: () => {
      remove();
      return Promise.resolve();
    },
    value: dir,
  });
}

/**
 * Write the tree's marker into its private gitdir, naming the commit git actually checked out.
 *
 * @param dir the freshly added tree
 * @returns nothing, or why the tree could not be marked
 */
function markTree({
  dir,
  pid,
  processStart,
}: {
  dir: string;
  pid: number;
  processStart: string;
}): Result<void, LapError> {
  const gitDir = runLapCommand({ args: ["rev-parse", "--absolute-git-dir"], cwd: dir, file: "git" });
  if (gitDir.isErr()) {
    return err(gitDir.error);
  }
  const head = runLapCommand({ args: ["rev-parse", "HEAD"], cwd: dir, file: "git" });
  if (head.isErr()) {
    return err(head.error);
  }
  return writeLapTreeMarker({
    gitDir: gitDir.value,
    marker: { kind: "github-lap-tree", mintedHead: head.value, pid, processStart, version: 1 },
  }).mapErr((error) => LapErrors.commandFailed({ cause: error.message, command: "mark the lap tree" }));
}
