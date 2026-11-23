/**
 * `slopweaver github coderabbit-yield` rendered — terminal lines and the `--json` document. Pure.
 *
 * Every percentage names its denominator, the inline CodeRabbit findings in the stated population, and a
 * zero denominator prints no percentage at all. Review-body counts never join that denominator: nothing
 * records what became of a nitpick posted in a review body, so adding them would dilute every rate with
 * findings whose outcome is unknowable.
 */

import { YIELD_OUTCOMES, type YieldGroup, type YieldReport } from "../../../review/coderabbitYield.js";

/** Everything the document carries about how the read went. */
export interface YieldReadFacts {
  readonly author: string;
  readonly repos: readonly string[];
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly readStartedAtIso: string;
  readonly readFinishedAtIso: string;
  readonly requests: number;
  readonly cost: number;
  readonly gaps: readonly string[];
}

/** `n (p%)`, or just `n` when the denominator is zero. */
function share({ n, of }: { n: number; of: number }): string {
  return of === 0 ? String(n) : `${String(n)} (${String(Math.round((n / of) * 100))}%)`;
}

/** One cross-tab row: the key, its total, and each non-zero outcome. */
function groupLine({ group }: { group: YieldGroup }): string {
  const cells = YIELD_OUTCOMES.filter((outcome) => group.counts[outcome] > 0).map(
    (outcome) => `${outcome} ${share({ n: group.counts[outcome], of: group.total })}`,
  );
  return `    ${group.key}: ${String(group.total)} — ${cells.join(", ")}`;
}

/**
 * The terminal report.
 *
 * @param report the aggregate
 * @param facts how the read went
 * @returns the lines, headline first
 */
export function coderabbitYieldLines({
  report,
  facts,
}: {
  report: YieldReport;
  facts: YieldReadFacts;
}): readonly string[] {
  const total = report.findings.length;
  const self = report.selfResolved;
  return [
    `github coderabbit-yield: ${facts.author}'s pull requests created ${facts.sinceIso} → ${facts.untilIso}`,
    `  ${String(report.prsRead)} pull request(s) read, ${String(report.prsWithFindings)} with a CodeRabbit thread, ${String(total)} inline finding(s)`,
    ...report.byRepo.map(
      (row) =>
        `  ${row.key}: ${String(row.prs)} PR(s), ${String(row.prsWithFindings)} with findings, ${String(row.total)} finding(s)`,
    ),
    `  outcomes, of ${String(total)} inline finding(s):`,
    ...YIELD_OUTCOMES.map((outcome) => `    ${outcome}: ${share({ n: report.totals[outcome], of: total })}`),
    `  markers: ${String(report.markers.commit)} "Addressed in commit", ${String(report.markers.confirmed)} "Confirmed as addressed"`,
    `  resolved-no-evidence split: replied ${String(self.replied)}, silent ${String(self.silent)}, reply unknown ${String(self.replyUnknown)}; ` +
      `resolved by the author ${String(self.byAuthor)}, by someone else ${String(self.byOther)}, unknown ${String(self.byUnknown)}`,
    "  by severity:",
    ...report.bySeverity.map((group) => groupLine({ group })),
    "  by type:",
    ...report.byType.map((group) => groupLine({ group })),
    "  by category:",
    ...report.byCategory.map((group) => groupLine({ group })),
    "  by pull-request state:",
    ...report.byPrState.map((group) => groupLine({ group })),
    `  review bodies: ${String(report.reviewBodies.reviews)} CodeRabbit review(s) carrying ${String(report.reviewBodies.nitpicks)} nitpick(s) and ` +
      `${String(report.reviewBodies.outsideDiff)} outside-diff comment(s), outcome not recorded anywhere`,
    `  read: ${String(facts.requests)} GraphQL request(s), ${String(facts.cost)} point(s), ${facts.readStartedAtIso} → ${facts.readFinishedAtIso}`,
    facts.gaps.length === 0 ? "  coverage: complete" : `  coverage: ${String(facts.gaps.length)} gap(s)`,
    ...facts.gaps.map((gap) => `    ${gap}`),
  ];
}

/**
 * The `--json` document: the read facts, the aggregate, and every finding with its link.
 *
 * @param report the aggregate
 * @param facts how the read went
 * @returns one serialisable object
 */
export function coderabbitYieldDocument({
  report,
  facts,
}: {
  report: YieldReport;
  facts: YieldReadFacts;
}): Readonly<Record<string, unknown>> {
  return { kind: "coderabbit-yield", read: facts, report, schemaVersion: 1 };
}
