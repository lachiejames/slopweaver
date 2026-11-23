import { describe, expect, it } from "vitest";

import { NotionCommandErrors } from "../../../../../cli/commands/notion/errors.js";
import {
  type JudgedRender,
  notionVerifyExitCode,
  notionVerifyFailureCode,
  notionVerifyFailureLines,
  notionVerifyReportLines,
  parseNotionVerifyArgs,
  proseBlockCount,
} from "../../../../../cli/commands/notion/verifyCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { RenderFinding } from "../../../../../outbound/notion/renderFindings.js";
import { NotionVerifyErrors } from "../../../../../outbound/notion/verify.errors.js";

const PAGE = "https://www.notion.so/abc";

const judged = (over: Partial<JudgedRender> = {}): JudgedRender => ({
  observation: { cells: [], mermaid: [] },
  screenshots: ["/tmp/page.png"],
  url: PAGE,
  ...over,
});

const finding: RenderFinding = {
  cell: {
    anchorHrefs: [],
    anchorTexts: [],
    column: 1,
    heightPx: 20,
    lineHeightPx: 20,
    row: 1,
    table: 1,
    text: "x",
  },
  kind: "literal-markdown-link",
  message: "table 1, row 1, column 1 shows its markdown source as text",
};

describe("parseNotionVerifyArgs", () => {
  it("takes the page address as a positional", () => {
    const args = unwrap(parseNotionVerifyArgs({ argv: [PAGE] }));
    expect(args.page).toBe(PAGE);
    expect(args.observation).toBe(undefined);
    expect(args.cellLines).toBe(6);
  });

  it("reads --observation, --out, --json and --home", () => {
    const args = unwrap(
      parseNotionVerifyArgs({
        argv: [PAGE, "--observation", "/tmp/o.json", "--out", "/tmp/shots", "--json", "--home", "/tmp/home"],
      }),
    );
    expect(args.observation).toBe("/tmp/o.json");
    expect(args.out).toBe("/tmp/shots");
    expect(args.json).toBe(true);
    expect(args.home).toBe("/tmp/home");
  });

  it("reads a raised cell budget", () => {
    expect(unwrap(parseNotionVerifyArgs({ argv: [PAGE, "--cell-lines", "12"] })).cellLines).toBe(12);
  });

  it("refuses a cell budget that is not a positive whole number", () => {
    const parsed = parseNotionVerifyArgs({ argv: [PAGE, "--cell-lines", "0"] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.cellLinesInvalid({ got: "0" }));
    expect(unwrapErr(parsed).message).toBe('--cell-lines must be a positive whole number of lines, not "0"');
  });

  it("refuses an invocation with no page", () => {
    const parsed = parseNotionVerifyArgs({ argv: [] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.verifyAddressMissing());
    expect(unwrapErr(parsed).message).toBe(
      "usage: slopweaver notion verify <page-id-or-url> [--observation <path|->] [--out <dir>] [--cell-lines <n>]",
    );
  });

  it("refuses two pages, because it checks one", () => {
    const parsed = parseNotionVerifyArgs({ argv: [PAGE, "https://www.notion.so/def"] });
    expect(unwrapErr(parsed)).toEqual(NotionCommandErrors.tooManyAddresses({ count: 2 }));
    expect(unwrapErr(parsed).message).toBe("notion verify checks ONE page; pass a single address");
  });
});

describe("notionVerifyExitCode", () => {
  it("is 0 when the page is clean", () => {
    expect(notionVerifyExitCode({ findings: [] })).toBe(0);
  });

  it("is 3 when the check ran and found problems", () => {
    expect(notionVerifyExitCode({ findings: [finding] })).toBe(3);
  });
});

describe("notionVerifyFailureCode", () => {
  it("is 1, the genuine-fault channel, so an unverified page never reads as a pass", () => {
    expect(notionVerifyFailureCode()).toBe(1);
  });
});

describe("notionVerifyReportLines", () => {
  it("says nothing is wrong on a clean page, and names every screenshot", () => {
    const lines = notionVerifyReportLines({ cellLines: 6, findings: [], judged: judged() });
    expect(lines).toContain("  shot: /tmp/page.png");
    expect(lines[lines.length - 1]).toContain("no findings");
  });

  it("states the budget it judged against", () => {
    const lines = notionVerifyReportLines({ cellLines: 9, findings: [], judged: judged() });
    expect(lines[1]).toContain("9-line cell budget");
  });

  it("says the page is not ready, and lists each finding with its kind", () => {
    const lines = notionVerifyReportLines({ cellLines: 6, findings: [finding], judged: judged() });
    expect(lines).toContain("1 finding(s) — this page is NOT ready:");
    expect(lines[lines.length - 1]).toContain("[literal-markdown-link]");
  });

  it("counts an older capture with no prose list as zero text blocks", () => {
    const lines = notionVerifyReportLines({ cellLines: 6, findings: [], judged: judged() });
    expect(lines[1]).toBe("  0 table cell(s), 0 text block(s), 0 mermaid block(s), judged at a 6-line cell budget");
  });
});

describe("proseBlockCount", () => {
  it("is zero for an older capture that predates the prose list", () => {
    expect(proseBlockCount({ observation: { cells: [], mermaid: [] } })).toBe(0);
  });

  it("counts every observed prose block", () => {
    const prose = { anchorHrefs: [], anchorTexts: [], text: "x" };
    const observation = {
      cells: [],
      mermaid: [],
      prose: [
        { ...prose, index: 1 },
        { ...prose, index: 2 },
      ],
    };
    expect(proseBlockCount({ observation })).toBe(2);
  });
});

describe("notionVerifyFailureLines", () => {
  it("leads with the fact that the check did not run", () => {
    const lines = notionVerifyFailureLines({
      error: NotionVerifyErrors.observationUnreadable({ detail: "cells: expected array", path: "/tmp/o.json" }),
    });
    expect(lines[0]).toContain("did NOT run");
    expect(lines[1]).toContain("does not describe a rendered page");
  });
});
