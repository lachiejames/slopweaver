/**
 * One contender in the recycle-pool race (`recyclePoolRace.test.ts`): spins until a shared start instant, then
 * makes ONE claim or ONE deposit against the shared pool and writes its outcome as JSON to its own file. Not a
 * test file: it is the process the race test spawns under `tsx`.
 *
 * The spin absorbs `tsx` start-up skew and nothing else — a process that boots after the instant has passed
 * falls straight through and acts late, so this guarantees no schedule.
 */
import { writeFileSync } from "node:fs";

import { claimRecycled, depositRecycled, productionClaimSeams } from "../../../worktree/recyclePool.js";
import { discardIntoTrash } from "../../../worktree/trashBatch.js";

const [mode, pool, target, trash, outcomeFile, startAtMs] = process.argv.slice(2);
if (
  mode === undefined ||
  pool === undefined ||
  target === undefined ||
  trash === undefined ||
  outcomeFile === undefined ||
  startAtMs === undefined
) {
  throw new Error("usage: recyclePoolContender claim|deposit <pool> <target> <trash> <outcomeFile> <startAtMs>");
}

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

const outcome =
  mode === "claim"
    ? claimRecycled({
        destination: target,
        packageName: "repo",
        pool,
        seams: productionClaimSeams({
          discard: ({ dir }) => discardIntoTrash({ dir, label: "race", nowMs: Date.now(), trashDir: trash }),
        }),
      })
    : depositRecycled({ entryName: `entry-${String(process.pid)}`, pool, source: target });
writeFileSync(outcomeFile, JSON.stringify(outcome));
