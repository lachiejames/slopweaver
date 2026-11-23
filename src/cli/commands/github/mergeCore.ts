/**
 * `slopweaver github merge` — every DECISION this verb makes, as pure functions. The effectful shell in
 * `./mergeRun.ts` resolves the repository, shells git and reads the orchestration board; nothing here
 * touches the network, the clock or the filesystem. Parsing the verb's arguments is `./mergeArgs.js`'s.
 *
 * ## This file REPORTS. `--admin` is what merges, and it lives elsewhere.
 *
 * There is no GitHub write plumbing here at all — no token, no `pulls.merge` call. What exists is the guard
 * from `../../../outbound/github/mergeGuard.js`: it measures the diff, the base branch's own history since
 * the fork, and every orchestration-doc probe, and refuses (a non-zero exit) while any finding stands
 * unacknowledged. `docsBudgetFindingsFromSweep` below adds one more source: the always-on documentation set
 * and every skill body, re-measured against the tree a squash-merge would actually produce (see
 * `../../../outbound/github/docsBudgetSweep.js`), because a budget that passed on `head` alone can still be
 * blown by combining with what `base` gained while `head` was in flight. The merge itself is `--admin`'s, and
 * every decision it makes is in `./mergeAdminCore.js` with its effects in `./mergeAdminRun.js` — which is why
 * this file stayed pure when the verb gained the ability to merge.
 *
 * **A merge made any other way still bypasses this guard entirely.** `gh pr merge`, and an administrator's
 * override in the GitHub UI, are outside it — for the same reason this repository's own `PreToolUse` hook
 * cannot be trusted as enforcement (see `AGENTS.md` § "One door"): running this verb is a discipline the
 * operator chooses, not a fence GitHub enforces. What `--admin` changes is that the disciplined path now
 * exists inside Slopweaver, so choosing it no longer means leaving the door.
 *
 * ## Acknowledgement, not judgement
 *
 * This verb runs no model, so it cannot decide whether a finding is acceptable — only the visible session
 * can. The escape is explicit: `--acknowledge <subject,subject,...>` accepts named findings by their exact
 * subject (a path, or an orchestration-doc slug), and `--acknowledge-all` accepts every finding but MUST be
 * paired with `--reason "…"` so the acceptance is visible in the printed report rather than a bare flag.
 * Every finding is always printed, acknowledged or not — acknowledging a finding silences the refusal, never
 * the visibility of what was accepted.
 */
import { budgetOverruns, type DocBudget } from "../../../canon/alwaysOnDocs.js";
import type { MergeDocsBudgetSweep } from "../../../outbound/github/docsBudgetSweep.js";
import type { MergeFinding, MergeFindingKind, ProbeRegression } from "../../../outbound/github/mergeGuard.js";
import type { MergeProbeSweep } from "../../../outbound/github/probeSweep.js";

/** The acknowledgement subject for a report computed against the LOCAL base ref rather than the remote tip. */
const BASE_UNRESOLVED_SUBJECT = "base-unresolved";

/**
 * How the base this report measured against was resolved.
 *
 * `--base main` names a BRANCH, and handed to git as-is it resolves the LOCAL
 * ref. Every worktree on the owner's machine is routinely behind its remote, and a report measured against the
 * stale local ref attributes another session's landed pull
 * request to yours — a 146-line deletion in a file the pull request does not touch at all. So the base is
 * resolved against the remote tip, exactly as `./baseFreshnessRun.js` already fetches it, and when that
 * fetch cannot happen the report says so IN the report rather than quietly measuring the wrong tree.
 *
 * Two arms, so a local fallback with no reason for it cannot be built.
 */
export type ResolvedBase =
  | (ResolvedRevision & {
      /** The remote its tip was fetched from. */
      readonly fetchedFrom: string;
      readonly why: undefined;
    })
  | (ResolvedRevision & {
      /** Absent: the local ref is being measured instead. */
      readonly fetchedFrom: undefined;
      /** Why the remote tip could not be fetched. */
      readonly why: string;
    });

