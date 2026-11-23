/**
 * Printing a routed write's outcome and choosing the process exit code.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling. `updateFlow.ts` is its one
 * caller; `stack push` reports its own create through `reportStackPush`, which has a registration outcome to
 * print alongside the write's.
 */
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import type { ThroughDoorResult } from "../../../admit/effects.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { outcomeLines, type PrOutcome } from "./core.js";
import type { GithubPrDeps } from "./prDeps.js";

/**
 * Print the outcome and choose the exit code.
 *
 * @param deps the output sink
 * @param routed the door's routing result — whether the write was performed, and its outcome when it was
 * @returns the process exit code
 */
export function report({
  deps,
  routed,
}: {
  deps: Pick<GithubPrDeps, "out">;
  routed: ThroughDoorResult<PrOutcome>;
}): number {
  if (!routed.performed) {
    // A store that could not record the decision is not the door declining: say which it was.
    for (const line of notPerformedLines({ command: "slopweaver github pr update", through: routed })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const line of outcomeLines({ outcome: routed.result })) {
    deps.out({ line });
  }
  // `unconfirmed` is NOT success, but it is also not an ordinary failure: the exit code has to discourage a
  // blind retry, which is why it shares the error code rather than getting a friendlier one.
  const succeeded =
    routed.result.kind === "created" || routed.result.kind === "updated" || routed.result.kind === "unchanged";
  return succeeded ? EXIT_OK : EXIT_ERROR;
}
