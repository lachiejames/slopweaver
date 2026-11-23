/**
 * The text `talk fidelity` prints for its claim reading (`src/talk/callFidelity.ts`): one row per hop and surface,
 * the finding counts by kind, then the newest pairs that carry a finding, each anchored to its call turn.
 */
import type { FidelityClaimPair, FidelityClaimReport } from "../../../talk/callFidelity.js";
import type { ClaimFindingKind } from "../../../talk/claimMatch.js";

/** Every kind, in the column order the table prints. */
const KINDS: readonly ClaimFindingKind[] = [
  "dropped-claim",
  "dropped-detail",
  "swapped-detail",
  "polarity-flip",
  "added-claim",
  "added-question",
  "unsourced-detail",
  "misquote",
];

/**
 * Each kind's findings graded by hand, real of graded, unsure ones left out: every finding on the graded call and up
 * to 25 per kind and hop from the week before it, both hops pooled. The grades and the false-positive
 * modes are in `docs/console/talk-fidelity-grades.md`. Re-grade, never
 * re-type, when the reading changes: these describe the detector they were measured on.
 */
const GRADED: Readonly<Record<ClaimFindingKind, { readonly real: number; readonly graded: number }>> = {
  "added-claim": { graded: 29, real: 21 },
  "added-question": { graded: 25, real: 24 },
  "dropped-claim": { graded: 37, real: 32 },
  "dropped-detail": { graded: 9, real: 5 },
  misquote: { graded: 28, real: 20 },
  "polarity-flip": { graded: 40, real: 2 },
  "swapped-detail": { graded: 0, real: 0 },
  "unsourced-detail": { graded: 24, real: 15 },
};

/** A kind is a figure to quote only at this share of its graded findings real, over at least `CALIBRATED_GRADED`. */
const CALIBRATED_SHARE = 0.8;

/** Fewer graded findings than this is no calibration at all, whatever share were real. */
const CALIBRATED_GRADED = 10;

/** The kinds a headline may count: graded enough, and real often enough. */
const CALIBRATED_KINDS: ReadonlySet<ClaimFindingKind> = new Set(
  KINDS.filter(
    (kind) => GRADED[kind].graded >= CALIBRATED_GRADED && GRADED[kind].real >= CALIBRATED_SHARE * GRADED[kind].graded,
  ),
);

/** Every other kind: counted and listed, never a figure to quote. Frozen, so no importer can empty it. */
export const UNCALIBRATED_KINDS: readonly ClaimFindingKind[] = Object.freeze(
  KINDS.filter((kind) => !CALIBRATED_KINDS.has(kind)),
);

/** One kind's grade as printed: `86% of 37`, or `ungraded`. */
function gradeOf({ kind }: { kind: ClaimFindingKind }): string {
  const { graded, real } = GRADED[kind];
  if (graded === 0) {
    return "ungraded";
  }
  return `${String(Math.round((100 * real) / graded))}% of ${String(graded)}`;
}

/** The headline: how many answer-to-voice pairs carry a calibrated finding, of all such pairs read. */
function headlineOf({ report }: { report: FidelityClaimReport }): string {
  const voiced = report.pairs.filter((pair) => pair.hop === "answer-to-voice");
  const lost = voiced.filter((pair) => pair.findings.some((finding) => CALIBRATED_KINDS.has(finding.kind)));
  return (
    `  ${String(lost.length)} of ${String(voiced.length)} spoken answer(s) dropped a handed claim or added a question ` +
    `(${[...CALIBRATED_KINDS].join(", ")}: the kinds hand-graded real at least ${String(100 * CALIBRATED_SHARE)}% of the time)`
  );
}

/** How much of one sentence a finding line shows. */
const SHOWN_CHARS = 160;

/** How many findings of one pair are printed before the rest are counted. */
const SHOWN_FINDINGS = 6;

/** How many gap lines are printed before the rest are counted. */
const SHOWN_GAPS = 20;

