/*
 * The gaps one operation kind carries after a compile, built directly with no store and no home: the two
 * standing ones scoped to the kind, and one cross-kind gap per disposition rule that never fired.
 */
import { describe, expect, it } from "vitest";

import { operationGaps } from "../../../../atlas/microsoft365/syncGaps.js";

const AT = "2026-09-06T02:00:00.000Z";

describe("operationGaps", () => {
  it("opens the two standing gaps against the kind when every rule fired", () => {
    const gaps = operationGaps({ at: AT, deadRules: [], kind: "applications" });

    expect(gaps.map((gap) => [gap.condition, gap.scope, gap.kind])).toEqual([
      ["graph-credential-absent", "applications", "applications"],
      ["beta-surface-not-compiled", "applications", "applications"],
    ]);
    expect(gaps.map((gap) => gap.surfaces)).toEqual([["api"], ["compiled"]]);
    expect(gaps.map((gap) => gap.status)).toEqual(["open", "open"]);
  });

  it("appends one cross-kind gap per dead rule, scoped to the rule and naming it", () => {
    const gaps = operationGaps({ at: AT, deadRules: ["rule-a", "rule-b"], kind: "chats" });
    const dead = gaps.slice(2);

    expect(gaps.length).toBe(4);
    expect(dead.map((gap) => [gap.condition, gap.scope, gap.kind])).toEqual([
      ["disposition-rule-never-fired", "rule-a", null],
      ["disposition-rule-never-fired", "rule-b", null],
    ]);
    expect(dead.map((gap) => gap.surfaces)).toEqual([["compiled"], ["compiled"]]);
    expect(dead[0]!.reason).toContain("`rule-a`");
  });
});
