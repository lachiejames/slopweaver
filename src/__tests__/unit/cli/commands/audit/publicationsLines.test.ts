/**
 * What `audit publications` prints from a report: each door's coverage, the counts by door, class and field, the
 * withheld links and the expectations by position, as text lines or one JSON document. A synthetic report whose
 * findings carry a link proves the link never reaches a printed line.
 */
import { describe, expect, it } from "vitest";

import { printPublicationAudit } from "../../../../../cli/commands/audit/publicationsLines.js";
import type { PublicationAuditReport } from "../../../../../live/publicationAudit/store.js";
import { doorCoverage } from "../../../../../live/publicationAudit/types.js";

const LINK = "https://linear.app/acme/issue/ABC-1/widget-rollout";

/** A report with one partial door, one not-swept door, two findings and one withheld link. */
function report({ withheldLinks }: { withheldLinks: number }): PublicationAuditReport {
  return {
    counts: { linear: { "private-term/money": 2 } },
    coverage: [
      doorCoverage({ attachmentsNotSwept: 1, door: "linear", gaps: ["credential missing"], objects: 3, texts: 5 }),
      { attachmentsNotSwept: 0, door: "notion", gaps: [], objects: 0, state: "not-swept", texts: 0 },
    ],
    findings: [
      { className: "private-term/money", door: "linear", fields: ["body", "title"], findingId: "f1", link: LINK },
      { className: "private-term/money", door: "linear", fields: ["body"], findingId: "f2", link: null },
    ],
    readAtIso: "2026-11-20T10:00:00.000Z",
    run: "publication-audit/2026-11-20T10-00-00.000Z",
    schemaVersion: 1,
    withheldLinks,
  };
}

/** Print one report and return every line written. */
function printed({
  json,
  met,
  withheldLinks,
}: {
  json: boolean;
  met: readonly boolean[];
  withheldLinks: number;
}): string[] {
  const lines: string[] = [];
  printPublicationAudit({ json, met, out: ({ line }) => lines.push(line), report: report({ withheldLinks }) });
  return lines;
}

describe("printPublicationAudit — text", () => {
  it("prints coverage, counts by class and field, withheld links, missed expectations and the run", () => {
    expect(printed({ json: false, met: [true, false, false], withheldLinks: 1 })).toEqual([
      "publication audit — read 2026-11-20T10:00:00.000Z",
      "  linear: partial — 3 object(s), 5 text(s), 1 uploaded file(s) not swept",
      "    gap: credential missing",
      "  notion: not swept by this build",
      "findings: 2",
      "  linear private-term/money: 2",
      "  by field: body 2, title 1",
      "  links withheld because a rule matched the address: 1",
      "expectations: 1 of 3 met (missed: #2, #3)",
      "report: publication-audit/2026-11-20T10-00-00.000Z",
    ]);
  });

  it("omits the withheld and expectation lines when there is nothing to say", () => {
    const lines = printed({ json: false, met: [], withheldLinks: 0 });

    expect(lines).toHaveLength(8);
    expect(lines.at(-1)).toBe("report: publication-audit/2026-11-20T10-00-00.000Z");
    expect(lines.filter((line) => line.startsWith("expectations:"))).toEqual([]);
    expect(lines.filter((line) => line.includes("withheld"))).toEqual([]);
  });

  it("names no missed position when every expectation was met", () => {
    expect(printed({ json: false, met: [true, true], withheldLinks: 0 })).toContain("expectations: 2 of 2 met");
  });

  it("prints no finding's link in any line", () => {
    const lines = printed({ json: false, met: [false], withheldLinks: 1 });

    expect(report({ withheldLinks: 1 }).findings[0]!.link).toBe(LINK);
    expect(lines.filter((line) => line.includes("linear.app"))).toEqual([]);
  });
});

describe("printPublicationAudit — json", () => {
  it("writes one document of counts, the finding total in place of the findings", () => {
    const lines = printed({ json: true, met: [true, false], withheldLinks: 1 });

    expect(lines).toHaveLength(1);
    const document: unknown = JSON.parse(lines[0]!);
    expect(document).toEqual({
      counts: { linear: { "private-term/money": 2 } },
      coverage: report({ withheldLinks: 1 }).coverage,
      expectationsMet: [true, false],
      findings: 2,
      readAtIso: "2026-11-20T10:00:00.000Z",
      report: "publication-audit/2026-11-20T10-00-00.000Z",
      withheldLinks: 1,
    });
    expect(lines[0]!.includes("linear.app")).toBe(false);
  });
});
