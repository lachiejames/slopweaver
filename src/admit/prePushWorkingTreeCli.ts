/**
 * `lefthook.yml`'s `pre-push` entry point — nothing but the top-level invocation. `lefthook` runs this
 * directly (`node_modules/.bin/tsx src/admit/prePushWorkingTreeCli.ts`) ahead of `yarn validate:local`, so a
 * tree that is not what the push sends is refused in milliseconds rather than after a multi-minute gate whose
 * verdict was about the wrong subject. The decision lives in `prePushWorkingTree.ts`, which is unit-tested.
 * This file existing IS the invocation, so there is no `isDirectInvocation` guard.
 *
 * `cwd` alone selects the repository: git exports `GIT_DIR` into every hook it runs, and `gitEnv()` strips
 * it for the reason four incidents in this tree already record.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "../lib/gitRepo.js";
import { prePushWorkingTreeRefusal } from "./prePushWorkingTree.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

let statusPorcelain: string;
try {
  statusPorcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: gitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
} catch (error: unknown) {
  process.stderr.write(
    `pre-push refused: could not read the working tree: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const refusal = prePushWorkingTreeRefusal({ statusPorcelain });
if (refusal.length > 0) {
  process.stderr.write(`pre-push refused: ${refusal.join("\n")}\n`);
  process.exit(1);
}
process.exit(0);
