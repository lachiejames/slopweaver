/**
 * `printCardReport`, what `briefing card` says once a row is placed: one `--json` object, or a headline, the typed
 * notice when the page could not supply the pair, and one line per other-row refusal.
 */
import { describe, expect, it } from "vitest";

import { PAGE_MARKS_REQUIRED_FROM_ISO } from "../../../../../briefing/openPageCards.js";
import { type CardReport, printCardReport } from "../../../../../cli/commands/briefing/cardReport.js";

const URL = "file:///home/acme/.slopweaver/pages/first/index.html";

/** A dry-run report for one appended row, with every optional line off. */
const DRY_RUN: CardReport = {
  aboveFoldWords: 42,
  action: "appended",
  otherRowRefusals: [],
  path: "/scratch/open-pages.json",
  position: 3,
  rows: 3,
  typed: false,
  typedBecause: null,
  url: URL,
  written: false,
};

/** Print a report, capturing every line. */
function printed({ report, json }: { report: CardReport; json: boolean }): string[] {
  const lines: string[] = [];
  printCardReport({ json, report, writeOut: (line) => lines.push(line) });
  return lines;
}

describe("printCardReport", () => {
  it("prints one headline for a plain dry run, naming the row, the fold count and that nothing was written", () => {
    expect(printed({ json: false, report: DRY_RUN })).toEqual([
      `briefing card: appended ${URL} at row 3 of 3; 42 words above the fold; dry run, nothing written to ` +
        "/scratch/open-pages.json",
    ]);
  });

  it("adds the typed notice and one line per other-row refusal to a written replace", () => {
    const report: CardReport = {
      ...DRY_RUN,
      action: "replaced",
      otherRowRefusals: ["row 1: no question mark", "row 2: no lean"],
      typed: true,
      typedBecause: "the page carries no data-card marks",
      written: true,
    };

    expect(printed({ json: false, report })).toEqual([
      `briefing card: replaced ${URL} at row 3 of 3; 42 words above the fold; wrote /scratch/open-pages.json`,
      "briefing card: this row's question and lean are TYPED, because the page carries no data-card marks and the " +
        `page landed before ${PAGE_MARKS_REQUIRED_FROM_ISO}; republish the page with data-card marks and drop both ` +
        "keys from the row so the card reads them from the page",
      "briefing card: 2 other row(s) would be refused by --open-page-cards:",
      "  row 1: no question mark",
      "  row 2: no lean",
    ]);
  });

  it("prints exactly the report as one JSON object under --json", () => {
    const lines = printed({ json: true, report: DRY_RUN });

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toEqual(DRY_RUN);
  });
});
