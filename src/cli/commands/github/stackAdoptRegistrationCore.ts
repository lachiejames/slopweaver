/**
 * `slopweaver github stack adopt --register-only` — the pure decisions behind registering an EXISTING
 * chained pull request into GitHub's native stack WITHOUT rewriting a single commit.
 *
 * ## The deadlock this exists to end, measured
 *
 * MEASURED on acme/acme-admin. `stack audit --repo acme/acme-admin --mine` named exactly
 * two chained-not-natively-stacked pull requests this account authored, and BOTH doors refused them, so
 * neither could be repaired by any local rewrite:
 *
 * - `github push` on `pr-description-zod-verb`: _"refused: pushing pr-description-zod-verb, whose open pull
 *   request owner/repo#N is based on agent-cli-package-foundations would leave a chained pull request that GitHub
 *   does not know is a stack"_ (`./pushChainGate.ts`).
 * - `github stack adopt --pr <number> --dry-run`: _"refused: PR owner/repo#N has 8 commits — rebased onto its base's
 *   fresh tip it would still be 5. Adopt replays exactly one commit, with no override"_
 *   (`./stackAdoptCore.ts`'s `commitCountRefusal`).
 *
 * And a local squash does not break the loop, because adopt ALSO requires the local HEAD to equal the head
 * SHA GitHub reports: reaching one commit locally immediately fails that check, while the only way to make
 * the REMOTE one commit is a push, which the first door refuses. Reproduce either half:
 *
 * ```
 * slopweaver github stack audit --repo acme/acme-admin --mine
 * slopweaver github stack adopt --pr <number> --dry-run
 * ```
 *
 * ## The seam: registration is not replay
 *
 * `stack adopt` conflates two independent operations, and only the second has any of the preconditions that
 * deadlock a drifted branch:
 *
 * - **Registration** — `createStack`/`addToStack` plus the local ledger entry. It selects PULL REQUEST
 *   NUMBERS, never commits. It reads no local Git, moves no ref, and is the operation that actually removes
 *   the chained-not-native violation: once both carry the same stack number, `chainKindFor` returns
 *   `undefined` and `./pushChainGate.ts` clears by construction, with no change to that gate at all.
 * - **Replay** — `./stackSquash.ts`'s single-commit rebase and the leased force-push. THIS is what needs one
 *   commit, a checked-out branch, a local HEAD matching the remote, and a clean worktree.
 *
 * So this mode is the first operation without the second. Every refusal below is one registration genuinely
 * depends on; every precondition that belongs to the replay is deliberately absent, and the shell never even
 * takes the measurements that feed them.
 *
 * ## What this mode does NOT claim
 *
 * Membership only. The branch is not rebased, so `stack sync` still cannot replay a multi-commit entry, and
 * pushing the PARENT may now refuse on carry with entries above it (`./stackCarryRun.ts`; `--orphan-above`
 * is the existing route). The success report says all three in its own words rather than leaving a reader to
 * infer "repaired" from an exit code — `stack audit --check` is a falsifiable MEMBERSHIP check, and calling
 * it proof of tree health would be the defect.
 */