/** What both arms of {@link ResolvedBase} name: the branch and the revision measured. */
interface ResolvedRevision {
  /** The base branch as the remote names it — `main`, `origin/main` and `refs/heads/main` all normalise here. */
  readonly branch: string;
  /** The exact revision handed to the measurement: the fetched remote tip, or the local ref as a fallback. */
  readonly revision: string;
}

/**
 * The finding for a report that fell back to the LOCAL base ref, or none when the remote tip was fetched.
 *
 * A finding rather than a hard refusal, for the reason `./baseFreshnessCore.js` states: fail loudly, always
 * leave an explicit escape hatch. Offline, or with no Git transport, the report is still worth having — but
 * it must never read like one taken against the tip this change will actually land on.
 *
 * @param resolved how the base was resolved
 * @returns the single finding, or an empty list when the remote tip was measured
 */
export function baseUnresolvedFindings({ resolved }: { resolved: ResolvedBase }): readonly MergeFinding[] {
  if (resolved.fetchedFrom !== undefined) {
    return [];
  }
  return [
    {
      detail:
        `the remote tip of \`${resolved.branch}\` could not be fetched, so every finding above was measured ` +
        `against the LOCAL ref \`${resolved.revision}\` instead: ${resolved.why}`,
      kind: "base-unresolved",
      subject: BASE_UNRESOLVED_SUBJECT,
    },
  ];
}

/**
 * The lines naming exactly which tree, which base commit and which head commit this report measured.
 *
 * Printed before every finding, always. The failure class this verb is one fix of is *a verdict computed
 * against the wrong tree, delivered in the voice of a verdict about yours* — and its defining property is
 * that a reader cannot tell such a verdict from a true one. These three lines are what make that difference
 * visible: a wrong answer becomes a wrong ANSWER, checkable in one `git rev-parse`, rather than only a
 * wrong verdict.
 *
 * @param repoRoot the checkout every measurement was taken in
 * @param resolved how the base was resolved
 * @param baseSha the commit the base revision resolved to
 * @param head the head ref as the caller named it
 * @param headSha the commit that head resolved to
 * @returns the three identity lines
 */
export function measuredTreeLines({
  repoRoot,
  resolved,
  baseSha,
  head,
  headSha,
}: {
  repoRoot: string;
  resolved: ResolvedBase;
  baseSha: string;
  head: string;
  headSha: string;
}): readonly string[] {
  const provenance =
    resolved.fetchedFrom === undefined
      ? `LOCAL ref — the remote tip was NOT fetched: ${resolved.why}`
      : `${resolved.fetchedFrom}/${resolved.branch}, fetched just now`;
  return [
    `measured in tree: ${repoRoot}`,
    `measured base:    ${resolved.branch} = ${baseSha}  (${provenance})`,
    `measured head:    ${head} = ${headSha}`,
  ];
}

/**
 * Adapt a board sweep into the `regressions` `mergeGuardFindings` expects.
 *
 * A `not-evaluated` sweep becomes exactly ONE synthetic regression naming the unreachable board rather than
 * an empty list — so a merge guard that could not examine the board can never report as clean as one that
 * examined it and found nothing. This is the one place `not-evaluated` is turned into a finding at all;
 * everywhere else it stays its own outcome, never folded into pass or fail.
 *
 * @param sweep what sweeping the orchestration board concluded
 * @returns the regressions to feed `mergeGuardFindings`
 */
export function regressionsFromSweep({ sweep }: { sweep: MergeProbeSweep }): readonly ProbeRegression[] {
  return sweep.kind === "evaluated"
    ? sweep.regressions
    : [{ probe: `orchestration board not evaluated: ${sweep.reason}`, slug: "orchestration-board" }];
}

/**
 * Adapt a docs-budget sweep into findings — the same "never silently clean" shape `regressionsFromSweep` uses,
 * but built directly as {@link MergeFinding}s rather than a `ProbeRegression`-shaped intermediate: a budget
 * that could not be evaluated has no measurement to attach to a `DocBudget`'s numeric fields, so forging one
 * to route it through {@link budgetOverruns}'s message would print a number nobody measured.
 *
 * @param sweep what sweeping the merged tree's documents concluded
 * @returns one finding per exceeded budget, or a single finding when the sweep could not run at all
 */
