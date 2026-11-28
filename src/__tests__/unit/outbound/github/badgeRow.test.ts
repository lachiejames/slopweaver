import { describe, expect, it } from "vitest";

import { BADGE_TARGETS, badgeRowOf, readBadgeRow } from "../../../../outbound/github/badgeRow.js";
import { FEATURE_BODY, FIX_BODY, P1_CHECKED, P2_CHECKED, QUOTE_BODY, TESTS_ONLY_BODY } from "./fixtures.js";

describe("BADGE_TARGETS", () => {
  it("names the four heading anchors", () => {
    expect(BADGE_TARGETS).toEqual({
      checks: "checks",
      notChecked: "not-checked-and-why",
      problem: "proof-of-the-problem",
      solution: "proof-of-the-solution",
    });
  });
});

describe("badgeRowOf", () => {
  it("writes three shields badges on one line, each an anchor with its hover", () => {
    const row = badgeRowOf({ body: FIX_BODY, layout: 2 })._unsafeUnwrap();
    expect(row.split("</a> <a ").length).toBe(3);
    expect(row).toContain('<a href="#proof-of-the-solution" title="Worst case a sign-in that used to work is refused.');
    expect(row).toContain('alt="risk: medium"');
    expect(row).toContain('alt="problem: seen 16 Nov"');
    expect(row).toContain('alt="proof: problem and solution"');
  });

  it("doubles a hyphen in a shields segment so it is not read as a field separator", () => {
    const row = badgeRowOf({ body: FEATURE_BODY, layout: 2 })._unsafeUnwrap();
    expect(row).toContain("badge/problem-not%20seen%20yet-6e7781?style=flat");
  });

  it("refuses an unranked risk list", () => {
    const body = { ...FIX_BODY, risk: { items: [] } };
    expect(badgeRowOf({ body, layout: 2 })._unsafeUnwrapErr().code).toBe("RISK_UNRANKED");
  });
});

describe("readBadgeRow", () => {
  it("recovers the facts only the hovers carry from the row it wrote", () => {
    const row = badgeRowOf({ body: FIX_BODY, layout: 2 })._unsafeUnwrap();
    const cursor = { at: 0, blocks: [row] };
    expect(readBadgeRow({ cursor })._unsafeUnwrap()).toEqual({
      nothingOnScreen: false,
      problemBy: "agent",
      problemSeen: FIX_BODY.problemSeen,
      solutionBy: "agent",
      topRisk: P2_CHECKED,
    });
    expect(cursor.at).toBe(1);
  });

  it("reads a high risk back as the kind that implies high", () => {
    const body = { ...FIX_BODY, risk: { items: [P1_CHECKED] } };
    const row = badgeRowOf({ body, layout: 2 })._unsafeUnwrap();
    expect(readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap().topRisk).toEqual(P1_CHECKED);
  });

  it.each([1, 2] as const)("flags a tests-only proof badge in layout %i", (layout) => {
    const row = badgeRowOf({ body: TESTS_ONLY_BODY, layout })._unsafeUnwrap();
    expect(readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap().nothingOnScreen).toBe(true);
  });

  it.each([
    ["nothing on screen", QUOTE_BODY, true],
    ["a screen change", { ...QUOTE_BODY, visualProof: "screen-change" as const }, false],
  ])("reads a quote's actors and whether %s off its hover", (_name, body, nothingOnScreen) => {
    const row = badgeRowOf({ body, layout: 2 })._unsafeUnwrap();
    const facts = readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrap();
    expect([facts.problemBy, facts.solutionBy, facts.nothingOnScreen]).toEqual(["agent", "owner", nothingOnScreen]);
  });

  it("stops at the badge row when the block is not one", () => {
    const error = readBadgeRow({ cursor: { at: 0, blocks: ["not a row"] } })._unsafeUnwrapErr();
    expect([error.code, error.message]).toEqual(["STRUCTURE", expect.stringContaining("the badge row")]);
  });

  it("refuses a row whose hover is not the template", () => {
    const row = badgeRowOf({ body: FIX_BODY, layout: 2 })._unsafeUnwrap().replace("Worst case", "Bad case");
    expect(readBadgeRow({ cursor: { at: 0, blocks: [row] } })._unsafeUnwrapErr().message).toContain("the badge hovers");
  });
});