import type { DoorRequest } from "../../../admit/types.js";
import type { GithubStack } from "../../../corpus/github/stack.js";
import type { WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { belowKey, comparableFields, stackMembershipField } from "./stackAdoptRegistrationFields.js";
import {
  adoptableShapeRefusal,
  childRefusal,
  parentAuthorisationOutcome,
  parentChainRefusal,
} from "./stackAdoptRegistrationRefusals.js";
import type { Authorisation, Freshness } from "./updateCore.js";

/** The native write this registration has decided on — or that GitHub has already joined the pair. */
export type RegistrationOperation =
  /** Neither pull request is in a stack: form one from the pair, bottom-first. */
  | { readonly kind: "create"; readonly pullRequests: readonly [number, number] }
  /** The parent is in a stack the child never joined: append the child to it. */
  | { readonly kind: "add"; readonly stackNumber: number; readonly pullRequests: readonly [number] }
  /** Both already carry the same stack number: confirm it, and write nothing natively. */
  | { readonly kind: "already-joined"; readonly stackNumber: number };

/** The live pull-request facts this mode decides from — no local Git, no commit counts, no SHAs. */
export interface RegistrationFacts {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly child: WrittenPr;
  /** The open pull request whose head is the child's base branch, or `undefined` when none has it. */
  readonly parent: WrittenPr | undefined;
  /**
   * The open pull request whose head is the PARENT's base branch — the fact that decides whether forming a
   * fresh stack from this pair is safe, and the BASELINE the read-back compares against afterwards.
   *
   * Read whenever there is a parent at all, on both operations. Reading only where a `create` is possible
   * would save a call but cost the plan-time answer: without it, an `add` could not tell a chain someone else broke mid-write from one that was already broken.
   */
  readonly grandparent: WrittenPr | undefined;
}

/** The one registration this verb can execute, with the parent it resolved. */
export interface RegistrationPlan {
  readonly facts: RegistrationFacts & { readonly parent: WrittenPr };
  readonly operation: RegistrationOperation;
  readonly overrideNotices: readonly string[];
}

/** Why this invocation registers nothing, without that being a failure. */
type NoRegistrationReason = "default-base" | "no-open-parent";

/** What planning decided: a registration to perform, or a legitimate no-op. */
export type RegistrationDecision =
  | {
      readonly kind: "no-registration";
      readonly reason: NoRegistrationReason;
      readonly childNumber: number;
      readonly baseRef: string;
    }
  | { readonly kind: "register"; readonly plan: RegistrationPlan };

/** What a read-back proved after the native write. */
export interface ConfirmedRegistration {
  readonly stackNumber: number;
  readonly entryNumbers: readonly number[];
  readonly childNumber: number;
  readonly parentNumber: number;
}

/** The native write the two compatible shapes decide on. */
function operationFor({ child, parent }: { child: WrittenPr; parent: WrittenPr }): RegistrationOperation {
  const childStack = child.stack?.number;
  const parentStack = parent.stack?.number;
  if (childStack !== undefined && childStack === parentStack) {
    return { kind: "already-joined", stackNumber: childStack };
  }
  if (parentStack === undefined) {
    return { kind: "create", pullRequests: [parent.number, child.number] };
  }
  return { kind: "add", pullRequests: [child.number], stackNumber: parentStack };
}

/**
 * Decide whether a register-only adopt may proceed, from the live pull requests alone.
 *
 * Reads nothing about commits: neither `commits`, nor `head.sha`, nor any local Git fact is consulted, which
 * is the whole point of the mode. The order is child shape → authorisation → default base → absent parent →
 * parent topology → membership → bottom-first → the parent's own authorisation.
 *
 * @param facts the live pull-request facts the shell read
 * @param authorisation whether this account may act on a pull request it may not have authored
 * @param parentAuthorisation the same question asked of the parent, which a `create` enrols too
 * @param viewerId the token account's own id, for the audit lines a membership refusal carries
 * @returns the registration to perform, the legitimate no-op, or every refusal line
 */
export function githubStackAdoptRegistrationPlan({
  facts,
  authorisation,
  parentAuthorisation,
  viewerId,
}: {
  facts: RegistrationFacts;
  authorisation: Authorisation;
  parentAuthorisation: Authorisation | undefined;
  viewerId: number | undefined;
}): Result<RegistrationDecision> {
  const refusal = childRefusal({ facts });
  if (refusal !== undefined) {
    return err([refusal]);
  }
  if (authorisation.kind === "refused") {
    return err([authorisation.reason]);
  }
  const { child, parent } = facts;
  if (parent === undefined) {
    // The LOOKUP decides this, never the base branch's name. A base equal to the repository default is not
    // an unconditional short-circuit, because that would make the
    // orphan guard's own prescribed repair a no-op: `chainParentFor` recognises a pull request whose HEAD is
    // `main`, so "adopt the parent first" answered "no registration" and the upper pair refused forever.
    // `defaultBranch` now only chooses which sentence to print about a lookup that already came back empty.
    const reason: NoRegistrationReason = child.baseRef === facts.defaultBranch ? "default-base" : "no-open-parent";
    return ok({ baseRef: child.baseRef, childNumber: child.number, kind: "no-registration", reason });
  }
  const chainProblem = parentChainRefusal({ facts, parent, viewerId });
  if (chainProblem !== undefined) {
    return err(chainProblem);
  }
  const operation = operationFor({ child, parent });
  const parentOutcome = parentAuthorisationOutcome({ operation, parent, parentAuthorisation });
  if (parentOutcome.refusal !== undefined) {
    return err([parentOutcome.refusal]);
  }
  const childNotices = authorisation.kind === "overridden" ? [authorisation.notice] : [];
  const parentNotices = parentOutcome.notice === undefined ? [] : [parentOutcome.notice];
  return ok({
    kind: "register",
    plan: {
      facts: { ...facts, parent },
      operation,
      overrideNotices: [...childNotices, ...parentNotices],
    },
  });
}

/**
 * Whether the facts the plan was built from are still what the door is about to act on.
 *
 * Deliberately narrower than `./stackAdoptCore.ts`'s comparator in one direction and wider in another: the
 * head SHA and the commit count are EXCLUDED, because this mode selects pull-request numbers rather than
 * commits and a concurrent content-only push must stay admissible; the base repository and both sides' stack
 * membership are INCLUDED, because the shape check and the create/add selection read them.
 *
 * @param previewed the facts as read while planning
 * @param current the facts as re-read immediately before the native write
 * @returns fresh, or the one field that moved and what it moved to
 */
export function githubStackAdoptRegistrationFreshness({
  previewed,
  current,
}: {
  previewed: RegistrationFacts;
  current: RegistrationFacts;
}): Freshness {
  const before = comparableFields({ facts: previewed });
  const after = comparableFields({ facts: current });
  const moved = before.findIndex(([, value], index) => value !== after[index]?.[1]);
  if (moved === -1) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason:
      `${before[moved]![0]} changed from ${before[moved]![1]} to ${after[moved]![1]} before registration; ` +
      "nothing was sent. Re-run to work from the current state",
  };
}

