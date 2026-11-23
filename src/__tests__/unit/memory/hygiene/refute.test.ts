/**
 * CHECK 6 — the strictness bar, and the adversarial arm.
 *
 * The bar is the owner's strictness ruling encoded, so each rule gets its own firing case and the whole bar gets one
 * control: a memory that crosses none of it is eligible, and a test asserting only the firing cases would pass
 * against a bar that exempted everything.
 *
 * The arm's own property is that it DEMOTES and never discards, so every case here asserts the recommendation
 * AND the named rule — a refutation with no rule id is a refutation two runs cannot compare.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import type { Enforcer } from "../../../../memory/hygiene/enforcement.js";
import {
  barExemption,
  carriesIrreducibleWhy,
  referentRecommendation,
  refuteDuplicatePair,
  refuteEnforcementDrop,
} from "../../../../memory/hygiene/refute.js";
import type { MemoryLeaf, MemorySweepRow, MemoryType } from "../../../../memory/types.js";

/** A leaf carrying only what the bar reads. Defaults cross no bar rule. */
function leafOf(over: Partial<MemoryLeaf> = {}): MemoryLeaf {
  return {
    amendsCanon: null,
    correctionSubject: null,
    declaredModified: null,
    declaredName: null,
    declaredType: "feedback",
    description: null,
    file: "pelican-batching.md",
    mtimeMs: null,
    overlaps: [],
    ownerDirective: null,
    schemaFindings: [],
    stem: "pelican-batching",
    text: "",
    wikilinks: [],
    ...over,
  };
}

/** A sweep row carrying only what the bar and the pair arm read. Defaults cross no rule. */
function rowOf(over: Partial<MemorySweepRow> = {}): MemorySweepRow {
  return {
    ageDays: null,
    ageSource: "none",
    declaredModifiedIso: null,
    declaredType: "feedback",
    description: null,
    file: "pelican-batching.md",
    fileModifiedIso: null,
    findings: [],
    inboundLinks: 0,
    name: "pelican-batching",
    routedBy: ["MEMORY.md"],
    stale: false,
    ...over,
  };
}

/** An enforcer of a given kind, with text nothing here matches on. */
function enforcerOf({ kind, id }: { kind: Enforcer["kind"]; id: string }): Enforcer {
  return { id, kind, text: "irrelevant" };
}

describe("barExemption", () => {
  it("exempts a `user` memory as identity", () => {
    const exemption = barExemption({ leaf: leafOf({ declaredType: "user" }), row: rowOf() })!;
    expect(exemption.rule).toBe("bar-identity");
    expect(exemption.detail).toContain("the strictness bar says identity stays");
  });

  it("exempts a live owner directive", () => {
    expect(barExemption({ leaf: leafOf({ ownerDirective: true }), row: rowOf() })!.rule).toBe("bar-owner-directive");
  });

  it("exempts a memory that corrects a named corpus record", () => {
    const correctionSubject = { container: "C0SYNPELICAN", source: "slack", sourceId: "1757000000.000100" };
    const leaf = leafOf({ correctionSubject });
    expect(barExemption({ leaf, row: rowOf() })!.rule).toBe("bar-correction");
  });

  it("exempts a memory other memories wikilink to, and counts them", () => {
    const exemption = barExemption({ leaf: leafOf(), row: rowOf({ inboundLinks: 3 }) })!;
    expect(exemption.rule).toBe("bar-inbound-links");
    expect(exemption.detail).toContain("3 other memory(s)");
  });

  it("exempts nothing when a memory crosses no rule of the bar", () => {
    expect(barExemption({ leaf: leafOf(), row: rowOf() })).toBe(null);
  });

  it("prefers identity over an inbound link, so the strongest reason is the one printed", () => {
    const leaf = leafOf({ declaredType: "user", ownerDirective: true });
    expect(barExemption({ leaf, row: rowOf({ inboundLinks: 2 }) })!.rule).toBe("bar-identity");
  });
});

describe("carriesIrreducibleWhy", () => {
  it("finds a dated owner ruling", () => {
    expect(carriesIrreducibleWhy({ text: "The owner's ruling, 23 Aug 2026, was to keep it." })!.rule).toBe(
      "carries-ruling-date",
    );
  });

  it("finds a **Why:** line", () => {
    expect(carriesIrreducibleWhy({ text: "Batch the pelicans.\n\n**Why:** it halves the run." })!.rule).toBe(
      "carries-why",
    );
  });

  it("finds a verbatim quotation", () => {
    expect(carriesIrreducibleWhy({ text: 'The owner said "batch the pelicans" on the call.' })!.rule).toBe(
      "carries-quote",
    );
  });

  it("finds nothing in a memory that carries none of the three", () => {
    expect(carriesIrreducibleWhy({ text: "Batch the pelicans before migrating them." })).toBe(null);
  });
});

