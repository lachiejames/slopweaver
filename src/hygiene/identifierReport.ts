/**
 * The forbidden-identifier REPORT — pure. Folds the hits `./identifierScan.ts` produced into one finding per
 * (file, kind), per-kind totals and the tracked-file headline, and renders the bounded lines a run prints.
 * Like the scanner, it never prints or returns matched text out of a file's content or a digest: a path, as
 * the caller listed it, a line and a count.
 */
import { IDENTIFIER_KINDS, type IdentifierHit, type IdentifierKind } from "./identifierScan.js";
import type { IdentifierVerdict } from "./scan.js";

/** Every hit of one kind in one file, folded to its first line and a count. */
interface IdentifierFileKindFinding {
  readonly path: string;
  readonly kind: IdentifierKind;
  readonly firstLine: number;
  readonly count: number;
}

/** One kind's totals across a scan. */
interface IdentifierKindSummary {
  readonly kind: IdentifierKind;
  readonly hits: number;
  readonly files: number;
}

/** A whole scan, aggregated and ready to render. */
export interface IdentifierReport {
  readonly findings: readonly IdentifierFileKindFinding[];
  readonly kinds: readonly IdentifierKindSummary[];
  readonly trackedFiles: number;
  readonly trackedHitFiles: number;
  readonly untrackedHitFiles: number;
}

/**
 * Pure: fold hits into per-(file, kind) findings, per-kind totals and the tracked headline.
 *
 * @param hits every hit the scan produced
 * @param trackedPaths the paths git tracks — the headline's denominator, and the set an untracked hit is outside
 * @returns the report, findings sorted by path then by {@link IDENTIFIER_KINDS} order
 */
export function identifierReport({
  hits,
  trackedPaths,
}: {
  hits: readonly IdentifierHit[];
  trackedPaths: ReadonlySet<string>;
}): IdentifierReport {
  const byKey = new Map<string, { path: string; kind: IdentifierKind; firstLine: number; count: number }>();
  for (const hit of hits) {
    const key = `${hit.kind}\u0000${hit.path}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, { count: 1, firstLine: hit.line, kind: hit.kind, path: hit.path });
    } else {
      seen.count += 1;
      seen.firstLine = Math.min(seen.firstLine, hit.line);
    }
  }
  const order = ({ kind }: { kind: IdentifierKind }): number => IDENTIFIER_KINDS.indexOf(kind);
  const findings = [...byKey.values()].toSorted(
    (a, b) => a.path.localeCompare(b.path) || order({ kind: a.kind }) - order({ kind: b.kind }),
  );
  const kinds = IDENTIFIER_KINDS.map((kind) => {
    const ofKind = findings.filter((finding) => finding.kind === kind);
    return { files: ofKind.length, hits: ofKind.reduce((sum, finding) => sum + finding.count, 0), kind };
  }).filter((summary) => summary.hits > 0);
  const hitPaths = new Set(findings.map((finding) => finding.path));
  const trackedHitFiles = [...hitPaths].filter((path) => trackedPaths.has(path)).length;
  return {
    findings,
    kinds,
    trackedFiles: trackedPaths.size,
    trackedHitFiles,
    untrackedHitFiles: hitPaths.size - trackedHitFiles,
  };
}

/**
 * Pure: the bounded lines every run prints — one per kind that hit, the tracked headline, and an untracked
 * line when an untracked file also hit. Never a matched token and never a digest.
 *
 * @param report the aggregated scan
 * @param verdict the identifier switch, which decides whether a hit fails the gate
 * @returns the lines, without trailing newlines
 */
export function identifierSummaryLines({
  report,
  verdict,
}: {
  report: IdentifierReport;
  verdict: IdentifierVerdict;
}): readonly string[] {
  const mode = verdict === "report" ? "report mode — not a failure" : "refused";
  return [
    ...report.kinds.map(
      (summary) => `hygiene: ${summary.kind}: ${String(summary.hits)} hit(s) in ${String(summary.files)} file(s)`,
    ),
    `hygiene: ${String(report.trackedHitFiles)} of ${String(report.trackedFiles)} tracked files carry a ` +
      `forbidden identifier (${mode})`,
    ...(report.untrackedHitFiles === 0
      ? []
      : [`hygiene: ${String(report.untrackedHitFiles)} untracked file(s) also carry a forbidden identifier`]),
  ];
}

/**
 * Pure: the full per-(file, kind) inventory, for `--list`. Location and count only — never the match.
 *
 * @param report the aggregated scan
 * @returns one indented line per finding
 */
export function identifierFindingLines({ report }: { report: IdentifierReport }): readonly string[] {
  return report.findings.map(
    (finding) => `  ${finding.path}:${String(finding.firstLine)}: [${finding.kind}] ${String(finding.count)} hit(s)`,
  );
}