/**
 * Whether two registration operations are the same write, comparing the whole payload rather than the
 * discriminator — `add(stack 5, [100])` becoming `add(stack 6, [100])` is a different write under the same
 * kind, and executing the planned one would then join the wrong stack.
 *
 * @param planned the operation decided while planning
 * @param current the operation decided again from the freshly-read facts
 * @returns whether the two name the identical native write
 */
export function sameRegistrationOperation({
  planned,
  current,
}: {
  planned: RegistrationOperation;
  current: RegistrationOperation;
}): boolean {
  if (planned.kind !== current.kind) {
    return false;
  }
  if (planned.kind === "create" && current.kind === "create") {
    return planned.pullRequests.join(",") === current.pullRequests.join(",");
  }
  if (planned.kind === "add" && current.kind === "add") {
    return (
      planned.stackNumber === current.stackNumber && planned.pullRequests.join(",") === current.pullRequests.join(",")
    );
  }
  return planned.kind === "already-joined" && current.kind === "already-joined"
    ? planned.stackNumber === current.stackNumber
    : false;
}

/**
 * Whether one side of the pair still has the identity and shape the plan was built against — the read-back's
 * half of the check, so a pull request that closed or was retargeted to a fork between the write and the
 * read cannot satisfy a membership confirmation.
 */
function identityMoved({
  expected,
  owner,
  pr,
  repo,
  what,
}: {
  expected: WrittenPr;
  owner: string;
  pr: WrittenPr;
  repo: string;
  what: string;
}): readonly string[] {
  const intact =
    pr.number === expected.number && pr.state === "open" && adoptableShapeRefusal({ owner, pr, repo }) === undefined;
  return intact ? [] : [`${what} identity or shape changed`];
}

