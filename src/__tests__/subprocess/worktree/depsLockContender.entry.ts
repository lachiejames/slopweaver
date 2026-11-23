/**
 * One contender in the own-versus-shared race (`depsLockRace.test.ts`): spins until a shared start instant, then
 * makes ONE own-tree provision or ONE shared-deps link of a worktree, through the production functions and under
 * whatever `SLOPWEAVER_HOME` the test gave this process, and writes its outcome as JSON to its own file. Not a
 * test file: it is the process the race test spawns under `tsx`.
 *
 * The own provision is the real hold, claim and rollback (`holdOwnTree`, `installFromRecycled`) around a stand-in
 * install that reads what stands at `node_modules`, waits as a `yarn install` would, and reads it again — so the
 * outcome says whether anything replaced the tree while the install was running.
 */
import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sleepSync } from "#lib/sleepSync.js";
import {
  claimRecycledTree,
  discardRecycledTree,
  holdOwnTree,
  installFromRecycled,
  linkSharedUnderLock,
} from "../../../worktree/provisionRecycle.js";

const [mode, worktree, repoRootOrShared, outcomeFile, startAtMs] = process.argv.slice(2);
if (
  mode === undefined ||
  worktree === undefined ||
  repoRootOrShared === undefined ||
  outcomeFile === undefined ||
  startAtMs === undefined
) {
  throw new Error("usage: depsLockContender own|link <worktree> <repoRoot|sharedRoot> <outcomeFile> <startAtMs>");
}

/** How long the stand-in install holds the tree, long enough for a contender polling at 25ms to try many times. */
const INSTALL_MS = 400;

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

/** What stands at the worktree's `node_modules`: its inode and whether it is the shared symlink. */
function standing(): string {
  const stat = lstatSync(join(worktree!, "node_modules"), { throwIfNoEntry: false });
  if (stat === undefined) {
    return "absent";
  }
  return `${String(stat.ino)}:${stat.isSymbolicLink() ? "link" : "tree"}`;
}

/** One own-tree provision, recording whether `node_modules` stayed the same thing for the whole install. */
function own(): unknown {
  const seen: string[] = [];
  const held = holdOwnTree({
    act: () =>
      installFromRecycled({
        claim: () => claimRecycledTree({ path: worktree!, repoRoot: repoRootOrShared! }),
        discard: () =>
          discardRecycledTree({ dir: join(worktree!, "node_modules"), path: worktree!, repoRoot: repoRootOrShared! }),
        install: () => {
          seen.push(standing());
          sleepSync({ ms: INSTALL_MS });
          seen.push(standing());
          return undefined;
        },
        mark: () => undefined,
      }),
    path: worktree!,
  });
  if (held.isErr()) {
    return { detail: held.error.message, kind: "own-failed", seen };
  }
  return { ...held.value, seen };
}

/** The one act this contender makes, as a JSON-ready record. */
function act({ kind }: { kind: string }): unknown {
  if (kind === "own") {
    return own();
  }
  try {
    linkSharedUnderLock({ path: worktree!, sharedRoot: repoRootOrShared! });
    return { kind: "linked" };
  } catch (error: unknown) {
    return { detail: String(error), kind: "link-failed" };
  }
}

writeFileSync(outcomeFile, JSON.stringify(act({ kind: mode })));
