/**
 * `slopweaver github stack sync` — the pure decisions behind rebasing every stack entry back onto its base.
 *
 * Deliberately does NOT trust the REST stack entry's `base` field as a "recorded" vs "live" signal — that
 * semantic is unverified (an adversarial pass on this doc's own plan flagged it, and no live experiment has
 * settled it). Instead this plans from a fact the shell derives independently: whether the base branch's
 * live tip is a git ANCESTOR of the entry's current local head. That is exactly the question "does this
 * entry need a rebase" actually asks, and it needs no theory about what GitHub's own field means.
 */
import type { DoorRequest } from "../../../admit/types.js";
import type { GithubVerbResult } from "./errors.js";
import { parseStackCommonArgs, STACK_COMMON_FLAG_NAMES, type StackCommonArgs } from "./stackCommonArgs.js";

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_STACK_SYNC_FLAG_NAMES: readonly string[] = STACK_COMMON_FLAG_NAMES;

export type GithubStackSyncArgs = StackCommonArgs;

/**
 * Parse a sync invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after `github stack sync`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackSyncArgs({ argv }: { argv: readonly string[] }): GithubVerbResult<GithubStackSyncArgs> {
  return parseStackCommonArgs({ argv }).map((parsed) => parsed.args);
}

/**
 * One stack entry's facts, gathered by the shell before planning — never computed here. `worktreePath` is
 * `undefined` when no worktree could be resolved for `branch`; `baseIsAncestorOfHead` is the git ancestry
 * check itself, already performed, since this file makes no Git calls.
 */
export interface GithubStackSyncEntryFact {
  readonly stackNumber: number;
  /** 1-based, bottom to top — the entry's index in the stack's own ordered `pull_requests` array, plus one. */
  readonly position: number;
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string | undefined;
  readonly baseIsAncestorOfHead: boolean;
  readonly merged: boolean;
  /**
   * Whether this PR was registered into LOCAL stack state by `stack push` or `stack adopt` — never GitHub
   * authorship. A PR this operator authored but never pushed/adopted through this tool is exactly as foreign
   * to sync as one someone else authored: local-state registration scope, not authorship, is the boundary.
   */
  readonly registered: boolean;
  /**
   * GitHub's own authoritative commit count for this PR — `undefined` when it could not be read. Sync
   * refuses to rebase any entry that isn't exactly one commit: the safe rebase primitive replays a single,
   * GitHub-confirmed commit directly rather than resolving an ambiguous local commit RANGE, and that only
   * has one commit to replay when this is 1.
   */
  readonly commits: number | undefined;
  /**
   * The PR's live head SHA, from GitHub — the exact commit the rebase step replays, never derived locally.
   * `undefined` exactly when {@link commits} is (a merged entry, or a failed read) — a merged entry never
   * reaches the point where either is used.
   */
  readonly headSha: string | undefined;
  /**
   * What {@link worktreePath}'s own `HEAD` currently resolves to — `undefined` when there is no worktree to
   * read it from, or the read failed.
   *
   * Measured at PLAN time on purpose. The rebase primitive already refuses a worktree whose HEAD is not the
   * commit GitHub reports (`stackSquash.ts`'s preflight), but it does so mid-run — and for a push-time carry
   * that is after the entry BELOW has already gone to the remote, leaving a half-orphaned stack. MEASURED
   * while a five-branch stack was repaired by hand: two of its branches sat in worktrees nobody
   * had touched for days, which is the ordinary shape for a stack built across several
   * sessions. Asking here turns that into a refusal that sends nothing.
   */
  readonly worktreeHeadSha: string | undefined;
}

type GithubStackSyncStepReason = "base-moved" | "propagated";

/** One entry sync must rebase and push, in the order it must happen. */
export interface GithubStackSyncStep {
  readonly stackNumber: number;
  readonly position: number;
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly reason: GithubStackSyncStepReason;
  /** The exact, GitHub-confirmed commit to replay onto the fresh base — see {@link GithubStackSyncEntryFact}. */
  readonly headSha: string;
}

export interface GithubStackSyncPlan {
  readonly steps: readonly GithubStackSyncStep[];
  /** Every entry sync could not plan for, and why — a merged PR, a foreign author, an unresolved worktree. */
  readonly residue: readonly string[];
}

/** Group entries by stack number, each group ordered bottom to top. */
function groupedByStack({
  entries,
}: {
  entries: readonly GithubStackSyncEntryFact[];
}): ReadonlyMap<number, readonly GithubStackSyncEntryFact[]> {
  const byStack = new Map<number, GithubStackSyncEntryFact[]>();
  for (const entry of entries) {
    const list = byStack.get(entry.stackNumber);
    if (list === undefined) {
      byStack.set(entry.stackNumber, [entry]);
    } else {
      list.push(entry);
    }
  }
  const ordered = new Map<number, readonly GithubStackSyncEntryFact[]>();
  for (const [stackNumber, list] of byStack) {
    ordered.set(
      stackNumber,
      list.toSorted((a, b) => a.position - b.position),
    );
  }
  return ordered;
}

/**
 * How one entry is named in every line a stack verb prints about it.
 *
 * @param entry the entry to name
 * @returns the stack, position and pull-request label
 */
