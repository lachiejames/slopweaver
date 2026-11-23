/**
 * What `briefing card` (`./cardRun.ts`) says once a row is placed: the report a dry run or a write prints, as one
 * `--json` object or as a headline with one line per other-row refusal. Split from the run, which decides what is
 * written and where; this file only describes the outcome.
 */
import { PAGE_MARKS_REQUIRED_FROM_ISO } from "../../../briefing/openPageCards.js";
import type { OpenPageRowGate, OpenPageRowPlacement } from "../../../briefing/openPageRow.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { BriefingCardPlaceArgs } from "./formEditArgs.js";

/** What the verb reports once the row is placed, as `--json` prints it. */
export interface CardReport {
  readonly action: OpenPageRowPlacement["action"];
  readonly url: string;
  readonly position: number;
  readonly rows: number;
  readonly aboveFoldWords: number;
  readonly path: string;
  readonly written: boolean;
  /** What `--open-page-cards` would refuse in the OTHER rows — reported, never a reason to refuse this one. */
  readonly otherRowRefusals: readonly string[];
  /** Whether this row's question and lean were TYPED because its page predates the marks, not read from it. */
  readonly typed: boolean;
  /** Why the page could not supply them — unmarked, or never frozen in the store — or null when they were read. */
  readonly typedBecause: string | null;
}

/**
 * The report a run prints, before the write is known to have happened.
 *
 * @param gated what the row's own gate produced: its url, its fold count and any page it typed
 * @param placed where the row landed in the edited document
 * @param others what `--open-page-cards` would refuse in the other rows
 * @returns the report, `written` false until the write lands
 */
export function cardReportOf({
  args,
  gated,
  placed,
  others,
}: {
  args: BriefingCardPlaceArgs;
  gated: OpenPageRowGate;
  placed: OpenPageRowPlacement;
  others: readonly string[];
}): CardReport {
  const typedPage = gated.typed[0];
  return {
    aboveFoldWords: gated.aboveFoldWords,
    action: placed.action,
    otherRowRefusals: others,
    path: args.openPagesPath,
    position: placed.position,
    rows: placed.document.length,
    typed: typedPage !== undefined,
    typedBecause: typedPage === undefined ? null : typedPage.why,
    url: gated.artifact.url,
    written: false,
  };
}

/**
 * Print the report: one JSON object, or the headline and one line per other-row refusal.
 *
 * @param writeOut where the run's lines are printed
 * @param json whether to print the one `--json` object instead of lines
 */
export function printCardReport({
  writeOut,
  json,
  report,
}: {
  writeOut: (line: string) => void;
  json: boolean;
  report: CardReport;
}): void {
  if (json) {
    writeOut(safeJsonStringify({ label: "briefing card report", value: report }));
    return;
  }
  const verb = report.action === "replaced" ? "replaced" : "appended";
  const outcome = report.written ? `wrote ${report.path}` : `dry run, nothing written to ${report.path}`;
  writeOut(
    `briefing card: ${verb} ${report.url} at row ${String(report.position)} of ${String(report.rows)}; ` +
      `${String(report.aboveFoldWords)} words above the fold; ${outcome}`,
  );
  if (report.typedBecause !== null) {
    writeOut(
      `briefing card: this row's question and lean are TYPED, because ${report.typedBecause} and the page ` +
        `landed before ${PAGE_MARKS_REQUIRED_FROM_ISO}; republish the page with data-card marks and drop ` +
        "both keys from the row so the card reads them from the page",
    );
  }
  if (report.otherRowRefusals.length > 0) {
    writeOut(
      `briefing card: ${String(report.otherRowRefusals.length)} other row(s) would be refused by --open-page-cards:`,
    );
    for (const line of report.otherRowRefusals) {
      writeOut(`  ${line}`);
    }
  }
}
