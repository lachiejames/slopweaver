/**
 * The delta between two friction reports — "a regression in the onboarding is visible" from the owner's own
 * ask. Matches findings by `stepId`, because a step's `skillRef` text can be reworded between runs while the
 * step itself (and whether it is still friction) stays the same identity.
 *
 * Pure: two already-built {@link FrictionReport}s in, a diff out.
 */
import type { FrictionFinding, FrictionReport } from "./frictionReport.js";

/**
 * What changed between a previous report and the current one.
 *
 * @internal — inferred as `diffReports`'s return type; no caller outside this module needs the shape by name.
 */
export interface ReportDelta {
  /** The run this delta is measured against, or `undefined` when there was no previous run to compare to. */
  readonly previousRunId: string | undefined;
  /** Friction present now that was not present in the previous run — a regression. */
  readonly newFindings: readonly FrictionFinding[];
  /** Friction present in the previous run that is gone now — a fix. */
  readonly resolvedFindings: readonly FrictionFinding[];
  /** Friction present in both runs — unresolved. */
  readonly persistingFindings: readonly FrictionFinding[];
  readonly durationDeltaSeconds: number;
}

/** Build the id set a report's findings cover, for a plain set-difference. */
function findingIds({ findings }: { findings: readonly FrictionFinding[] }): ReadonlySet<string> {
  return new Set(findings.map((finding) => finding.stepId));
}

/**
 * Diff a current report against the previous one.
 *
 * @param current the just-built report
 * @param previous the most recent prior report, or undefined when this is the first run
 * @returns the delta
 */
export function diffReports({
  current,
  previous,
}: {
  current: FrictionReport;
  previous: FrictionReport | undefined;
}): ReportDelta {
  if (previous === undefined) {
    return {
      durationDeltaSeconds: current.totalDurationSeconds,
      newFindings: current.findings,
      persistingFindings: [],
      previousRunId: undefined,
      resolvedFindings: [],
    };
  }
  const previousIds = findingIds({ findings: previous.findings });
  const currentIds = findingIds({ findings: current.findings });
  return {
    durationDeltaSeconds: current.totalDurationSeconds - previous.totalDurationSeconds,
    newFindings: current.findings.filter((finding) => !previousIds.has(finding.stepId)),
    persistingFindings: current.findings.filter((finding) => previousIds.has(finding.stepId)),
    previousRunId: previous.runId,
    resolvedFindings: previous.findings.filter((finding) => !currentIds.has(finding.stepId)),
  };
}

/** One signed duration line, rounded to whole seconds. */
function durationLine({ deltaSeconds }: { deltaSeconds: number }): string {
  const rounded = Math.round(deltaSeconds);
  if (rounded === 0) {
    return "same total duration as the previous run";
  }
  return rounded > 0
    ? `${rounded}s slower than the previous run`
    : `${Math.abs(rounded)}s faster than the previous run`;
}

/**
 * Render a delta as the plain-English "what changed since last time" section.
 *
 * @param delta the delta to render
 * @returns the delta's markdown lines
 */
export function renderDeltaMarkdown({ delta }: { delta: ReportDelta }): readonly string[] {
  if (delta.previousRunId === undefined) {
    return ["## Delta", "", "No previous run to compare against — this is the first recorded evaluation."];
  }
  const lines: string[] = [
    "## Delta",
    "",
    `Compared against run ${delta.previousRunId} (${durationLine({ deltaSeconds: delta.durationDeltaSeconds })}).`,
    "",
  ];
  if (delta.newFindings.length > 0) {
    lines.push(`### New (${delta.newFindings.length}) — regressions since the previous run`, "");
    delta.newFindings.forEach((finding, index) => lines.push(`${index + 1}. ${finding.skillRef} — ${finding.detail}`));
    lines.push("");
  }
  if (delta.resolvedFindings.length > 0) {
    lines.push(`### Resolved (${delta.resolvedFindings.length}) — fixed since the previous run`, "");
    delta.resolvedFindings.forEach((finding, index) =>
      lines.push(`${index + 1}. ${finding.skillRef} — ${finding.detail}`),
    );
    lines.push("");
  }
  if (delta.persistingFindings.length > 0) {
    lines.push(`### Still open (${delta.persistingFindings.length})`, "");
    delta.persistingFindings.forEach((finding, index) =>
      lines.push(`${index + 1}. ${finding.skillRef} — ${finding.detail}`),
    );
  }
  if (delta.newFindings.length === 0 && delta.resolvedFindings.length === 0 && delta.persistingFindings.length === 0) {
    lines.push("No friction in either run.");
  }
  return lines;
}
