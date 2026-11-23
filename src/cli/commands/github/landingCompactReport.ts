/**
 * The DEFAULT text of `slopweaver github landing`: one fact line per pull request, grouped by what the
 * supervisor does about it, and one line saying how to get more.
 *
 * Progressive disclosure is the rule: the default is the facts, an extra argument asks for more:
 * `--pr <n>` is one row whole, and
 * `--full` is the two-line-per-row table `./landingReport.ts` still renders.
 *
 * Pure: rows in, lines out.
 */

import type { LandingRow } from "../../../review/landing.js";
import { landingFacts } from "./landingFacts.js";

/**
 * The group order: the one the owner decides first, then a press, then work a session finishes, then work a
 * session starts, then the rows nothing is dispatched for.
 */
const GROUP_ORDER: readonly string[] = [
  "needs-owner-judgment",
  "merge-now",
  "resolve-then-merge",
  "resolve-then-bump",
  "rebase-and-fix",
  "coderabbit-loop",
  "draft-first-review-ask",
  "finish-or-card-close",
  "unread",
  "outside-the-set",
  "waiting",
];

/** The group a row prints under: its act verdict, or the kind of its non-act decision. */
function groupOf({ row }: { row: LandingRow }): string {
  return row.dispatch.kind === "act" ? row.dispatch.verdict : row.dispatch.kind;
}

/** Where a group sorts, with any group this list does not name sorted last rather than dropped. */
function rankOf({ group }: { group: string }): number {
  const rank = GROUP_ORDER.indexOf(group);
  return rank === -1 ? GROUP_ORDER.length : rank;
}

/**
 * Every row as one fact line, grouped by what the supervisor does, fleet order kept within a group.
 *
 * @param rows every row this read produced
 * @returns a header per group, then its rows indented under it
 */
export function landingCompactLines({ rows }: { rows: readonly LandingRow[] }): readonly string[] {
  const groups = [...new Set(rows.map((row) => groupOf({ row })))].toSorted(
    (left, right) => rankOf({ group: left }) - rankOf({ group: right }) || left.localeCompare(right),
  );
  const lines: string[] = [];
  for (const group of groups) {
    const members = rows.filter((row) => groupOf({ row }) === group);
    lines.push(`${group} — ${String(members.length)}`);
    for (const row of members) {
      lines.push(`  ${landingFacts({ row })}`);
    }
  }
  return lines;
}

/**
 * The run's residue folded to one line, naming the flags that print it whole.
 *
 * @param residue every residue line the run produced, run-level and per-row
 * @returns the line, or `undefined` when there was nothing to fold
 */
export function collapsedResidueLine({ residue }: { residue: readonly string[] }): string | undefined {
  if (residue.length === 0) {
    return undefined;
  }
  return (
    `${String(residue.length)} residue line(s) folded — rerun with --full, ` +
    "or --pr <n> with one --repo, to read them"
  );
}
