/**
 * What `slopweaver github bottleneck` PRINTS — the histogram, the rows under each bar, and the `--json` shape.
 *
 * Pure. The measurement is `../../../review/bottleneck.ts`; this module only arranges it, and it is separate
 * from that module so a renderer change cannot quietly move a cause.
 *
 * The histogram leads because the question the owner asked is which bar is biggest, not what any one pull
 * request is doing: too many open pull requests means the bottlenecks in the delivery process are the
 * thing to fix. So the bars come first, the rows sit under the
 * bar they fell to, and the residue closes rather than opens.
 */

import type { BottleneckBar, BottleneckReport, BottleneckRow } from "../../../review/bottleneck.js";

/** How wide the ASCII bar may grow, so the widest one fits an 80-column terminal beside its label. */
const BAR_WIDTH = 24;

/**
 * One bar, drawn.
 *
 * Scaled against the LARGEST bar rather than the total, so the shape of a backlog with one dominant cause is
 * visible instead of being one long bar and eight stubs.
 *
 * @param bar the cause and its count
 * @param widest how many rows the biggest bar holds
 * @returns the label, the blocks and the count
 */
function barLine({ bar, widest }: { bar: BottleneckBar; widest: number }): string {
  const blocks = Math.max(1, Math.round((bar.count / widest) * BAR_WIDTH));
  const label = bar.cause.padEnd(13, " ");
  const count = String(bar.count).padStart(3, " ");
  return `  ${label} ${"#".repeat(blocks).padEnd(BAR_WIDTH, " ")} ${count}  oldest ${String(bar.oldestOpenHours)}h open`;
}

/**
 * One measured row, as the line printed under its own bar.
 *
 * The two ages are printed TOGETHER and labelled, because the whole reason `idleHours` exists on the row is
 * that reading it as the wait is the mistake this verb was written out of.
 *
 * @param row the measured row
 * @returns one line naming the pull request, its ages, its distance and why it is here
 */
function rowLine({ row }: { row: BottleneckRow }): string {
  const behind = row.behindBy === undefined ? "behind ?" : `behind ${String(row.behindBy)}`;
  return (
    `    #${String(row.number)} ${String(row.openHours)}h open, ${String(row.idleHours)}h idle, ${behind} ` +
    `— ${row.authorLogin} — ${row.detail}`
  );
}

/**
 * The whole report as lines, histogram first.
 *
 * @param report the measured audit
 * @returns every line to print, in order
 */
export function bottleneckLines({ report }: { report: BottleneckReport }): readonly string[] {
  if (report.rows.length === 0) {
    return ["no open pull requests matched this selection"];
  }
  const widest = Math.max(...report.bars.map((bar) => bar.count));
  const lines: string[] = [
    `${String(report.rows.length)} open pull request(s), ${String(report.bars.length)} distinct cause(s)`,
    "",
  ];
  for (const bar of report.bars) {
    lines.push(barLine({ bar, widest }));
  }
  lines.push("");
  for (const bar of report.bars) {
    lines.push(`  ${bar.cause} — ${String(bar.count)}`);
    for (const number of bar.numbers) {
      lines.push(rowLine({ row: report.rows.find((row) => row.number === number)! }));
    }
    lines.push("");
  }
  for (const line of report.residue) {
    lines.push(`residue: ${line}`);
  }
  return lines;
}

/** The `--json` document: the measurement whole, plus the selection it was taken over. */
export interface BottleneckDocument {
  readonly repos: readonly string[];
  readonly author: string | undefined;
  readonly includedDrafts: boolean;
  readonly nowIso: string;
  readonly bars: readonly BottleneckBar[];
  readonly rows: readonly BottleneckRow[];
  readonly residue: readonly string[];
}

/**
 * The machine-readable document.
 *
 * It carries the SELECTION as well as the answer, because a histogram read without knowing whether drafts
 * were in it is the false-green this verb's own default exists to avoid.
 *
 * @param report the measured audit
 * @param repos the repository slugs the read covered
 * @param author the login filter, when one was typed
 * @param includedDrafts whether drafts were part of the read
 * @param nowIso the instant the read was judged at
 * @returns the document, ready to serialise
 */
export function bottleneckDocument({
  report,
  repos,
  author,
  includedDrafts,
  nowIso,
}: {
  report: BottleneckReport;
  repos: readonly string[];
  author: string | undefined;
  includedDrafts: boolean;
  nowIso: string;
}): BottleneckDocument {
  return {
    author,
    bars: report.bars,
    includedDrafts,
    nowIso,
    repos,
    residue: report.residue,
    rows: report.rows,
  };
}
