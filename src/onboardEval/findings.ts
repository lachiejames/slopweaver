/**
 * Turn the worst findings from one evaluation run into board docs — "file the findings from the FIRST run
 * as board docs with a fix each," from the owner's own ask. Pure rendering only; {@link ./historyStore}
 * owns the actual write.
 */
import type { FrictionFinding } from "./frictionReport.js";

/** Characters a handover slug may not contain, collapsed to a single `-`. */
const SLUG_UNSAFE = /[^a-z0-9-]+/g;

/**
 * The top N findings to file, worst-first. {@link buildFrictionFindings} already sorts worst-first, so this
 * is a bounded take — its own function so "how many to file" is one visible decision, not an inline slice.
 *
 * @param findings every finding in the report, already worst-first
 * @param count how many to keep (a non-positive count files none)
 * @returns the findings to file as board docs
 */
export function selectTopFindings({
  findings,
  count,
}: {
  findings: readonly FrictionFinding[];
  count: number;
}): readonly FrictionFinding[] {
  return count > 0 ? findings.slice(0, count) : [];
}

/**
 * A filesystem- and handover-safe slug for one finding's doc, unique within a run by its position.
 *
 * @param runId the run this finding came from
 * @param finding the finding to slug
 * @param index the finding's position in the filed batch (0-based) — the tie-breaker two findings on the
 *   same step could otherwise collide on
 * @returns a lowercase, hyphenated slug
 */
export function findingDocSlug({
  runId,
  finding,
  index,
}: {
  runId: string;
  finding: FrictionFinding;
  index: number;
}): string {
  const stepPart = finding.stepId.toLowerCase().replaceAll(SLUG_UNSAFE, "-");
  const runPart = runId.toLowerCase().replaceAll(SLUG_UNSAFE, "-");
  return `onboard-eval-${runPart}-${index}-${stepPart}`.replaceAll(/-+/g, "-").replace(/-$/, "");
}

/**
 * Render one finding as a complete handover doc — frontmatter plus a checklist naming the fix.
 *
 * `doneWhen: []`: the fix here is a wording or behaviour change to `skills/onboard/SKILL.md` or the verb it
 * names, which the next evaluation run re-checks by re-running the harness — there is no cheaper mechanical
 * probe than running the thing again, so none is invented.
 *
 * @param finding the finding to file
 * @param runId the run it came from
 * @param index the finding's position in the filed batch (0-based), for a collision-free slug
 * @param repo the repository path the board doc names
 * @returns the doc's full markdown text, frontmatter included
 */
export function findingDocMarkdown({
  finding,
  runId,
  index,
  repo,
}: {
  finding: FrictionFinding;
  runId: string;
  index: number;
  repo: string;
}): string {
  const summary =
    `Onboarding self-evaluation run ${runId} hit a "${finding.severity}" step at ${finding.skillRef}` +
    `${finding.verb !== undefined ? ` (verb: ${finding.verb})` : ""}: ${finding.detail}`;
  const statusSummary =
    "Filed automatically by the onboarding self-evaluation harness. Fix the referenced skill step or verb, " +
    "then re-run the evaluation — a clean re-run is the confirmation, there is no cheaper mechanical probe.";
  return `---
slug: ${findingDocSlug({ finding, index, runId })}
summary: "${summary.replaceAll('"', '\\"')}"
status: ready
statusSummary: "${statusSummary}"
blockedBy: []
repo: ${repo}
doneWhen: []
---

# Onboarding self-evaluation finding — ${finding.skillRef}

## Checklist
Fix ${finding.skillRef}${finding.verb !== undefined ? ` (verb: ${finding.verb})` : ""} so a new developer no longer hits: ${finding.detail}
`;
}