export function docsBudgetFindingsFromSweep({ sweep }: { sweep: MergeDocsBudgetSweep }): readonly MergeFinding[] {
  if (sweep.kind === "not-evaluated") {
    return [{ detail: sweep.reason, kind: "docs-budget", subject: "always-on-docs-budget" }];
  }
  const exceeded: DocBudget[] = sweep.budgets.filter((entry) => entry.measured > entry.budget);
  return exceeded.map((entry) => ({
    detail: budgetOverruns({ budgets: [entry] })[0]!,
    kind: "docs-budget",
    subject: entry.label,
  }));
}

/**
 * Findings not covered by either acknowledgement mechanism.
 *
 * @param findings every finding the guard produced
 * @param acknowledge exact subjects the caller accepted individually
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @returns the findings still standing between this invocation and a clean exit
 */
export function unacknowledgedFindings({
  findings,
  acknowledge,
  acknowledgeAll,
}: {
  findings: readonly MergeFinding[];
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
}): readonly MergeFinding[] {
  if (acknowledgeAll) {
    return [];
  }
  const accepted = new Set(acknowledge);
  return findings.filter((finding) => !accepted.has(finding.subject));
}

/** A short, actionable remedy per finding kind — printed alongside every finding of that kind. */
const REMEDY_BY_KIND: Readonly<Record<MergeFindingKind, string>> = {
  "base-moved":
    "rebase onto the current base ONCE, then land through `slopweaver github enqueue` where the base has a " +
    "native merge queue — merging keeps this file, but your diff and CI were computed against a base that " +
    "has moved, and rebasing again for each landing ahead of you is the lap the queue exists to remove",
  "base-unresolved":
    "fetch the base branch and rerun — every finding above was measured against the LOCAL ref, which in a " +
    "worktree is routinely behind the remote tip this pull request will actually land on",
  "docs-budget":
    "move content out of the budgeted file(s) to a linked doc or a skill and re-run this report — the number " +
    "above is exact and was measured on the tree merging would actually produce, not on either branch alone",
  "probe-regression": "confirm this is intentional, or restore what the probe checks for, before merging",
  // The one remedy that names its hatch inline. Every other kind here is a fix-the-thing remedy, while a
  // deliberate revert is legitimate and unfixable — the escape-hatch audit reported this gate as offering
  // nothing at all, because its sweep read `outbound/github/mergeGuard.ts` alone and the escape has always
  // lived here. Naming it in the remedy is what makes the next reader of the FINDING see it, rather than
  // only the reader of the verdict line at the bottom. Registered as `reverts-main` in `src/hatch/registry.ts`.
  "reverts-main":
    "read the named base commit and confirm restoring its predecessor is the change you meant, or rebase " +
    "properly instead of squashing onto a moved base. Legitimate exceptions may include the restore IS the " +
    "change, in which case say so in the pull-request body and accept this finding with " +
    "`--acknowledge <path>`. Use good judgement to determine whether the owner would approve of this, " +
    "then proceed or correct your approach",
  "unmentioned-deletion": "name this file in the description, or shrink the change so it is not a silent deletion",
  "unmentioned-test-deletion": "say in the description why this test is going, or restore it",
};

/**
 * The remedy text for one finding kind.
 *
 * @param kind the finding kind
 * @returns the remedy sentence
 */
export function remedyFor({ kind }: { kind: MergeFindingKind }): string {
  return REMEDY_BY_KIND[kind];
}

/** Findings grouped by kind, each group in the order `mergeGuardFindings` produced it. */
function groupByKind({
  findings,
}: {
  findings: readonly MergeFinding[];
}): ReadonlyMap<MergeFindingKind, readonly MergeFinding[]> {
  const groups = new Map<MergeFindingKind, MergeFinding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.kind);
    if (group === undefined) {
      groups.set(finding.kind, [finding]);
    } else {
      group.push(finding);
    }
  }
  return groups;
}

