/**
 * The carry gate's effectful half — the one seam `github push` and `github stack push` both run so that a
 * push of a mid-stack entry either takes the whole stack with it or refuses by name.
 *
 * The order is the contract, and it is the only order that is safe: **decide before the push, carry after
 * it.** A refusal that fired after the branch was already on the remote would be a report of damage rather
 * than a guard against it, and a rebase that ran before it would be replaying entries onto a base that is
 * still the old commit. So {@link planStackCarryForBranch} runs first and can stop the push dead, and
 * {@link performStackCarry} runs only once the push it was planned for is confirmed on the remote.
 *
 * Every step is `stack sync`'s own primitive — `rebaseSingleCommitOntoFreshBase` plus `pushCore.ts`'s
 * exact-lease plan — not a second implementation, so the same single-commit refusals, the same private-ref
 * fetch and the same backward-base guard apply here. The carry stops at the first step that does not land
 * and reports exactly what already went up: a replay of a real stack hits real content conflicts (two of the
 * four entries above one acme-admin pull request conflicted when that stack was repaired by hand), so "carry the stack"
 * can never mean "force-push whatever git produces".
 */
import type { GithubStack } from "../../../corpus/github/stack.js";
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import { listRegisteredStackMembers } from "../../../outbound/github/stackLedger.js";
import type { GithubPushDeps } from "./pushPrimitives.js";
import { ownerRepoOf } from "./pushPrimitives.js";
import {
  type GithubStackCarryPlan,
  githubStackCarryPlan,
  stackCarryAcknowledgementRefusal,
  stackCarryRefusalLines,
  stackCarryReportLines,
} from "./stackCarryCore.js";
import type { StackCarryDeps } from "./stackCarryDeps.js";
import { stackFactsForEntries, stackWorktreeList } from "./stackFacts.js";
import { executeStackSteps, stackStepOutcomeLines, stackStepsFullyLanded } from "./stackStepExec.js";

/** What the gate decided about everything stacked above the branch a verb is about to push. */
export type StackCarryGate =
  | { readonly kind: "clear" }
  | { readonly kind: "carry"; readonly plan: GithubStackCarryPlan; readonly lines: readonly string[] }
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/** Everything {@link planStackCarryForBranch} measures from, gathered by its caller. */
export interface StackCarryRequest {
  readonly branch: string;
  readonly carry: StackCarryDeps;
  readonly defaultBranch: string;
  readonly git: GithubPushDeps;
  readonly home: string;
  /** The pull-request numbers `--orphan-above` named, empty when the flag was not passed. */
  readonly orphanAbove: readonly number[];
  readonly remote: string;
  /** `owner/name`, as every push plan already spells it. */
  readonly repo: string;
  readonly repoRoot: string;
}

/** The stack slice above `branch`, or the reason there is nothing for the gate to do. */
type StackAbove =
  | { readonly kind: "clear" }
  | { readonly kind: "refused"; readonly lines: readonly string[] }
  | {
      readonly kind: "above";
      readonly api: GithubWriteApi;
      readonly entries: readonly GithubStack["entries"][number][];
      readonly firstPosition: number;
      readonly stackNumber: number;
    };

/**
 * Find the native stack entries sitting above this branch, if any.
 *
 * The local stack-member ledger is consulted FIRST and short-circuits the whole gate when it is empty: a
 * repository nothing here ever stacked has no stack to carry, and that answer must not cost a token or a
 * round trip on every ordinary push. Past that point a token is required rather than optional — a gate that
 * silently passes because it could not see is the failure this whole mechanism exists to remove.
 */
async function stackAboveBranch({ request }: { request: StackCarryRequest }): Promise<StackAbove> {
  const { owner, repo } = ownerRepoOf({ slug: request.repo });
  if (listRegisteredStackMembers({ home: request.home, owner, repo }).length === 0) {
    return { kind: "clear" };
  }
  const token = request.carry.token({ home: request.home });
  if (token === undefined) {
    return {
      kind: "refused",
      lines: [
        "refused: this repository has registered stack members, but no GitHub token resolved " +
          "($SLOPWEAVER_HOME/secrets/github-token, or gh auth token), so what is stacked above " +
          `${request.branch} cannot be read — refusing rather than pushing blind`,
      ],
    };
  }
  const api = request.carry.makeApi({ home: request.home, token });
  const pr = await api.findOpenPrByHead({ head: request.branch, owner, repo });
  if (pr.isErr()) {
    return {
      kind: "refused",
      lines: [`refused: could not read the open pull request for ${request.branch}: ${pr.error.message}`],
    };
  }
  const membership = pr.value?.stack;
  if (membership === undefined) {
    return { kind: "clear" };
  }
  return positionInStack({ api, branch: request.branch, owner, repo, stackNumber: membership.number });
}

/**
 * Read the whole stack and slice it above `branch`.
 *
 * A stack that does not list the branch its own member reports being in is inconsistent state, not an empty
 * carry — refused by name rather than treated as "nothing above", which is exactly the silent pass this gate
 * exists to prevent.
 */
