/**
 * The required-context gate `slopweaver github review-state` puts on each row: one base's shared required set,
 * judged against one head. Pure. The live read of each base's set stays in `./reviewStateRun.ts`, beside the
 * injected edges it calls.
 */

import { gateForHead, type RequiredContextGate, type RequiredSetRead } from "../../../live/github/requiredContexts.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";

/** What a base branch whose required set could not be read at all reads as. */
const UNREAD_CONTEXTS: RequiredSetRead = {
  kind: "unreadable",
  reason: "the base branch's protection and rulesets were not read on this run",
};

/**
 * The key one required-context read is cached under: the repository and the base branch together.
 *
 * @returns the repository slug and base branch name joined by `#`
 */
export function baseKey({ pr }: { pr: PrLiveState }): string {
  return `${pr.repoSlug}#${pr.baseRefName}`;
}

/**
 * The gate for ONE pull request: its base's shared required set, judged against its OWN head.
 *
 * Pure. The false red is tested through the whole run in
 * `unit/cli/commands/github/reviewStateRun.test.ts`: two heads on one base, and the case fails if they come
 * back with the same answer.
 *
 * **The mergeability it carries is `pr.mergeable`, never `pr.checks.mergeable`.** The two are different
 * reads and only the first is settled: {@link ./reviewStateSettle.settleMergeable} re-asks GitHub for every head it answered
 * `UNKNOWN` and writes the answer to the top-level field alone. `requiredContexts.ts`'s whole documented
 * value is naming CONFLICTING as the cause of a required context that never ran, and
 * the unsettled field is `UNKNOWN` on most of a cold fleet — MEASURED, 14 of 21 rows on
 * `lachiejames/slopweaver`, which is the discriminator lost. A gate disagreeing with its own row's `conflict`
 * cell is also the exact class of bug {@link RequiredSetRead} exists to close.
 *
 * @param pr the pull request whose head is being judged
 * @param sets every base's required set, keyed by {@link baseKey}
 * @returns this head's gate, `unreadable` when its base's set was not read
 */
export function gateFor({
  pr,
  sets,
}: {
  pr: PrLiveState;
  sets: ReadonlyMap<string, RequiredSetRead>;
}): RequiredContextGate {
  const read = sets.get(baseKey({ pr }));
  // A pull request whose repository slug or base name came back empty is never keyed by `readRequiredSets`, so its base's
  // set is genuinely absent rather than merely missing. Named with an `if` rather than defaulted or
  // coalesced, so the row says the gate was not read instead of reading as a base that requires nothing —
  // `no-silent-fallback` bans the `??` spelling oxlint would otherwise prefer here.
  let set: RequiredSetRead = UNREAD_CONTEXTS;
  if (read !== undefined) {
    set = read;
  }
  return gateForHead({
    branch: pr.baseRefName,
    checks: pr.checks.checks,
    mergeable: pr.mergeable,
    set,
    truncated: pr.checks.truncated,
  });
}
