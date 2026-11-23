/**
 * Read one small fact about EVERY pull request in a fleet in a single GraphQL request, and split rather
 * than write off whatever fails.
 *
 * ## Why one request with N aliases, rather than N requests
 *
 * Two facts the landing read needs are per-PULL-REQUEST rather than per-branch, so neither can ride on the
 * per-branch reads `../../cli/commands/github/landingRun.ts` already makes: how far a head is behind its
 * base (`./baseDistance.ts`) and GitHub's mergeability once it has actually computed it
 * (`./mergeableRecheck.ts`). GraphQL cannot express either inside the fleet node selection — `compare` and
 * `pullRequest` both take an ARGUMENT, and an argument may hold a literal or an operation variable, never
 * the result of a sibling field — so a per-node selection is not available and the choice is N requests or
 * one request carrying N aliases.
 *
 * MEASURED over the owner's 30 open pull requests, one aliased `compare` per pull request:
 * **one round trip, 2,614 ms, and `rateLimit.cost` 1 of an hourly 5,000** — 0.02% of the budget. That is what
 * makes both reads affordable at a supervisor boot under the rate-limit ruling. Reproduce by selecting
 * `rateLimit { cost remaining limit }` beside the aliases.
 *
 * The query itself is **5,492 bytes at 30 aliases**, measured against the shipped `./baseDistance.ts` rather
 * than against a probe script: an earlier draft of this comment said 5,475, which was the size of a hand-
 * written probe whose alias text had since diverged from the code, and a Codex review caught the seventeen
 * bytes. Reproduce by capturing `query` from an injected `GithubReadGraphql` and taking its byte length.
 *
 * ## Why a failure is HALVED rather than reported wholesale
 *
 * MEASURED the same day: a request pairing one good alias with a head ref that does not exist fails
 * ENTIRELY — `Could not resolve head ref 'branch-that-does-not-exist-xyz'` — and `./read.ts` surfaces that
 * as an error, so the good alias's answer is lost with it. A deleted or renamed head branch is an ordinary
 * thing to find in a fleet, and losing twenty-nine answers to one of them would be the exact
 * one-failure-sinks-the-batch shape this repository refuses.
 *
 * So a failing request is split in half and each half retried, recursing to a single alias. Only the items
 * that genuinely cannot be read answer `unread`, and with nothing wrong in the fleet it is exactly one
 * request. The same mechanism covers a request that fails for being too LARGE, which is why neither caller
 * carries a guessed chunk size.
 */

import type { Result } from "../../lib/result.js";
import type { GithubLiveError } from "./errors.js";

/**
 * One item's answer, or why this read could not produce one.
 *
 * `unread` is a first-class arm rather than a failure of the run, for the reason every other read in this
 * area states: a read that could not establish something must never print what a read that established it
 * prints. Neither caller may synthesise a zero, a green or an absence from it.
 */
export type AliasedAnswer<Value> =
  { readonly kind: "read"; readonly value: Value } | { readonly kind: "unread"; readonly why: string };

/**
 * How one batch of items is actually read, so the splitting above is written once and tested once.
 *
 * It answers POSITIONALLY — one entry per item of `items`, in the same order — rather than by a map keyed on
 * the item. A map cannot express two items that are the same value, and an implementation keyed that way
 * silently returns FEWER answers than it was given inputs; a Codex review found exactly that hole in this
 * module's first shape. An array indexed alongside the input cannot have it.
 *
 * Its two failure directions stay different. An `err` is the WHOLE request failing, which is what the
 * splitting reacts to. An `unread` entry inside an `ok` batch is a request that SUCCEEDED and could not
 * answer that one item — a null ref, a missing field — and splitting cannot help, so its own reason is kept
 * rather than replaced by a generic one.
 */
export type AliasedBatchRead<Item, Value> = (args: {
  items: readonly Item[];
}) => Promise<Result<readonly AliasedAnswer<Value>[], GithubLiveError>>;

/**
 * Read every item, halving and retrying any request that fails, down to one item at a time.
 *
 * @param items every item to read, in the caller's own order
 * @param read how one batch is fetched
 * @returns one answer per item, in the SAME ORDER and of the same length — never keyed on the item itself,
 *   so two equal items each get their own answer and a caller can zip the result against its input
 */
export async function aliasedFleetRead<Item, Value>({
  items,
  read,
}: {
  items: readonly Item[];
  read: AliasedBatchRead<Item, Value>;
}): Promise<readonly AliasedAnswer<Value>[]> {
  if (items.length === 0) {
    return [];
  }
  const batch = await read({ items });
  if (batch.isOk()) {
    return alignedOrRefused({ answers: batch.value, items });
  }
  if (items.length === 1) {
    return [{ kind: "unread", why: batch.error.message }];
  }
  const half = Math.floor(items.length / 2);
  const left = await aliasedFleetRead({ items: items.slice(0, half), read });
  const right = await aliasedFleetRead({ items: items.slice(half), read });
  return [...left, ...right];
}

/**
 * A batch's answers when it returned one per item, or every item `unread` when it did not.
 *
 * A short array is NOT a partial answer to be padded out. A Codex review found the padding version shifting
 * every later answer onto the wrong pull request when a batch omitted a non-TAIL entry — one pull request's distance
 * printed against a different pull request — and the test written alongside it had codified that misassociation as expected.
 * So a length mismatch is treated as the batch being broken: nothing is aligned, every item says so, and no
 * answer is attributed to a pull request it was not about. Both readers in this directory build their arrays
 * with `items.map`, so the only way to reach this arm is a genuine implementation fault.
 *
 * @param answers what the batch returned
 * @param items what it was given
 * @returns the answers when the two line up, else one `unread` per item naming the mismatch
 */
function alignedOrRefused<Item, Value>({
  answers,
  items,
}: {
  answers: readonly AliasedAnswer<Value>[];
  items: readonly Item[];
}): readonly AliasedAnswer<Value>[] {
  if (answers.length === items.length) {
    return answers;
  }
  const why =
    `the read answered ${String(answers.length)} of ${String(items.length)} pull request(s), so no answer ` +
    "could be attributed to the pull request it was about";
  return items.map(() => ({ kind: "unread", why }));
}
