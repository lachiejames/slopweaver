/**
 * The carry gate's pure half — what a push of one stack entry must do to every entry ABOVE it.
 *
 * ## Why this exists
 *
 * Owner ruling: any change to a pull request in a stack pushes up the whole stack, and the tooling makes
 * pushing one pull request in the middle of a stack structurally impossible, because that always causes
 * problems.
 *
 * MEASURED on the pull request that produced that ruling, position 1 of a native stack of five entries
 * (base `staging`): `github push --force-with-lease` moved its head, recorded as one `verb:github.push` door
 * record. Every entry above it still carried the commit it had days earlier. Nothing carried them, because
 * carrying a stack was a SEPARATE verb a session had to remember to run: `verb:github.stack sync` had
 * **13 records in the whole door ledger**, against 2,364 `verb:github.push` and 282 `verb:github.stack push`.
 * Reproduce the counts:
 *
 * ```bash
 * grep -c '"action":"verb:github.stack sync"' "$SLOPWEAVER_HOME/ledgers/door.jsonl"
 * grep -c '"action":"verb:github.push"' "$SLOPWEAVER_HOME/ledgers/door.jsonl"
 * ```
 *
 * So the defect was never one verb behaving badly. It was that the safe operation and the dangerous one were
 * two different commands with the dangerous one three characters shorter. This module is the fix: the push
 * verbs now ask this core what sits above them, and either carry it or refuse by name.
 *
 * ## Orphaning is an ANCESTRY fact, never a mergeability one
 *
 * MEASURED on the same five entries immediately after that push: only positions 2 and 5 read `CONFLICTING`,
 * while positions 3 and 4 still read `MERGEABLE` — GitHub measures each entry against its OWN parent, and
 * those parents had not moved yet. All four were nonetheless orphaned:
 * `git merge-base --is-ancestor <new head> <child head>` answered false for every one. So a check that
 * re-reads mergeability across a stack UNDER-REPORTS the damage by half, which is exactly why every fact
 * this core plans from comes from `stackFacts.ts`'s ancestry measurement rather than from GitHub's verdict.
 *
 * ## The two answers, and why an orphan is named rather than counted
 *
 * A refusal that says "3 entries would be orphaned" tells an author nothing they can act on. A refusal that
 * names the pull request on branch `mx-2386-…`, and says it has two commits when the safe rebase primitive replays
 * exactly one, points at the single thing to fix. That is the whole reason {@link StackCarryOrphan} carries a
 * `why` per entry instead of a count.
 */
import type { GithubStackSyncEntryFact, GithubStackSyncStep } from "./stackSyncCore.js";
import { stackEntryLabel, stackEntryUnplannableReason } from "./stackSyncCore.js";

/** One entry above the pushed branch that this push would leave behind, and the exact reason it cannot be carried. */
export interface StackCarryOrphan {
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly why: string;
}

/** What a push must do about everything stacked above the branch it is sending. */
export interface GithubStackCarryPlan {
  /** The entries this push CAN carry, bottom-up — rebased onto their new base and pushed, in this order. */
  readonly steps: readonly GithubStackSyncStep[];
  /** The entries it cannot, each named with why; a non-empty list is what turns the push into a refusal. */
  readonly orphans: readonly StackCarryOrphan[];
  /** Entries above that need nothing done to them, and why — a merged entry is the only such case. */
  readonly skipped: readonly string[];
}

/**
 * Plan the carry for one push, from the already-measured facts of the entries above it.
 *
 * Everything above the pushed branch propagates UNCONDITIONALLY — unlike `stack sync`, which starts
 * propagating only at the first entry whose base has actually moved. The difference is not a policy choice:
 * this runs against a branch that is about to be force-pushed, so the entry directly above it is losing its
 * base whether or not git can see that yet, and every entry above THAT one loses its own base as soon as the
 * step below it is rebased.
 *
 * Once one entry cannot be carried, neither can anything above it — that entry's own head is about to become
 * the base of the next one, and it is not moving. So the walk stops there and everything from that point up
 * is an orphan, exactly as `stack sync`'s planner stops rather than skipping past.
 *
 * @param entriesAbove every stack entry above the branch being pushed, ordered bottom to top
 * @returns the carryable steps, the entries that would be orphaned, and the merged entries skipped
 */
export function githubStackCarryPlan({
  entriesAbove,
}: {
  entriesAbove: readonly GithubStackSyncEntryFact[];
}): GithubStackCarryPlan {
  const steps: GithubStackSyncStep[] = [];
  const orphans: StackCarryOrphan[] = [];
  const skipped: string[] = [];
  let blocked = false;
  for (const entry of entriesAbove) {
    const label = stackEntryLabel({ entry });
    if (entry.merged) {
      skipped.push(`${label} is merged`);
      continue;
    }
    const reason = blocked
      ? `${label} sits above an entry this push cannot carry, so its own base will not move either`
      : stackEntryUnplannableReason({ entry, label });
    if (reason !== undefined) {
      blocked = true;
      orphans.push({ branch: entry.branch, pullRequestNumber: entry.pullRequestNumber, why: reason });
      continue;
    }
    // stackEntryUnplannableReason returning undefined already proved both are defined; TS cannot see that
    // across the function call, so these are known-safe non-null assertions, not unchecked ones.
    steps.push({
      baseBranch: entry.baseBranch,
      branch: entry.branch,
      headSha: entry.headSha!,
      position: entry.position,
      pullRequestNumber: entry.pullRequestNumber,
      reason: "propagated",
      stackNumber: entry.stackNumber,
      worktreePath: entry.worktreePath!,
    });
  }
  return { orphans, skipped, steps };
}