export function stackEntryLabel({ entry }: { entry: GithubStackSyncEntryFact }): string {
  return `stack #${String(entry.stackNumber)} position ${String(entry.position)} (PR #${String(entry.pullRequestNumber)})`;
}

/** How a refusal names the worktree's HEAD — an unread one is a named state, never a blank in the line. */
function worktreeHeadLabel({ entry }: { entry: GithubStackSyncEntryFact }): string {
  const headSha = entry.worktreeHeadSha;
  if (headSha === undefined) {
    return "an unreadable HEAD";
  }
  return headSha;
}

/**
 * Why one entry cannot be safely planned, if any — every reason here also stops the rest of the stack
 * above it, since a later entry's own base is this one's (possibly still wrong) head.
 *
 * Shared with the carry gate (`./stackCarryCore.ts`) rather than restated there: "can this entry be safely
 * rebased" has to have exactly one answer, or a push-time carry and `stack sync` will disagree about the
 * same entry on the same day.
 *
 * @param label how the entry is named in the returned reason
 * @returns the reason, or nothing when the entry can be planned
 */
export function stackEntryUnplannableReason({
  entry,
  label,
}: {
  entry: GithubStackSyncEntryFact;
  label: string;
}): string | undefined {
  if (!entry.registered) {
    return `${label} is not registered in local stack state — refusing to plan the rest of this stack above it`;
  }
  if (entry.worktreePath === undefined) {
    return `${label} has no resolvable worktree — refusing to plan the rest of this stack above it`;
  }
  if (entry.commits !== 1 || entry.headSha === undefined) {
    const seen = entry.commits === undefined ? "could not be read" : `has ${String(entry.commits)}`;
    return (
      `${label} ${seen} commit(s) — sync only rebases a PR that is exactly one commit; ` +
      `refusing to plan the rest of this stack above it`
    );
  }
  if (entry.worktreeHeadSha !== entry.headSha) {
    return (
      `${label}'s worktree is at ${worktreeHeadLabel({ entry })}, but GitHub reports its head ` +
      `is ${entry.headSha} — fetch and check out that exact commit; refusing to plan the rest of this stack above it`
    );
  }
  return undefined;
}

/** Plan one stack's steps bottom-up, stopping (not skipping past) the first entry it cannot safely touch. */
function planOneStack({
  ordered,
  steps,
  residue,
}: {
  ordered: readonly GithubStackSyncEntryFact[];
  steps: GithubStackSyncStep[];
  residue: string[];
}): void {
  let propagating = false;
  for (const entry of ordered) {
    const label = stackEntryLabel({ entry });
    if (entry.merged) {
      residue.push(`${label} is merged`);
      continue;
    }
    const reason = stackEntryUnplannableReason({ entry, label });
    if (reason !== undefined) {
      residue.push(reason);
      return;
    }
    // stackEntryUnplannableReason returning undefined already proved both are defined; TS cannot see that
    // across the function call, so this is a known-safe non-null assertion, not an unchecked one.
    if (propagating || !entry.baseIsAncestorOfHead) {
      steps.push({
        baseBranch: entry.baseBranch,
        branch: entry.branch,
        headSha: entry.headSha!,
        position: entry.position,
        pullRequestNumber: entry.pullRequestNumber,
        reason: propagating ? "propagated" : "base-moved",
        stackNumber: entry.stackNumber,
        worktreePath: entry.worktreePath!,
      });
      propagating = true;
    }
  }
}

/**
 * Decide which entries need a rebase, bottom-up, from already-gathered facts.
 *
 * @param entries every stack entry sync discovered, across every stack the operator is part of
 * @returns the ordered rebase steps, plus residue for whatever could not be planned
 */
export function githubStackSyncPlan({
  entries,
}: {
  entries: readonly GithubStackSyncEntryFact[];
}): GithubStackSyncPlan {
  const steps: GithubStackSyncStep[] = [];
  const residue: string[] = [];
  for (const ordered of groupedByStack({ entries }).values()) {
    planOneStack({ ordered, residue, steps });
  }
  return { residue, steps };
}

/**
 * Lines describing the plan, printed before any Git or network effect.
 *
 * @param plan the sync plan
 * @returns the report lines, in order
 */
export function githubStackSyncReportLines({ plan }: { plan: GithubStackSyncPlan }): readonly string[] {
  if (plan.steps.length === 0 && plan.residue.length === 0) {
    return ["nothing to sync: every stack you're part of is already based on its live parent."];
  }
  const lines: string[] = [];
  for (const step of plan.steps) {
    lines.push(
      `would rebase ${step.branch} (PR #${String(step.pullRequestNumber)}, stack #${String(step.stackNumber)} ` +
        `position ${String(step.position)}) onto ${step.baseBranch} — ${step.reason}`,
    );
  }
  for (const reason of plan.residue) {
    lines.push(`residue: ${reason}`);
  }
  return lines;
}

/**
 * Describe the external write to the admit door.
 *
 * @param home the state home whose door ledger records the attempt
 * @param plan the sync plan being admitted
 * @returns the external-write door request
 */
export function githubStackSyncDoorRequest({ home, plan }: { home: string; plan: GithubStackSyncPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack sync" },
    artifact: {
      branches: plan.steps.map((step) => step.branch),
      stackNumbers: [...new Set(plan.steps.map((step) => step.stackNumber))],
    },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
