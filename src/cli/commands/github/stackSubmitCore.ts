/**
 * `slopweaver github stack submit` — what may be pushed, decided before anything is sent.
 *
 * ## All or nothing, and what that can honestly mean
 *
 * Owner ruling: submit fails when a stack is in a bad state, refusing until the local issue is reconciled,
 * and it leaves no stack behind — all or nothing. GitHub offers
 * no transaction across branches — a push moves one ref at a time — so the guarantee this can actually make
 * is **all-or-nothing ADMISSION**: not one branch is sent until every branch in the whole forest has passed
 * every check. A transport that then fails at branch N leaves 1..N-1 on the remote, and this says so
 * plainly rather than claiming a rollback it cannot perform.
 *
 * That is a much stronger guarantee than it sounds, because it is the shape that prevents the failure the
 * ruling targets: a stack orphaned by a CONFLICT discovered mid-carry, after two
 * branches were already public. A conflict is found here at restack time, before this verb runs at all, and
 * a forest carrying one is refused whole.
 *
 * ## Refusing a moved remote is the owner's ruling, not caution
 *
 * When a remote branch has moved beyond what local state says it was, stack submit fails and says that branch
 * differs on the remote; to push it anyway, rerun with `--force`.
 * That is the ONE issue `--force` waives, and it waives it only where the live head is genuinely readable:
 * a branch whose remote ref has vanished is not a moved remote, it is a missing one, and no flag here
 * makes that safe.
 *
 * Nothing in this module touches Git or the network. `./stackSubmitRun.ts` gathers the facts and pushes.
 */
import type { PrState, PrStateEntry } from "../../../outbound/github/prStateCore.js";
import { remoteHasMoved } from "../../../outbound/github/prStateCore.js";
import { planRestackForest } from "./restackForestCore.js";

/** What the shell measured about one pull request at submit time. */
export interface SubmitFact {
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  /** What the remote says this branch's tip is NOW, or `undefined` when the remote has no such ref. */
  readonly liveHeadSha: string | undefined;
  /** What the staged ref this row prepared still points at, or `undefined` when it is gone. */
  readonly stagedSha: string | undefined;
}

/**
 * One reason a submit refuses. Only `REMOTE_MOVED` is ever waived, and only by `--force`.
 *
 * @internal a field of {@link SubmitIssue}; no caller outside this verb names the type.
 */
export type SubmitIssueCode =
  "REMOTE_MOVED" | "REMOTE_REF_MISSING" | "NOT_PREPARED" | "STAGED_REF_MOVED" | "INVENTORY_CHANGED";

/** One refusal, naming the branch it is about where there is one. */
export interface SubmitIssue {
  readonly code: SubmitIssueCode;
  readonly message: string;
  readonly branch: string | undefined;
}

/** One branch this submit would push, in the order it must happen. */
export interface SubmitPush {
  readonly pullRequestNumber: number;
  readonly branch: string;
  /** The lease: the push is refused by the remote unless the branch is still exactly this. */
  readonly expectedRemoteSha: string;
  readonly toSha: string;
}

/** What a submit would do, or every reason it will do nothing. */
export interface SubmitPlan {
  readonly pushes: readonly SubmitPush[];
  /** Issues `--force` waived on this invocation, reported rather than hidden. */
  readonly waived: readonly SubmitIssue[];
}

/** The issue a row's own preparation raises, if any. */
function preparationIssue({ entry }: { entry: PrStateEntry }): SubmitIssue | undefined {
  if (entry.preparation.kind === "blocked") {
    return {
      branch: entry.headRef,
      code: "NOT_PREPARED",
      message: `#${String(entry.number)} (${entry.headRef}) is not prepared: ${entry.preparation.reason}`,
    };
  }
  return undefined;
}

/** The issue one row's live remote state raises, if any. */
function remoteIssue({ entry, fact }: { entry: PrStateEntry; fact: SubmitFact }): SubmitIssue | undefined {
  if (fact.liveHeadSha === undefined) {
    return {
      branch: entry.headRef,
      code: "REMOTE_REF_MISSING",
      message: `#${String(entry.number)} (${entry.headRef}) has no branch on the remote at all`,
    };
  }
  if (remoteHasMoved({ entry, liveHeadSha: fact.liveHeadSha })) {
    return {
      branch: entry.headRef,
      code: "REMOTE_MOVED",
      message:
        `#${String(entry.number)} (${entry.headRef}) is ${fact.liveHeadSha} on the remote, not the ` +
        `${entry.remoteHeadSha} your local state recorded — someone else pushed to it`,
    };
  }
  return undefined;
}

