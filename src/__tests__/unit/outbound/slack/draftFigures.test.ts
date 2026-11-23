/**
 * The figure count a parked draft is held to, over the kind of token the owner's read-through struck (a currency
 * amount, a suffixed count, a percentage) beside the identifiers, dates and times a reader never holds as a number.
 */
import { describe, expect, it } from "vitest";

import { figuresInDraftText } from "../../../../outbound/slack/draftFigures.js";

describe("figuresInDraftText", () => {
  it.each([
    ["the fixture bucket has grown about $12k since march", ["$12k"]],
    ["about $12.4k since march: $7.1k in mar", ["$12.4k", "$7.1k"]],
    ["it reads 4.2k rather than the total", ["4.2k"]],
    ["there's been 111 retry connect clicks", ["111"]],
    ["apr was about 38% of the bill", ["38%"]],
    ["1,200 rows and 500ms each, 5x slower", ["1,200", "500ms", "5x"]],
    ["spent $2026k, 2026%", ["$2026k", "2026%"]],
  ])("counts %j", (text, expected) => {
    expect(figuresInDraftText({ text })).toEqual(expected);
  });

  it.each([
    "the p95 on INC-33 after BBB-389 merged",
    "see #18080 for the 4xx and 503 errors",
    "at 10am, then again at 10:42",
    "no new mis-link since 23 sep, or since Oct 5",
    "it started in 2025 on v6.1.0",
    "the ts 1791009057 in that thread",
    "it opened 5 PRs across 3 repos on the 2nd",
    "the 2026 roadmap, Q3 2026, after PR 1840",
  ])("masks every number in %j", (text) => {
    expect(figuresInDraftText({ text })).toEqual([]);
  });

  it("never lets one mask half-consume a version another mask names", () => {
    expect(figuresInDraftText({ text: "upgrade to v6.1.0 first" })).toEqual([]);
  });

  it("counts a repeated figure once, whatever its case", () => {
    expect(figuresInDraftText({ text: "$12.4K now, still $12.4k" })).toEqual(["$12.4k"]);
  });

  it("counts a status code with no context word, the stated residue", () => {
    expect(figuresInDraftText({ text: "the LB 503 one is a count" })).toEqual(["503"]);
  });
});
