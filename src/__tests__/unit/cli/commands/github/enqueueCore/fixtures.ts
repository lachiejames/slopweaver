/*
 * The pure fixtures every `enqueueCore` test file shares: the queue, the target, the paired checkout, the
 * passing check, a green pull request and a parsed invocation with every mode off.
 */
import type { GithubEnqueueArgs } from "../../../../../../cli/commands/github/enqueueArgs.js";
import type { EnqueueTarget } from "../../../../../../cli/commands/github/enqueueTarget.js";
import type { CodexLoopInspection } from "../../../../../../codex/landingGate.js";
import type { GithubCheck } from "../../../../../../live/github/checksDedupe.js";
import type { MergeQueuePrState, MergeQueueState } from "../../../../../../live/github/mergeQueue.js";
import { githubMergeStatus } from "../../../../../../review/githubMergeStatus.js";
import { pr as enqueueRunPr } from "../enqueueRun/fixtures.js";

export const QUEUE: MergeQueueState = { branch: "main", url: "https://example.invalid/queue" };

/** GitHub reports the merge blocked — what it answers where a pending code owner really is required. */
export const BLOCKED = githubMergeStatus({ value: "BLOCKED" });

/** An ordinary pull request's target: it lands on its own base, over the GraphQL mutation. */
export const ORDINARY: EnqueueTarget = { branch: "main", kind: "ordinary" };

/** A checkout whose Codex loop cleared the floor, so these cases judge only the findings they are about. */
export const PAIRED: CodexLoopInspection = { failures: [], kind: "examined", leftovers: [] };

export const PASSING: GithubCheck = { kind: "check-run", name: "build", state: "passed", url: undefined };

/**
 * A green, approved, mergeable, unqueued pull request; overrides replace exactly the fields under test.
 *
 * It is `enqueueRun/fixtures.ts`'s pull request with the one field these cases read differently: the checks
 * carry `baseRef: "main"` and the shared {@link PASSING} check. A literal copy of that record would add a
 * cross-file clone the `duplicate-windows` ratchet refuses.
 *
 * @returns that pull request, with each field `over` names replaced
 */
export function pr(over: Partial<MergeQueuePrState> = {}): MergeQueuePrState {
  const baseline = enqueueRunPr();
  return {
    ...baseline,
    checks: { ...baseline.checks, baseRef: "main", checks: [PASSING] },
    ...over,
  };
}

/**
 * A parsed invocation with everything defaulted off; overrides set exactly the mode under test.
 *
 * @returns that invocation, with each field `over` names replaced
 */
export function args(over: Partial<GithubEnqueueArgs> = {}): GithubEnqueueArgs {
  return {
    acknowledge: [],
    acknowledgeAll: false,
    dequeue: false,
    dryRun: false,
    home: undefined,
    json: false,
    number: 9,
    owner: "acme",
    reason: undefined,
    repo: "widget",
    ...over,
  };
}
