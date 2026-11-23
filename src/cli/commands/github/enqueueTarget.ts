/**
 * WHERE `slopweaver github enqueue` is really pointing, and which transport it must use — two answers that
 * come from the same fact, so one pure module decides both.
 *
 * ## A stack member's own base branch is not where it lands
 *
 * GitHub's native stacks chain each pull request onto the head branch of the one below it, and only the
 * BOTTOM member targets the branch the stack actually lands on. MEASURED on
 * a two-member stack in `acme/acme-admin`: the position-1 member reads `baseRefName: staging`, and the
 * position-2 member reads `baseRefName: mx-2386-onboarding-consent-invariant` — a branch with no merge queue,
 * no protection rule and no required contexts. Judging the guard against that branch would refuse every
 * member above the bottom with *"has no merge queue"*, which is a verdict about the wrong subject rather
 * than a fact about the landing. Reproduce with
 * `slopweaver github read "<url of the position-2 member>" --json`.
 *
 * So the queue read, the required-context read, the refusals and the identity lines all take the STACK's
 * base for a member, and the pull request's own base for everything else. The two coincide for a bottom
 * member, which is exactly why the defect only ever showed up as GitHub's GraphQL refusal.
 *
 * ## Membership picks the transport, and no flag can
 *
 * GraphQL's `enqueuePullRequest` refuses a member with *"This pull request is part of a stack and must be
 * enqueued using the asynchronous merge REST API"*. Which path to take is therefore a property of the pull
 * request, never a caller's choice — there is deliberately no `--stack` flag to get wrong.
 *
 * Nothing here reaches the network, the clock or the filesystem.
 */
import type { MergeQueuePrState, MergeQueueStackMembership } from "../../../live/github/mergeQueue.js";

/**
 * Where one invocation is really pointing: the branch its guard must judge, and the transport it must use.
 *
 * @internal named by this verb's own core, shell and tests; nothing else in the repo consumes it.
 */
export type EnqueueTarget =
  | { readonly kind: "ordinary"; readonly branch: string }
  | { readonly kind: "stack"; readonly branch: string; readonly stack: MergeQueueStackMembership };

/**
 * The branch this pull request really lands on, and whether it is a native-stack member.
 *
 * A bottom member whose own base already IS the stack base still answers `stack`: the transport is decided
 * by membership, and GitHub refuses the GraphQL mutation for it whatever its base reads.
 *
 * @param pr the pull request's queue-relevant state as GitHub reports it
 * @returns the effective landing branch and the transport it implies
 */
export function enqueueTarget({ pr }: { pr: MergeQueuePrState }): EnqueueTarget {
  if (pr.stack === undefined) {
    return { branch: pr.baseRefName, kind: "ordinary" };
  }
  return { branch: pr.stack.baseRefName, kind: "stack", stack: pr.stack };
}

/**
 * The extra identity lines a stack member earns, or none for an ordinary pull request.
 *
 * They exist because a caller must not read "queued #N" as "queued one pull request". GitHub merges the
 * selected member together with every unmerged member BELOW it, atomically, so the scope of the act is
 * wider than its subject and the report has to say so before the write rather than after.
 *
 * No count and no list is derived from `size` or `position`: those describe the stack's whole membership,
 * not the unmerged remainder, so turning them into "3 pull requests" would be a confident wrong number.
 *
 * @param target where this invocation is pointing
 * @param number the selected pull request's number
 * @param prBaseRefName the pull request's OWN base branch, printed only when it is not the landing branch
 * @param dequeue whether the invocation is running backwards, out of the queue
 * @returns the lines to print, empty for an ordinary pull request
 */
export function enqueueScopeLines({
  target,
  number,
  prBaseRefName,
  dequeue,
}: {
  target: EnqueueTarget;
  number: number;
  prBaseRefName: string;
  dequeue: boolean;
}): readonly string[] {
  if (target.kind !== "stack") {
    return [];
  }
  const { stack } = target;
  const scope = dequeue
    ? `removing #${String(number)} also removes every member ABOVE it in stack #${String(stack.number)}`
    : `#${String(number)} and every unmerged pull request BELOW it in stack #${String(stack.number)} are ` +
      "requested together, bottom-up";
  const lines = [
    `stack:        #${String(stack.number)}  position ${String(stack.position)} of ${String(stack.size)}  ` +
      `landing on ${stack.baseRefName}`,
  ];
  if (prBaseRefName !== stack.baseRefName) {
    lines.push(`PR base:      ${prBaseRefName} — the member below it, which is NOT where the stack lands`);
  }
  lines.push(`scope:        ${scope}.`);
  return lines;
}
