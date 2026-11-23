/**
 * The repository operation lock `slopweaver github stack push` takes, and the one flag that changes how it
 * is taken.
 *
 * Its own file for the reason the verb's header already gives: `stackPushRun.ts` states the order and calls
 * the edges, and the file-size ratchet is what keeps that true. This is a real seam rather than a slice —
 * the lock is the only step of the sequence with two spellings, and the caller wants one of them back.
 */

import { acquireOperationLock, type OperationLockResult } from "../../../admit/operationLock.js";
import { acquireOperationLockWaiting } from "../../../admit/operationLockWait.js";
import type { WaitOptions } from "../../../wait/flags.js";
import { realWaitClock } from "../../../wait/loop.js";
import type { GithubStackPushDeps } from "./stackPushDeps.js";

/**
 * Take the repository's operation lock — at once, or, under `--wait`, on the shared wait contract until the
 * stack verb already running there finishes.
 *
 * The waiting path is the ONE difference: a timeout hands back the last attempt's own refusal, so the caller
 * prints the same line it prints without `--wait` and the reader still learns which pid holds it and how old
 * that hold is. MEASURED: about 25 of the 215 poll loops written after the wait contract existed
 * were re-running this verb until that refusal stopped coming back (`src/admit/operationLockWait.ts`).
 *
 * @param deps only the clock and the output sink, so a test drives this without the verb's whole edge set
 * @param key the lock key, lower-cased by the caller exactly as the no-wait path lower-cases it
 * @param wait `--wait`/`--timeout-seconds`, as this invocation parsed them
 * @returns the lock handle, or the reason this push does not hold it
 */
export async function takeStackPushLock({
  deps,
  home,
  key,
  wait,
}: {
  deps: Pick<GithubStackPushDeps, "now" | "out">;
  home: string;
  key: string;
  wait: WaitOptions;
}): Promise<OperationLockResult> {
  if (!wait.wait) {
    return acquireOperationLock({ home, key, nowIso: deps.now().toISOString() });
  }
  return acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: (line) => {
      deps.out({ line });
    },
    home,
    key,
    nowIso: () => deps.now().toISOString(),
    timeoutSeconds: wait.timeoutSeconds,
  });
}
