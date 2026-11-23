/**
 * One contender in the load-slot race (`loadSlotRace.test.ts`): spins until a shared start instant, takes a slot
 * once, and records what happened to its own outcome file — an `entered <pid> <enterMs> <leaveMs>` line, or a
 * `refused <pid> <obstacle count> <holder pids, comma-separated>` line, carrying its own pid because `tsx` is a shim whose pid is not
 * the node process's. Not a test file: it is the process the race test spawns under `tsx`.
 *
 * The spin absorbs `tsx` start-up skew and nothing else — a process that boots after the instant has passed falls
 * straight through and acquires late, so this guarantees no schedule. The test's header says what a run does
 * instead to show it actually contended.
 */
import { writeFileSync } from "node:fs";

import { acquireLoadSlot, releaseLoadSlot } from "../../../lib/loadSlots.js";

const [dir, outcomeFile, startAtMs, holdMs, limit] = process.argv.slice(2);
if (
  dir === undefined ||
  outcomeFile === undefined ||
  startAtMs === undefined ||
  holdMs === undefined ||
  limit === undefined
) {
  throw new Error("usage: loadSlotContender <dir> <outcomeFile> <startAtMs> <holdMs> <limit>");
}

while (Date.now() < Number(startAtMs)) {
  // A clock barrier: whatever of the tsx start-up skew happened before this instant is absorbed here.
}

const verdict = acquireLoadSlot({ ceilingMib: 4096, dir, limit: Number(limit) });
if (verdict.admitted) {
  const enteredAt = Date.now();
  const leaveAt = enteredAt + Number(holdMs);
  while (Date.now() < leaveAt) {
    // Hold the slot long enough for any holder past the limit to overlap it visibly.
  }
  const leftAt = Date.now();
  writeFileSync(outcomeFile, `entered ${String(process.pid)} ${String(enteredAt)} ${String(leftAt)}\n`);
  releaseLoadSlot({ dir });
} else {
  writeFileSync(
    outcomeFile,
    `refused ${String(process.pid)} ${String(verdict.obstacles.length)} ${verdict.holders.map((slot) => String(slot.pid)).join(",")}\n`,
  );
}
