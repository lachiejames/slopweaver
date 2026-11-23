/**
 * One contender in the operation-lock race (`operationLockRace.test.ts`): spins until a shared start
 * instant, acquires once, and records what happened to its own outcome file — an
 * `entered <pid> <enterMs> <leaveMs> <stoleFromPid>` line or a `refused <pid> <reason>` line, carrying its
 * own pid because `tsx` is a shim whose pid is not the node process's. Not a test file: it is the process
 * the race test spawns under `tsx`.
 *
 * The spin absorbs `tsx` start-up skew and nothing else — a process that boots after the instant has passed
 * falls straight through and acquires late, so this guarantees no schedule. The test's header says what the
 * run does instead to show it actually contended.
 */
import { writeFileSync } from "node:fs";

import { acquireOperationLock } from "../../../admit/operationLock.js";

const [home, outcomeFile, startAtMs, holdMs] = process.argv.slice(2);
if (home === undefined || outcomeFile === undefined || startAtMs === undefined || holdMs === undefined) {
  throw new Error("usage: operationLockContender <home> <outcomeFile> <startAtMs> <holdMs>");
}

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

const result = acquireOperationLock({ home, key: "race", nowIso: new Date().toISOString() });
if (result.isOk()) {
  const enteredAt = Date.now();
  const leaveAt = enteredAt + Number(holdMs);
  while (Date.now() < leaveAt) {
    // Hold the guarded body long enough for any second holder to overlap it visibly.
  }
  const leftAt = Date.now();
  writeFileSync(
    outcomeFile,
    `entered ${String(process.pid)} ${String(enteredAt)} ${String(leftAt)} ${String(result.value.stoleFromPid)}\n`,
  );
  result.value.release();
} else {
  writeFileSync(outcomeFile, `refused ${String(process.pid)} ${result.error}\n`);
}