/** One failed confirmation check, in the fixed order the report joins them. */
function confirmationFailures({
  below,
  plan,
  expectedStackNumber,
  child,
  parent,
  stack,
}: {
  below: WrittenPr | undefined;
  plan: RegistrationPlan;
  expectedStackNumber: number;
  child: WrittenPr;
  parent: WrittenPr;
  stack: GithubStack;
}): readonly string[] {
  const { owner, repo } = plan.facts;
  const entryNumbers = stack.entries.map((entry) => entry.number);
  const present = new Set(entryNumbers);
  // The bottom-first rule is a judgement about the
  // chain BELOW the parent, and the planner answers it from one lookup. Three races invalidate that answer
  // without touching anything else this function reads — the parent retargeted onto a different base, the
  // pull request below it REOPENED, and that same reopen on the `add` path — and none is preventable, because
  // every provider read leaves a window behind it.
  //
  // So the test is a COMPARISON, never a state. `below` is that same lookup re-run after the write, and it is
  // measured against what the plan saw. A chain someone else broke WHILE this verb was writing is reported
  // unconfirmed with the repair; a chain that was already broken when the plan ran is not this verb's doing
  // and the planner deliberately permits it, so confirming one is right. Asserting the STATE instead would
  // refuse a write that had just succeeded for a condition it did not cause.
  const belowChanged = belowKey({ pr: below }) !== belowKey({ pr: plan.facts.grandparent });
  const belowNowOrphaned =
    below !== undefined && below.number !== parent.number && below.stack?.number !== stack.number;
  const orphanedBelow = belowChanged && belowNowOrphaned;
  return [
    ...identityMoved({ expected: plan.facts.child, owner, pr: child, repo, what: "child" }),
    ...identityMoved({ expected: plan.facts.parent, owner, pr: parent, repo, what: "parent" }),
    ...(orphanedBelow
      ? [
          `open PR #${String(below.number)} (${below.head.ref}) is based below parent PR ` +
            `#${String(parent.number)} and is not in this stack, so registering the pair above it left that ` +
            "lower relation needing a dissolve. This was not true when the pair was planned. Run " +
            `\`slopweaver github stack audit --repo ${owner}/${repo} --mine\` and register that chain from ` +
            "its lowest pair upward",
        ]
      : []),
    ...(child.baseRef === parent.head.ref ? [] : ["child and parent no longer form the intended chain"]),
    ...(child.stack?.number === expectedStackNumber ? [] : ["child membership differs from the expected stack"]),
    ...(parent.stack?.number === expectedStackNumber ? [] : ["parent membership differs from the expected stack"]),
    ...(stack.number === expectedStackNumber ? [] : ["fetched stack number differs from the expected stack"]),
    ...(present.has(child.number) ? [] : [`fetched stack is missing PR #${String(child.number)}`]),
    ...(present.has(parent.number) ? [] : [`fetched stack is missing PR #${String(parent.number)}`]),
  ];
}

/**
 * Whether the read-back proves the membership this invocation asked for — the check that stops a successful
 * API response being reported as a confirmed repair.
 *
 * `expectedStackNumber` is PINNED by the caller (the number `createStack` returned, the number an `add` was
 * aimed at, or the pair's existing common number) rather than inferred from the read-back, so two pull
 * requests that moved TOGETHER into some other stack fail this rather than passing it.
 *
 * @param below the open pull request the parent's base branch now points at, re-read after the write, or
 *   `undefined` when none has it or the operation was an `add`
 * @param plan the plan whose write was just performed
 * @param expectedStackNumber the stack number this invocation pinned before reading back
 * @param child the freshly re-read child pull request
 * @param parent the freshly re-read parent pull request
 * @param stack the freshly fetched native stack
 * @returns what the read-back proved, or every check that failed with what was observed
 */
export function githubStackAdoptRegistrationConfirmation({
  below,
  plan,
  expectedStackNumber,
  child,
  parent,
  stack,
}: {
  below: WrittenPr | undefined;
  plan: RegistrationPlan;
  expectedStackNumber: number;
  child: WrittenPr;
  parent: WrittenPr;
  stack: GithubStack;
}): GithubVerbResult<ConfirmedRegistration> {
  const failures = confirmationFailures({ below, child, expectedStackNumber, parent, plan, stack });
  const entryNumbers = stack.entries.map((entry) => entry.number);
  const counted = { childNumber: child.number, entryNumbers, parentNumber: parent.number, stackNumber: stack.number };
  if (failures.length === 0) {
    return ok(counted);
  }
  const childStack = stackMembershipField({ pr: child });
  const parentStack = stackMembershipField({ pr: parent });
  const observed = { ...counted, childBase: child.baseRef, childStack, parentHead: parent.head.ref, parentStack };
  return err(GithubVerbErrors.registrationUnconfirmed({ observed: { ...observed, expectedStackNumber, failures } }));
}

