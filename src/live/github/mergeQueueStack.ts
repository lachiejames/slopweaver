/**
 * The merge guard's read of a pull request's NATIVE-stack membership, split from `./mergeQueue.ts` because it
 * is one self-contained validation with its own failure rule.
 *
 * Exported for `./mergeQueue.ts`'s `parseMergeQueuePr`, which is the whole read, and for its own unit test; no
 * other caller takes the membership without the payload validation around it.
 */

import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { MergeQueueStackMembership } from "./mergeQueue.js";

/** A positive whole number, or `undefined` when the payload carried something else there. */
function positiveInt({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * This pull request's native-stack membership, or `undefined` when GitHub reports it belongs to no stack.
 *
 * **A partial payload is a FAILURE rather than "no stack", and that asymmetry is the whole point.** Reading
 * an unparseable membership as absence would route a stack member back down the GraphQL path GitHub already
 * refuses — turning a shape this read did not understand into a confident claim about the transport. Both
 * selections null together is the one shape that means an ordinary pull request.
 *
 * @param pullRequest one raw `PullRequest` node
 * @param identity the `owner/name#number` address, named in a malformed-payload error
 * @returns the membership, `undefined` for an ordinary pull request, or the typed read failure
 */
export function parseMergeQueueStack({
  pullRequest,
  identity,
}: {
  pullRequest: Record<string, unknown>;
  identity: string;
}): Result<MergeQueueStackMembership | undefined, GithubLiveError> {
  const stack = pullRequest["stack"];
  const entry = pullRequest["stackEntry"];
  const stackAbsent = stack === null || stack === undefined;
  const entryAbsent = entry === null || entry === undefined;
  if (stackAbsent && entryAbsent) {
    return ok(undefined);
  }
  if (!isRecord(stack) || !isRecord(entry)) {
    const message =
      `GitHub returned ${identity} with a half-populated native stack — stack ` +
      `${stackAbsent ? "absent" : "present"}, stackEntry ${entryAbsent ? "absent" : "present"}. ` +
      "A membership this read cannot understand is never read as 'no stack'.";
    return err(GithubLiveErrors.readFailed({ message }));
  }
  const number = positiveInt({ value: stack["number"] });
  const size = positiveInt({ value: stack["size"] });
  const position = positiveInt({ value: entry["position"] });
  const baseRefName = optStr({ value: stack["baseRefName"] });
  if (number === undefined || size === undefined || position === undefined || baseRefName === undefined) {
    const message =
      `GitHub returned ${identity} inside a native stack without one of its number, baseRefName, size ` +
      "or the pull request's own position";
    return err(GithubLiveErrors.readFailed({ message }));
  }
  return ok({ baseRefName, number, position, size });
}
