import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../../codex/ledger.js";
import { replacementFor, supersedeRefusal } from "../../../codex/supersession.js";

/** One ledger row; overrides set exactly the field a case is about. */
function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    artifactId: "a-1",
    capped: false,
    createdAtIso: "2026-09-12T12:00:00.000Z",
    diffSha256: undefined,
    freshness: { kind: "current" },
    mode: "review",
    outcomeContext: undefined,
    pass: "r2",
    propertyId: "r2-08",
    provider: "codex",
    reviewSummary: undefined,
    superseded: undefined,
    verdict: "BROKEN",
    ...over,
  };
}

const NONE: ReadonlySet<string> = new Set();

describe("supersedeRefusal", () => {
  it("allows a retirement when a current, conclusive pass under the same property stands beside it", () => {
    const entries = [entry({ artifactId: "a-2", verdict: "CLEAN" }), entry({ artifactId: "a-1" })];
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries })).toBeUndefined();
  });

  it("REFUSES when nothing replaces it, because that is a dismissal rather than a supersession", () => {
    // The guard the whole verb turns on. Without it, `supersede` is just a way to wave a finding away.
    const refusal = supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries: [entry()] });
    expect(refusal).toBe(
      "no CURRENT, conclusive pass under r2-08 stands beside a-1 — a retirement with nothing in its place " +
        "is a dismissal, and this verb does not do that. Re-run the property with the wording you can " +
        "actually satisfy first, then retire the one it replaced",
    );
  });

  it("does not accept a replacement under a DIFFERENT property id", () => {
    const entries = [entry({ artifactId: "a-2", propertyId: "r2-09", verdict: "CLEAN" }), entry({ artifactId: "a-1" })];
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries })).toContain("no CURRENT, conclusive");
  });

  it("does not accept a STALE pass as the replacement", () => {
    const stale = entry({
      artifactId: "a-2",
      freshness: { kind: "stale", reason: "the tree moved" },
      verdict: "CLEAN",
    });
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries: [stale, entry()] })).toContain(
      "no CURRENT, conclusive",
    );
  });

  it("refuses an artifact that never ran on this branch", () => {
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "nope", entries: [entry()] })).toBe(
      "no pass with artifact id nope ran on this branch in this checkout",
    );
  });

  it("refuses a second retirement of the same pass, because the row is permanent", () => {
    const entries = [entry({ artifactId: "a-2", verdict: "CLEAN" }), entry({ artifactId: "a-1" })];
    expect(supersedeRefusal({ alreadyRetired: new Set(["a-1"]), artifactId: "a-1", entries })).toBe(
      "a-1 is already superseded — one row retires it once, and the row is permanent",
    );
  });

  it("refuses a PLANNING pass, which reviews no property wording", () => {
    const plan = entry({ artifactId: "a-1", mode: "plan", pass: "p2", propertyId: undefined, verdict: "READY" });
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries: [plan] })).toBe(
      "a-1 is a plan pass; only a REVIEW pass reviews a property wording",
    );
  });

  it("refuses a pass that is already stale, since retiring it would change nothing", () => {
    const stale = entry({ freshness: { kind: "stale", reason: "the tree moved" } });
    expect(supersedeRefusal({ alreadyRetired: NONE, artifactId: "a-1", entries: [stale] })).toBe(
      "a-1 is STALE, not current, so it already counts for nothing — retiring it would record a decision " +
        "that changes nothing",
    );
  });
});

describe("two findings cannot retire each other", () => {
  it("refuses a replacement that is itself already retired", () => {
    // A Codex review's counterexample, executed against the real guard: with A and B both CURRENT and
    // BROKEN under one property, B replaces A and then the already-retired A replaces B. Both findings stop
    // counting and the property is left with no live pass — the exact escape this verb exists to deny.
    const a = entry({ artifactId: "a-1" });
    const b = entry({ artifactId: "b-1" });
    const afterFirst = [
      { ...b },
      {
        ...a,
        superseded: {
          artifactId: "a-1",
          atIso: "2026-09-12T12:00:00.000Z",
          propertyId: "r2-08",
          reason: "wording replaced",
          replacedBy: "b-1",
        },
      },
    ];
    expect(supersedeRefusal({ alreadyRetired: new Set(["a-1"]), artifactId: "b-1", entries: afterFirst })).toContain(
      "no CURRENT, conclusive pass under r2-08 stands beside b-1",
    );
  });

  it("still allows the retirement when a LIVE pass under the property remains", () => {
    const live = entry({ artifactId: "c-1", verdict: "CLEAN" });
    const retired = {
      ...entry({ artifactId: "a-1" }),
      superseded: {
        artifactId: "a-1",
        atIso: "2026-09-12T12:00:00.000Z",
        propertyId: "r2-08",
        reason: "wording replaced",
        replacedBy: "c-1",
      },
    };
    const entries = [live, { ...entry({ artifactId: "b-1" }) }, retired];
    expect(supersedeRefusal({ alreadyRetired: new Set(["a-1"]), artifactId: "b-1", entries })).toBeUndefined();
  });
});

describe("replacementFor", () => {
  it("picks the newest current conclusive pass under the same property, never the pass itself", () => {
    const target = entry({ artifactId: "a-1" });
    const entries = [
      entry({ artifactId: "a-3", verdict: "CLEAN" }),
      entry({ artifactId: "a-2", verdict: "BROKEN" }),
      target,
    ];
    expect(replacementFor({ entries, target })?.artifactId).toBe("a-3");
  });

  it("accepts a BROKEN replacement, because a retirement is about the WORDING and not the answer", () => {
    // Retiring an unsatisfiable wording must not require the replacement to be green — otherwise the verb
    // could only ever be used to reach a pass, which is the dismissal shape this design refuses.
    const target = entry({ artifactId: "a-1" });
    const entries = [entry({ artifactId: "a-2", verdict: "BROKEN" }), target];
    expect(replacementFor({ entries, target })?.verdict).toBe("BROKEN");
  });

  it("answers undefined when the only other pass is a plan", () => {
    const target = entry({ artifactId: "a-1" });
    const plan = entry({ artifactId: "a-2", mode: "plan", pass: "p2", verdict: "READY" });
    expect(replacementFor({ entries: [plan, target], target })).toBeUndefined();
  });
});