/**
 * Describe the external write to the admit door.
 *
 * Carries `mode: "register-only"` and no head SHA at all: inventing one to fill a field this write never
 * reads would put a commit into the ledger record of an operation that touches no commit.
 *
 * @param home the state home whose door ledger records the attempt
 * @param plan the exact registration being admitted
 * @returns the external-write door request
 */
export function githubStackAdoptRegistrationDoorRequest({
  home,
  plan,
}: {
  home: string;
  plan: RegistrationPlan;
}): DoorRequest {
  const { child, parent, owner, repo } = plan.facts;
  return {
    action: { kind: "verb", noun: "github", verb: "stack adopt" },
    artifact: {
      baseBranch: child.baseRef,
      branch: child.head.ref,
      mode: "register-only",
      operation: plan.operation.kind,
      parentNumber: parent.number,
      prNumber: child.number,
      repo: `${owner}/${repo}`,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * The line describing what this invocation would do, before it does it.
 *
 * @param plan the registration decided
 * @returns the one preview line
 */
export function githubStackAdoptRegistrationPreviewLine({ plan }: { plan: RegistrationPlan }): string {
  const child = plan.facts.child.number;
  const parent = plan.facts.parent.number;
  if (plan.operation.kind === "create") {
    return (
      `would create native stack membership for entries [#${String(parent)}, #${String(child)}], then enrol ` +
      `PR #${String(child)} locally after confirmation.`
    );
  }
  if (plan.operation.kind === "add") {
    return (
      `would add PR #${String(child)} to native stack #${String(plan.operation.stackNumber)}, then enrol it ` +
      "locally after confirmation."
    );
  }
  return (
    `would confirm PR #${String(child)} and parent PR #${String(parent)} in native stack ` +
    `#${String(plan.operation.stackNumber)}, then enrol PR #${String(child)} locally; no native write is planned.`
  );
}

/**
 * The line a legitimate no-op prints — a base that is the repository default, or a base nobody has opened a
 * pull request for. Neither is a chain, so neither is a failure, and both must say plainly that nothing was
 * written rather than reading as a quiet success.
 *
 * @param decision the no-registration decision
 * @returns the one report line
 */
export function githubStackAdoptNoRegistrationLine({
  decision,
}: {
  decision: Extract<RegistrationDecision, { kind: "no-registration" }>;
}): string {
  if (decision.reason === "default-base") {
    return (
      `no registration: PR #${String(decision.childNumber)} is based on the repository default ` +
      `(${decision.baseRef}); no native membership or local enrolment was written.`
    );
  }
  return (
    `no registration: no open parent PR has head ${decision.baseRef}; no native membership or local ` +
    "enrolment was written."
  );
}

/**
 * The success report — exactly two lines, the second of which is the residue.
 *
 * The residue line is not decoration and is asserted by a test: a reader who takes "registered" to mean
 * "repaired" would push the parent and meet a carry refusal, or run `stack sync` and watch it stop at this
 * very entry. Saying what was NOT done is the difference between a claim and a claim a reader can act on.
 *
 * @param confirmation what the read-back proved
 * @returns the two report lines
 */
export function githubStackAdoptRegistrationReportLines({
  confirmation,
}: {
  confirmation: ConfirmedRegistration;
}): readonly string[] {
  const entries = confirmation.entryNumbers.map((number) => `#${String(number)}`).join(", ");
  return [
    `native membership confirmed: stack #${String(confirmation.stackNumber)}; entries [${entries}].`,
    "This registers membership only: the branch is not rebased; stack sync still cannot replay a " +
      "multi-commit entry; pushing the parent may now refuse on carry with entries above it " +
      "(--orphan-above is the existing route).",
  ];
}
