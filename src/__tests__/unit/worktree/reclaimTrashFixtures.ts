/**
 * Fixtures shared by the reclaim-trash test files: the stand-ins for the load gate, the batch limit, the governed
 * delete's gauge and clock, and the governed delete itself, which no case outside `prunePacing.test.ts` is about. The
 * plugin-mirror cases (`pluginMirrors.test.ts`, `cli/commands/worktree/mirrorPruneRun.test.ts`) run the same governed
 * delete and take its gauge and clock from here.
 */
import { existsSync, rmSync } from "node:fs";

import type { FseventsdCpu } from "../../../worktree/fseventsdGauge.js";

/**
 * A load gate that never shuts, for every case not about the gate.
 *
 * @returns null, the answer of a gate that holds nothing
 */
export const NEVER_PAUSED = (): null => null;

/** A batch limit no case here reaches, for every case not about the limit. */
export const UNLIMITED = 100;

/**
 * An fseventsd gauge that always reads quiet, well under the governor's bar, for the case that runs the governed
 * delete itself: read live, a loaded machine's daemon held every quantum until the budget ran out.
 *
 * @returns one fixed reading of 0.1% CPU
 */
export const QUIET_FSEVENTSD = (): FseventsdCpu => ({ cpu: 0.1, kind: "read", pids: [97860] });

/**
 * A clock that never moves, so no budget or deadline can run out under a slow machine. Live only beside
 * {@link QUIET_FSEVENTSD} and the per-file delete lease `setup-temp-root.ts` mints: a hot gauge or a busy lease waits
 * for a deadline this clock never reaches, so the case would hang until vitest's timeout rather than answer.
 *
 * @returns the same epoch millisecond on every read
 */
export const FROZEN_CLOCK = (): number => 1_700_000_000_000;

/**
 * A batch delete that removes the directory at once. The governed delete reads the machine's live fseventsd and holds
 * while the fleet's own prunes keep it hot; `prunePacing.test.ts` proves that delete, and these cases prove the pass.
 *
 * @returns whether the directory is gone
 */
export const DELETE_NOW = ({ dir: target }: { dir: string; timeoutMs: number }): boolean => {
  rmSync(target, { force: true, recursive: true });
  return !existsSync(target);
};
