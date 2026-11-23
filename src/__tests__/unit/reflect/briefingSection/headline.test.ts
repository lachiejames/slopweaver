/*
 * Each headline carries the finding, whether it is still live, whether the board already covers it, and the anchor
 * a grade takes.
 */
import { describe, expect, it } from "vitest";

import { findingHeadline } from "../../../../reflect/briefingSection.js";
import { finding, headlineText, ranked, render } from "./harness.js";

describe("renderSelfImprovementSection — each headline carries the finding, liveness, coverage and anchor", () => {
  it("a live finding nobody has planned says so, and names its id as the anchor", () => {
    const section = render({ findings: [ranked()] });
    expect(headlineText({ note: section.notes[0]! })).toBe(
      "4 run(s) amended a live brief over the same thing — still happening, last seen 2026-09-19; " +
        "not on the board yet; anchor f91d4dadf2d0",
    );
  });

  it("the anchor is a code run holding exactly the finding id `reflect grade` takes", () => {
    const headline = findingHeadline({ candidate: ranked() });
    expect(headline.at(-1)).toEqual({ kind: "code", text: "f91d4dadf2d0" });
  });

  it("a finding ONE board doc covers renders as covered, naming that doc", () => {
    const section = render({ findings: [ranked({ finding: finding({ coveredBy: ["probe-filter-defect"] }) })] });
    expect(headlineText({ note: section.notes[0]! })).toContain("the board may already cover it: probe-filter-defect;");
  });

  it("a finding SEVERAL docs cover is counted above the fold, never an arbitrary one of them named", () => {
    const section = render({
      findings: [ranked({ finding: finding({ coveredBy: ["zeta-doc", "alpha-doc", "mid-doc"] }) })],
    });
    const text = headlineText({ note: section.notes[0]! });
    expect(text).toContain("the board may already cover it: 3 docs match;");
    expect(text).not.toContain("alpha-doc");
  });

  it("a finding closed at or after its last sighting reads as fixed, not seen since", () => {
    const candidate = ranked({ closedAtIso: "2026-09-19T02:00:00.000Z", closedBy: "slopweaver#1180" });
    expect(headlineText({ note: render({ findings: [candidate] }).notes[0]! })).toContain(
      "— fixed, not seen since 2026-09-19;",
    );
  });

  it("a finding seen AFTER the grade that closed it reads as come back, the regression it is", () => {
    const candidate = ranked({ closedAtIso: "2026-09-19T01:30:00.000Z", closedBy: "slopweaver#1180" });
    expect(headlineText({ note: render({ findings: [candidate] }).notes[0]! })).toContain(
      "— came back after a fix, last seen 2026-09-19;",
    );
  });
});