/** A text cut to the shown length, its whitespace folded. */
function clip({ text }: { text: string }): string {
  const folded = text.replaceAll(/\s+/gu, " ").trim();
  if (folded.length <= SHOWN_CHARS) {
    return folded;
  }
  return `${folded.slice(0, SHOWN_CHARS)}…`;
}

/** The table's body: one row per hop and surface, each kind's count under its own column. */
function tallyRows({ report }: { report: FidelityClaimReport }): readonly string[] {
  return report.tallies.map((tally) => {
    const hop = tally.hop === "source-to-answer" ? "source → answer" : "answer → voice ";
    const counts = KINDS.map((kind) => {
      const count = tally.byKind[kind];
      // A kind no finding had is absent from the tally by design: none of it fired.
      if (count === undefined) {
        return "0".padStart(kind.length);
      }
      return String(count).padStart(kind.length);
    }).join("  ");
    return `  ${hop}  ${tally.surface.padEnd(7)}  ${String(tally.pairs).padStart(5)}  ${String(tally.pairsWithFindings).padStart(4)}  ${counts}`;
  });
}

/**
 * The pairs worth printing: those with a finding, newest first, at most `limit`.
 *
 * @param limit how many to keep
 * @param report the claim reading
 * @returns the pairs, newest first
 */
export function shownClaimPairs({
  limit,
  report,
}: {
  limit: number;
  report: FidelityClaimReport;
}): readonly FidelityClaimPair[] {
  return report.pairs
    .filter((pair) => pair.findings.length > 0)
    .toReversed()
    .slice(0, limit);
}

/**
 * The claim reading as text: the headline, the table, the shown pairs and what could not be seen.
 *
 * @param report the claim reading
 * @param shown the pairs to print
 * @param unreadable call files that would not read
 * @returns the lines, in order
 */
export function claimTextLines({
  report,
  shown,
  unreadable,
}: {
  report: FidelityClaimReport;
  shown: readonly FidelityClaimPair[];
  unreadable: readonly string[];
}): readonly string[] {
  const lines: string[] = [
    `talk fidelity: CANDIDATE claim changes (sentence overlap, numbers, identifiers, quotes and negation; never ` +
      `meaning) — ${String(report.calls)} call(s) read`,
    headlineOf({ report }),
    `  hand-graded real: ${KINDS.map((kind) => `${kind} ${gradeOf({ kind })}`).join(" · ")}`,
    `  uncalibrated, so counted and never a figure to quote: ${UNCALIBRATED_KINDS.join(", ")}`,
    `  hop              surface  pairs  with  ${KINDS.join("  ")}`,
  ];
  lines.push(...tallyRows({ report }));
  if (report.unsourced > 0) {
    lines.push(
      `  ${String(report.unsourced)} source → answer message(s) read no tool answer on record ` +
        `(an answer is kept only when a model was handed one; shell, web and sub-agent reads leave none), so a clean read there is unproven`,
    );
  }
  if (report.ambiguous > 0) {
    lines.push(
      `  ${String(report.ambiguous)} source → answer message(s) shared their window with another running turn ` +
        `(ambiguous-turn: a tool line that names no turn cannot tell which one it belongs to)`,
    );
  }
  for (const pair of shown) {
    lines.push(`  ${pair.atIso}  ${pair.anchor}  ${pair.hop} (${pair.surface})`);
    pair.findings.slice(0, SHOWN_FINDINGS).forEach((finding) => {
      lines.push(`    ${finding.kind}: ${clip({ text: finding.detail })} — ${clip({ text: finding.sentence })}`);
    });
    if (pair.findings.length > SHOWN_FINDINGS) {
      lines.push(`    and ${String(pair.findings.length - SHOWN_FINDINGS)} more (--json lists every one)`);
    }
  }
  const gaps = [...unreadable, ...report.gaps];
  gaps.slice(0, SHOWN_GAPS).forEach((why) => {
    lines.push(`  not read whole — ${why}`);
  });
  if (gaps.length > SHOWN_GAPS) {
    lines.push(`  not read whole — and ${String(gaps.length - SHOWN_GAPS)} more (--json lists every one)`);
  }
  return lines;
}
