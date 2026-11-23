/**
 * `slack draft approve`'s fence: every record the owner's words are read off held still from a read of them through
 * the approval's append.
 *
 * The first read, unfenced, says which call the words were said on, which is what the fence locks
 * (`../../../talk/callFence.ts`). Under the fence the words are read again, and that read is the one the landings
 * count, the pick and the append are judged on — so a refusal there lands before the pick, and nothing any of them
 * read can move before the approval is on the register. A fenced read that differs from the first refuses rather
 * than approving words the caller never saw, and so does a write the fence covers announced while that read ran —
 * the fence's `recheck`, run under its locks just before the act.
 */
import { isDeepStrictEqual } from "node:util";

import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { EXIT_USAGE } from "../../exitCodes.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Print why the owner's words do not bind, and nothing was recorded.
 *
 * @param lines each reason, printed as one error line
 * @returns the usage exit code, since the refusal precedes any act
 */
export function refusedApproval({ lines }: { lines: readonly string[] }): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_USAGE;
}

/**
 * Take the fence over the call the first read found, read the owner's words again under it, and run the approval on
 * that read when it matches the first, releasing the fence on every path.
 *
 * `slack draft record --approved` takes it too, at the park, over the whole approval it resolved before its Slack reads.
 *
 * @param anchor the anchor the approval binds
 * @param atIso when the first read says the words were said, which picks the call a relay turn was made on
 * @param first the unfenced read, which names the call
 * @param read the binding read, run again under the fence
 * @param run the count, pick and append, over the fenced read's approval
 * @returns the approval's exit code, or a refusal's
 */
export function underCallFence<Read>({
  anchor,
  atIso,
  deps,
  first,
  home,
  read,
  run,
}: {
  anchor: string;
  atIso: string;
  deps: Pick<SlackDraftDeps, "fenceCallWrites">;
  first: Read;
  home: string;
  read: () => Result<Read>;
  run: (approval: Read) => number;
}): number {
  const fence = deps.fenceCallWrites({ anchor, atIso, home });
  if (fence.isErr()) {
    return refusedApproval({ lines: [fence.error] });
  }
  try {
    const fenced = read();
    if (fenced.isErr()) {
      return refusedApproval({ lines: fenced.error });
    }
    if (!isDeepStrictEqual(fenced.value, first)) {
      return refusedApproval({ lines: [`the words at ${anchor} changed while the approval was read: re-run it`] });
    }
    const announced = fence.value.recheck();
    if (announced !== undefined) {
      return refusedApproval({ lines: [announced] });
    }
    return run(fenced.value);
  } finally {
    fence.value.release();
  }
}