async function positionInStack({
  api,
  branch,
  owner,
  repo,
  stackNumber,
}: {
  api: GithubWriteApi;
  branch: string;
  owner: string;
  repo: string;
  stackNumber: number;
}): Promise<StackAbove> {
  const stack = await api.getStack({ owner, repo, stackNumber });
  if (stack.isErr()) {
    return {
      kind: "refused",
      lines: [`refused: could not read stack #${String(stackNumber)}: ${stack.error.message}`],
    };
  }
  const index = stack.value.entries.findIndex((entry) => entry.headRef === branch);
  if (index === -1) {
    return {
      kind: "refused",
      lines: [
        `refused: GitHub reports ${branch} is in stack #${String(stackNumber)}, but that stack's own entries ` +
          "do not list it — refusing to push against a stack whose shape cannot be read",
      ],
    };
  }
  const entries = stack.value.entries.slice(index + 1);
  return entries.length === 0
    ? { kind: "clear" }
    : { api, entries, firstPosition: index + 2, kind: "above", stackNumber };
}

/** Turn a planned carry into the gate's verdict, applying the `--orphan-above` break-glass. */
function gateFor({
  branch,
  orphanAbove,
  plan,
}: {
  branch: string;
  orphanAbove: readonly number[];
  plan: GithubStackCarryPlan;
}): StackCarryGate {
  if (plan.orphans.length === 0) {
    return { kind: "carry", lines: stackCarryReportLines({ plan }), plan };
  }
  const mismatch = stackCarryAcknowledgementRefusal({ accepted: orphanAbove, orphans: plan.orphans });
  if (mismatch !== undefined) {
    return { kind: "refused", lines: [...stackCarryRefusalLines({ branch, orphans: plan.orphans }), ...mismatch] };
  }
  const accepted = plan.orphans.map(
    (orphan) =>
      `carry: ORPHANING #${String(orphan.pullRequestNumber)} (${orphan.branch}) — acknowledged by --orphan-above`,
  );
  return { kind: "carry", lines: [...stackCarryReportLines({ plan }), ...accepted], plan };
}

/**
 * Decide what this push owes the entries stacked above it — BEFORE anything is sent.
 *
 * @param request the branch, repository, home and acknowledgement this push was invoked with
 * @returns nothing to do, the carry to run once the push lands, or the refusal to print instead of pushing
 */
async function planStackCarryForBranch({ request }: { request: StackCarryRequest }): Promise<StackCarryGate> {
  const above = await stackAboveBranch({ request });
  if (above.kind !== "above") {
    return above.kind === "clear" ? { kind: "clear" } : { kind: "refused", lines: above.lines };
  }
  const { owner, repo } = ownerRepoOf({ slug: request.repo });
  const measured = await stackFactsForEntries({
    context: {
      api: above.api,
      defaultBranch: request.defaultBranch,
      git: request.git,
      isAncestor: request.carry.isAncestor,
      owner,
      registeredNumbers: new Set(listRegisteredStackMembers({ home: request.home, owner, repo })),
      remote: request.remote,
      repo,
      repoRoot: request.repoRoot,
      stackNumber: above.stackNumber,
    },
    entries: above.entries,
    firstPosition: above.firstPosition,
    worktrees: stackWorktreeList({ git: request.git, repoRoot: request.repoRoot }),
  });
  const plan = githubStackCarryPlan({ entriesAbove: measured.facts });
  return gateFor({ branch: request.branch, orphanAbove: request.orphanAbove, plan });
}

/**
 * Ask the carry gate what a push owes the entries stacked above it, and PRINT what it decided — the whole
 * pre-push half, so `github push` and `github stack push` share one copy rather than two that drift.
 *
 * @param out where the gate's own lines are printed
 * @returns the verdict; `refused` means the caller must send nothing at all
 */
export async function runStackCarryGate({
  out,
  request,
}: {
  out: (input: { line: string }) => void;
  request: StackCarryRequest;
}): Promise<StackCarryGate> {
  const gate = await planStackCarryForBranch({ request });
  for (const line of gate.kind === "clear" ? [] : gate.lines) {
    out({ line });
  }
  return gate;
}

/**
 * Carry the stack above a branch whose own push has just been confirmed, and print every step.
 *
 * @param gate what {@link runStackCarryGate} decided BEFORE the push — see this module's doc for why that
 *   order is the contract rather than a convenience
 * @returns whether every planned step landed; false must never be reported as success
 */
export function runStackCarry({
  gate,
  git,
  home,
  out,
  remote,
}: {
  gate: StackCarryGate;
  git: GithubPushDeps;
  /** The state home whose push-root register each carried push is judged against. */
  home: string;
  out: (input: { line: string }) => void;
  remote: string;
}): boolean {
  if (gate.kind !== "carry" || gate.plan.steps.length === 0) {
    return true;
  }
  const outcomes = executeStackSteps({ git, home, remote, steps: gate.plan.steps });
  for (const line of stackStepOutcomeLines({ landedWord: "carried", outcomes, prefix: "carry: " })) {
    out({ line });
  }
  return stackStepsFullyLanded({ outcomes, steps: gate.plan.steps });
}