/**
 * How a refusal names what a ref holds: its commit, or "nothing" for a ref that is gone. A gone ref is a state
 * submit reports — a staged ref deleted since the restack, a branch the remote no longer carries — never a
 * blank in the line.
 *
 * @param sha the ref's commit, as read
 * @returns the commit, or "nothing" when the ref was not there
 */
export function refHolding({ sha }: { sha: string | undefined }): string {
  if (sha === undefined) {
    return "nothing";
  }
  return sha;
}

/** The issue one row's staged commits raise, if any. */
function stagedIssue({ entry, fact }: { entry: PrStateEntry; fact: SubmitFact }): SubmitIssue | undefined {
  if (entry.preparation.kind !== "ready") {
    return undefined;
  }
  if (fact.stagedSha !== entry.preparation.preparedSha) {
    return {
      branch: entry.headRef,
      code: "STAGED_REF_MOVED",
      message:
        `#${String(entry.number)} (${entry.headRef}) prepared ${entry.preparation.preparedSha} at ` +
        `${entry.preparation.preparedRef}, which now holds ${refHolding({ sha: fact.stagedSha })} — restack it again`,
    };
  }
  return undefined;
}

/**
 * Whether the world still matches the snapshot's own inventory.
 *
 * A pull request that opened, merged or was retargeted since the snapshot was cut means the snapshot no
 * longer describes "every open pull request of yours", and a submit whose whole claim is completeness cannot
 * proceed on a stale one. This is a re-restack, not a `--force`: there is nothing to acknowledge, the local
 * picture is simply old.
 */
function inventoryIssues({ facts, state }: { facts: readonly SubmitFact[]; state: PrState }): readonly SubmitIssue[] {
  const issues: SubmitIssue[] = [];
  const byNumber = new Map(facts.map((fact) => [fact.number, fact]));
  for (const entry of state.entries) {
    const fact = byNumber.get(entry.number);
    if (fact === undefined) {
      issues.push({
        branch: entry.headRef,
        code: "INVENTORY_CHANGED",
        message: `#${String(entry.number)} (${entry.headRef}) is in your local state but is no longer open`,
      });
      continue;
    }
    if (fact.headRef !== entry.headRef || fact.baseRef !== entry.baseRef) {
      issues.push({
        branch: entry.headRef,
        code: "INVENTORY_CHANGED",
        message:
          `#${String(entry.number)} is ${fact.headRef} onto ${fact.baseRef} now, not the ` +
          `${entry.headRef} onto ${entry.baseRef} your local state recorded`,
      });
    }
  }
  const known = new Set(state.entries.map((entry) => entry.number));
  for (const fact of facts) {
    if (!known.has(fact.number)) {
      issues.push({
        branch: fact.headRef,
        code: "INVENTORY_CHANGED",
        message: `#${String(fact.number)} (${fact.headRef}) is open but your local state has never seen it`,
      });
    }
  }
  return issues;
}

/** The push order: the same parent-before-child walk a restack used, rebuilt from the snapshot's own rows. */
function pushOrder({ state }: { state: PrState }): readonly string[] {
  const forest = planRestackForest({
    pullRequests: state.entries.map((entry) => ({
      baseIsAncestorOfHead: true,
      baseRef: entry.baseRef,
      headRef: entry.headRef,
      headSha: entry.remoteHeadSha,
      number: entry.number,
    })),
  });
  return forest.trees.flatMap((tree) => tree.nodes.map((node) => node.branch));
}

/**
 * Decide what one submit may push, from the recorded snapshot and what the remote says now.
 *
 * Every issue is collected, never the first: an author who has to re-run this once per problem learns the
 * shape of their repository one refusal at a time. A single unwaived issue means NOTHING is pushed.
 *
 * @param force whether the caller passed `--force`, which waives a moved remote and nothing else
 * @param facts what the shell measured about each open pull request at submit time
 * @param state the snapshot the last restack published
 * @returns the ordered pushes when every check passed, or every issue that stopped it
 */
export function planStackSubmit({
  facts,
  force,
  state,
}: {
  facts: readonly SubmitFact[];
  force: boolean;
  state: PrState;
}): { readonly plan: SubmitPlan | undefined; readonly issues: readonly SubmitIssue[] } {
  const issues: SubmitIssue[] = [...inventoryIssues({ facts, state })];
  const waived: SubmitIssue[] = [];
  const byNumber = new Map(facts.map((fact) => [fact.number, fact]));
  const pushable = new Map<string, SubmitPush>();
  for (const entry of state.entries) {
    const fact = byNumber.get(entry.number);
    if (fact === undefined) {
      continue;
    }
    judgeOneRow({ entry, fact, force, issues, pushable, waived });
  }
  if (issues.length > 0) {
    return { issues, plan: undefined };
  }
  const ordered = pushOrder({ state })
    .map((branch) => pushable.get(branch))
    .filter((push): push is SubmitPush => push !== undefined);
  return { issues: [], plan: { pushes: ordered, waived } };
}

