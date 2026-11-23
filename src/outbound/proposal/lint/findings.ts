/**
 * The finding vocabulary every proposal detector speaks, and the severity split that decides an exit code.
 *
 * Two severities, and the line between them is deliberate. A `blocker` is something OBJECTIVELY detectable
 * and objectively wrong — a number with no citation, a hero shot missing from a doc full of figures. A
 * `warning` is a judgement the detector can only guess at, and a reviewer settles. Making everything a
 * blocker would turn the gate into something people route around; making everything a warning would turn it
 * into decoration.
 */

/** Whether a finding stops a publish or merely reports. */
type ProposalSeverity = "blocker" | "warning";

/** One thing the linter found. */
export interface ProposalFinding {
  readonly severity: ProposalSeverity;
  /** A stable kebab-case rule id, so a finding can be talked about without quoting its message. */
  readonly rule: string;
  readonly message: string;
  /** The 1-indexed line the finding points at, when the detector knows one. */
  readonly line?: number | undefined;
}

/**
 * Whether any finding blocks a publish.
 *
 * @param findings every finding from a lint pass
 * @returns true when at least one is a blocker
 */
export function hasBlocker({ findings }: { findings: readonly ProposalFinding[] }): boolean {
  return findings.some((finding) => finding.severity === "blocker");
}