/**
 * Whether the caller's `--orphan-above` acknowledgement covers EXACTLY the entries this push would orphan.
 *
 * Exact set equality, not "at least" — a number naming an entry that is not an orphan means the author is
 * describing a different push than the one they are about to make, and the whole value of this flag is that
 * it cannot be typed by accident. It is the break-glass, so it has to be impossible to hold open.
 *
 * @param accepted the pull-request numbers the caller passed to `--orphan-above`
 * @param orphans the entries the plan says would be orphaned
 * @returns nothing when the acknowledgement matches, or the refusal lines to print
 */
export function stackCarryAcknowledgementRefusal({
  accepted,
  orphans,
}: {
  accepted: readonly number[];
  orphans: readonly StackCarryOrphan[];
}): readonly string[] | undefined {
  const wanted = new Set(orphans.map((orphan) => orphan.pullRequestNumber));
  const given = new Set(accepted);
  const missing = [...wanted].filter((number) => !given.has(number));
  const extra = [...given].filter((number) => !wanted.has(number));
  if (missing.length === 0 && extra.length === 0) {
    return undefined;
  }
  const lines: string[] = [];
  if (missing.length > 0) {
    lines.push(`--orphan-above does not name ${missing.map((n) => `#${String(n)}`).join(", ")}`);
  }
  if (extra.length > 0) {
    lines.push(
      `--orphan-above names ${extra.map((n) => `#${String(n)}`).join(", ")}, which this push would not orphan`,
    );
  }
  lines.push(
    orphans.length === 0
      ? "this push orphans nothing, so --orphan-above has nothing to acknowledge"
      : `pass --orphan-above ${orphans.map((orphan) => String(orphan.pullRequestNumber)).join(",")} to accept exactly this`,
  );
  return lines;
}

/**
 * The refusal a push prints instead of orphaning entries above it, naming every one and why.
 *
 * @param branch the branch being pushed, so the message says what it is refusing rather than only what it found
 * @param orphans the entries that would be left behind
 * @returns the refusal lines, in order
 */
export function stackCarryRefusalLines({
  branch,
  orphans,
}: {
  branch: string;
  orphans: readonly StackCarryOrphan[];
}): readonly string[] {
  const lines = [
    `refused: pushing ${branch} would orphan ${String(orphans.length)} pull request(s) stacked above it, ` +
      "and this push cannot carry them:",
  ];
  for (const orphan of orphans) {
    lines.push(`  #${String(orphan.pullRequestNumber)} (${orphan.branch}) — ${orphan.why}`);
  }
  lines.push(
    "fix what each one reports, or accept the orphaning deliberately with " +
      `--orphan-above ${orphans.map((orphan) => String(orphan.pullRequestNumber)).join(",")}`,
  );
  return lines;
}

/**
 * Lines describing what the carry will do, printed before the push that triggers it.
 *
 * @param plan the carry plan
 * @returns the report lines, empty when there is nothing above to carry
 */
export function stackCarryReportLines({ plan }: { plan: GithubStackCarryPlan }): readonly string[] {
  const lines: string[] = [];
  for (const step of plan.steps) {
    lines.push(
      `carry: would rebase ${step.branch} (PR #${String(step.pullRequestNumber)}, stack #${String(step.stackNumber)} ` +
        `position ${String(step.position)}) onto ${step.baseBranch} and push it`,
    );
  }
  for (const reason of plan.skipped) {
    lines.push(`carry: skipping ${reason}`);
  }
  return lines;
}

/** The flag both push verbs accept to accept an orphaning deliberately, by number. */
export const ORPHAN_ABOVE_FLAG = "orphan-above";

/**
 * Parse `--orphan-above <n,n>` into the pull-request numbers it names.
 *
 * Shared by both push verbs so the break-glass has one spelling and one set of usage errors. Every entry
 * must be a positive integer — a typo that silently parsed as `NaN` would compare unequal to every real
 * orphan and produce a refusal about the wrong thing.
 *
 * @param raw the flag's value, absent when it was not passed
 * @param errors the invocation's error list, appended to rather than returned so the caller reports once
 * @returns the numbers named, empty when the flag was absent
 */
export function parseOrphanAbove({ raw, errors }: { raw: string | undefined; errors: string[] }): readonly number[] {
  if (raw === undefined) {
    return [];
  }
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    errors.push(`--${ORPHAN_ABOVE_FLAG} must name at least one pull-request number`);
    return [];
  }
  const numbers: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`--${ORPHAN_ABOVE_FLAG} takes pull-request numbers; "${part}" is not one`);
      continue;
    }
    numbers.push(value);
  }
  return numbers;
}