describe("refuteEnforcementDrop", () => {
  it("proposes a drop when the arm finds nothing", () => {
    const enforcers = [enforcerOf({ id: "AGENTS.md", kind: "always-on-doc" })];
    expect(refuteEnforcementDrop({ enforcers, text: "Batch the pelicans before migrating them." })).toEqual({
      recommendation: "drop",
      refutations: [],
    });
  });

  it("keeps a memory whose every match was a `paths:`-scoped rule, because the premise was false", () => {
    const enforcers = [
      enforcerOf({ id: ".claude/rules/area-cli.md", kind: "scoped-rule" }),
      enforcerOf({ id: ".claude/rules/area-live.md", kind: "scoped-rule" }),
    ];
    const refuted = refuteEnforcementDrop({ enforcers, text: "Batch the pelicans." });
    expect(refuted.recommendation).toBe("keep");
    expect(refuted.refutations.map((entry) => entry.rule)).toEqual(["enforcer-is-scoped"]);
  });

  it("keeps a memory carrying an irreducible why, even against an always-on doc", () => {
    const enforcers = [enforcerOf({ id: "AGENTS.md", kind: "always-on-doc" })];
    const refuted = refuteEnforcementDrop({ enforcers, text: "Batch them. The owner's ruling, 2 Sep 2026." });
    expect(refuted.recommendation).toBe("keep");
    expect(refuted.refutations.map((entry) => entry.rule)).toEqual(["carries-ruling-date"]);
  });

  it("checks the scope before the why, so one refutation is printed rather than two", () => {
    const enforcers = [enforcerOf({ id: ".claude/rules/area-cli.md", kind: "scoped-rule" })];
    const refuted = refuteEnforcementDrop({ enforcers, text: "Batch them. The owner's ruling, 2 Sep 2026." });
    expect(refuted.refutations.map((entry) => entry.rule)).toEqual(["enforcer-is-scoped"]);
  });
});

describe("refuteDuplicatePair", () => {
  it("proposes a consolidation when the pair stands", () => {
    const left = rowOf({ file: "a.md", routedBy: ["MEMORY.md"] });
    const right = rowOf({ file: "b.md", routedBy: ["MEMORY.md"] });
    expect(refuteDuplicatePair({ left, right })).toEqual({ recommendation: "adjust", refutations: [] });
  });

  it("keeps both when they declare different types, naming both", () => {
    const left = rowOf({ declaredType: "feedback", file: "a.md" });
    const right = rowOf({ declaredType: "reference", file: "b.md" });
    const refuted = refuteDuplicatePair({ left, right });
    expect(refuted.recommendation).toBe("keep");
    expect(refuted.refutations.map((entry) => entry.rule)).toEqual(["pair-different-types"]);
    expect(refuted.refutations[0]!.detail).toContain("(feedback and reference)");
  });

  it("still consolidates two routed by different indexes, but says a merge must keep both routes", () => {
    const left = rowOf({ file: "a.md", routedBy: ["MEMORY.md"] });
    const right = rowOf({ file: "b.md", routedBy: ["topics/pelican.md"] });
    const refuted = refuteDuplicatePair({ left, right });
    expect(refuted.recommendation).toBe("adjust");
    expect(refuted.refutations.map((entry) => entry.rule)).toEqual(["pair-different-routes"]);
  });

  it("does not claim different routes when one side is routed by nothing at all", () => {
    const left = rowOf({ file: "a.md", routedBy: [] });
    const right = rowOf({ file: "b.md", routedBy: ["topics/pelican.md"] });
    expect(refuteDuplicatePair({ left, right })).toEqual({ recommendation: "adjust", refutations: [] });
  });
});

describe("referentRecommendation", () => {
  it("adjusts a moved referent and says the claim may still be true", () => {
    const recommended = referentRecommendation({ verdict: "moved" });
    expect(recommended.recommendation).toBe("adjust");
    expect(recommended.refutations.map((entry) => entry.rule)).toEqual(["referent-moved-not-gone"]);
  });

  it("adjusts a vanished referent too — only the enforcement check ever proposes a drop", () => {
    expect(referentRecommendation({ verdict: "gone" })).toEqual({ recommendation: "adjust", refutations: [] });
  });
});

/** Every memory type, so the bar's `user` rule is asserted against a real member of the union. */
const EVERY_TYPE: readonly MemoryType[] = ["user", "feedback", "project", "reference"];

describe("the bar over every declared type", () => {
  it("exempts exactly one of the four memory types as identity", () => {
    expect(EVERY_TYPE.length).toBeGreaterThan(0);
    const exempted = EVERY_TYPE.filter(
      (declaredType) => barExemption({ leaf: leafOf({ declaredType }), row: rowOf() }) !== null,
    );
    expect(exempted).toEqual(["user"]);
  });
});