/** Judge one recorded row against what the remote and the staged ref say now, collecting every issue. */
function judgeOneRow({
  entry,
  fact,
  force,
  issues,
  pushable,
  waived,
}: {
  entry: PrStateEntry;
  fact: SubmitFact;
  force: boolean;
  issues: SubmitIssue[];
  pushable: Map<string, SubmitPush>;
  waived: SubmitIssue[];
}): void {
  for (const issue of [preparationIssue({ entry }), stagedIssue({ entry, fact })]) {
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  const remote = remoteIssue({ entry, fact });
  const waivable = remote?.code === "REMOTE_MOVED" && force;
  if (remote !== undefined && !waivable) {
    issues.push(remote);
    return;
  }
  if (remote !== undefined) {
    waived.push(remote);
  }
  if (entry.preparation.kind === "ready" && fact.liveHeadSha !== undefined) {
    pushable.set(entry.headRef, {
      branch: entry.headRef,
      expectedRemoteSha: fact.liveHeadSha,
      pullRequestNumber: entry.number,
      toSha: entry.preparation.preparedSha,
    });
  }
}

/**
 * The lines a refusal prints, every issue named.
 *
 * @param issues what stopped the submit
 * @returns the report lines, in order
 */
export function submitRefusalLines({ issues }: { issues: readonly SubmitIssue[] }): readonly string[] {
  const lines = [
    `refused: ${String(issues.length)} problem(s) stand between your local state and the remote, so NOTHING was pushed.`,
  ];
  for (const issue of issues) {
    lines.push(`  [${issue.code}] ${issue.message}`);
  }
  if (issues.some((issue) => issue.code === "REMOTE_MOVED")) {
    lines.push("  a moved remote is the one thing --force accepts; every other line above needs a fresh restack.");
  }
  return lines;
}

/** What one push actually did. */
export type PushOutcome =
  | { readonly kind: "pushed"; readonly push: SubmitPush }
  | { readonly kind: "failed"; readonly push: SubmitPush; readonly reason: string };

/**
 * The three groups a partial submit has to report: what went, what failed, and what was never attempted.
 *
 * @param outcomes what each attempted push produced
 * @param plan the plan those attempts came from
 * @returns the report lines, in order
 */
export function submitOutcomeLines({
  outcomes,
  plan,
}: {
  outcomes: readonly PushOutcome[];
  plan: SubmitPlan;
}): readonly string[] {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "pushed") {
      lines.push(
        `pushed ${outcome.push.branch} (PR #${String(outcome.push.pullRequestNumber)}) -> ${outcome.push.toSha}`,
      );
      continue;
    }
    lines.push(`FAILED ${outcome.push.branch} (PR #${String(outcome.push.pullRequestNumber)}): ${outcome.reason}`);
  }
  const attempted = outcomes.length;
  const notAttempted = plan.pushes.slice(attempted);
  for (const push of notAttempted) {
    lines.push(`not attempted: ${push.branch} (PR #${String(push.pullRequestNumber)})`);
  }
  if (notAttempted.length > 0 || outcomes.some((outcome) => outcome.kind === "failed")) {
    lines.push(
      "your local state is UNCHANGED, so the branches above that did land will read as a moved remote next " +
        "time — which is exactly what a partial push is. Look at them, then re-run with --force.",
    );
  }
  return lines;
}

/**
 * The snapshot to write after a fully confirmed submit: every pushed row now sits at what was sent.
 *
 * @param pushed the pushes that landed and were read back
 * @returns the advanced snapshot
 */
export function advancedState({
  nowIso,
  pushed,
  state,
}: {
  nowIso: string;
  pushed: readonly SubmitPush[];
  state: PrState;
}): PrState {
  const byBranch = new Map(pushed.map((push) => [push.branch, push]));
  return {
    entries: state.entries.map((entry) => {
      const push = byBranch.get(entry.headRef);
      if (push === undefined) {
        return entry;
      }
      return { ...entry, preparation: { kind: "unchanged" }, remoteHeadSha: push.toSha };
    }),
    header: { ...state.header, recordedAtIso: nowIso },
  };
}