/**
 * Every finding, grouped by kind, each line stating its subject, detail, remedy and acknowledgement state.
 *
 * Every finding is printed regardless of whether it is acknowledged — acknowledging silences the REFUSAL,
 * never the visibility of what was accepted.
 *
 * @param findings every finding the guard produced
 * @param acknowledge exact subjects the caller accepted individually
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @returns the lines to print
 */
export function mergeReportLines({
  findings,
  acknowledge,
  acknowledgeAll,
}: {
  findings: readonly MergeFinding[];
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
}): readonly string[] {
  if (findings.length === 0) {
    return ["clean: no findings against the measured diff, the base branch's history, or the orchestration board."];
  }
  const accepted = new Set(acknowledge);
  const lines: string[] = [];
  for (const [kind, group] of groupByKind({ findings })) {
    lines.push(`${kind}  (${String(group.length)})`);
    for (const finding of group) {
      const isAcknowledged = acknowledgeAll || accepted.has(finding.subject);
      lines.push(`  [${isAcknowledged ? "ACKNOWLEDGED" : "UNACKNOWLEDGED"}] ${finding.subject}`);
      lines.push(`      ${finding.detail}`);
      lines.push(`      remedy: ${remedyFor({ kind })}`);
    }
  }
  return lines;
}

/** The complete report for one invocation: every line to print, and whether the merge is refused. */
export interface MergeVerdict {
  readonly lines: readonly string[];
  readonly refused: boolean;
}

/**
 * The verdict's closing line — what happens next, stated rather than left for the reader to infer.
 *
 * @param unacknowledged how many findings still stand
 * @param admin whether this invocation goes on to merge
 * @returns the single closing line
 */
function cleanVerdictLine({ unacknowledged, admin }: { unacknowledged: number; admin: boolean }): string {
  if (unacknowledged > 0) {
    return (
      `verdict: REFUSED — ${String(unacknowledged)} finding(s) unacknowledged. Accept each with ` +
      '--acknowledge <subject,...>, or all of them with --acknowledge-all --reason "…".'
    );
  }
  return admin
    ? "verdict: nothing stands unacknowledged — merging now, through the administrator bypass."
    : "verdict: nothing stands unacknowledged. This invocation only REPORTS — merge with " +
        "`slopweaver github merge --admin --number <n>`, or by hand in a way this guard cannot see.";
}

/**
 * The full verdict: the report lines plus whether this invocation refuses.
 *
 * @param findings every finding the guard produced
 * @param acknowledge exact subjects the caller accepted individually
 * @param acknowledgeAll whether the caller accepted every finding at once
 * @param reason the caller's stated reason for `--acknowledge-all`, printed when it was used
 * @param admin whether a clean verdict is followed by a real merge
 * @returns the lines to print and whether the merge is refused
 */
export function mergeVerdict({
  findings,
  acknowledge,
  acknowledgeAll,
  reason,
  admin,
}: {
  findings: readonly MergeFinding[];
  acknowledge: readonly string[];
  acknowledgeAll: boolean;
  reason: string | undefined;
  admin: boolean;
}): MergeVerdict {
  const unacknowledged = unacknowledgedFindings({ acknowledge, acknowledgeAll, findings });
  const lines = [...mergeReportLines({ acknowledge, acknowledgeAll, findings })];
  if (acknowledgeAll && findings.length > 0) {
    // `reason` is REQUIRED alongside --acknowledge-all and the parser refuses without it, so the
    // assertion is honest rather than defensive: coalescing to "" would print an acknowledgement
    // with no stated reason, which is precisely the unaccountable merge this verb exists to stop.
    lines.push(`acknowledged ALL findings above — reason: ${reason!}`);
  }
  lines.push(cleanVerdictLine({ admin, unacknowledged: unacknowledged.length }));
  return { lines, refused: unacknowledged.length > 0 };
}
