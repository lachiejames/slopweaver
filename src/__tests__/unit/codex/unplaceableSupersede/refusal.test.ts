/**
 * Retiring a pass that recorded NO TREE (an owner ruling: a supersede verb, explicit and journalled, the gate
 * fail-closed by default).
 *
 * The shape under test is a measured one: a plan READY with no tree, a later placed p2 READY, and a pull request
 * unable to land without a hatch because nothing could retire the first.
 */

import { describe, expect, it } from "vitest";

import { unplaceableReplacementFor, unplaceableSupersedeRefusal } from "../../../../codex/supersession.js";
import type { UnplaceableRecord } from "../../../../codex/unplaceable.js";
import { entry, LATER_PLAN, NO_TREE_AT, NO_TREE_PLAN } from "./harness.js";

describe("unplaceableSupersedeRefusal", () => {
  it("allows the measured shape: a no-tree p2 and a later placed p2", () => {
    expect(
      unplaceableSupersedeRefusal({
        alreadyRetired: new Set(),
        artifactId: "b44980e5",
        entries: [LATER_PLAN],
        unplaceable: [NO_TREE_PLAN],
      }),
    ).toBeUndefined();
    expect(unplaceableReplacementFor({ entries: [LATER_PLAN], target: NO_TREE_PLAN })!.artifactId).toBe("224c5d1c");
  });

  it("refuses an id that is not a no-tree record in this checkout", () => {
    expect(
      unplaceableSupersedeRefusal({
        alreadyRetired: new Set(),
        artifactId: "224c5d1c",
        entries: [LATER_PLAN],
        unplaceable: [NO_TREE_PLAN],
      }),
    ).toBe("224c5d1c is not a pass in this checkout that recorded no tree");
  });

  it("refuses a record already retired", () => {
    const retired = {
      ...NO_TREE_PLAN,
      superseded: {
        artifactId: "b44980e5",
        atIso: "x",
        branch: "feature",
        kind: "no-tree",
        mode: "plan",
        pass: "p2",
        reason: "r",
        replacedBy: "224c5d1c",
      },
    } satisfies UnplaceableRecord;
    expect(
      unplaceableSupersedeRefusal({
        alreadyRetired: new Set(["b44980e5"]),
        artifactId: "b44980e5",
        entries: [LATER_PLAN],
        unplaceable: [retired],
      }),
    ).toBe("b44980e5 is already superseded — one row retires it once, and the row is permanent");
  });

  /** It could be the newest BLOCKED plan — the reason the floor fails closed on it at all. */
  it("refuses when the only placed plan is OLDER than the no-tree record", () => {
    const older = { ...LATER_PLAN, createdAtIso: "2026-09-27T12:00:00.000Z" };
    expect(
      unplaceableSupersedeRefusal({
        alreadyRetired: new Set(),
        artifactId: "b44980e5",
        entries: [older],
        unplaceable: [NO_TREE_PLAN],
      }),
    ).toBe(
      "no later, conclusive plan pass with tree provenance stands on this branch beside b44980e5 (recorded " +
        "2026-09-27T13:55:03.688Z) — it could be the newest word, so retiring it would be a dismissal. Run the " +
        "plan again so it captures a tree, then retire this one",
    );
  });

  /** Unordered, as `planFailures` reads a same-instant BLOCKED. */
  it("refuses a replacement sharing the no-tree record's instant", () => {
    const tied = { ...LATER_PLAN, createdAtIso: NO_TREE_AT };
    expect(unplaceableReplacementFor({ entries: [tied], target: NO_TREE_PLAN })).toBeUndefined();
  });

  it("refuses a later plan whose own provenance is UNKNOWN", () => {
    const unknown = { ...LATER_PLAN, freshness: { kind: "unknown", reason: "no tree" } } as const;
    expect(unplaceableReplacementFor({ entries: [unknown], target: NO_TREE_PLAN })).toBeUndefined();
  });

  it("refuses a later plan that concluded nothing", () => {
    const noVerdict = { ...LATER_PLAN, verdict: "NO_VERDICT:bound" };
    expect(unplaceableReplacementFor({ entries: [noVerdict], target: NO_TREE_PLAN })).toBeUndefined();
  });

  it("refuses a later plan that is itself retired", () => {
    const retired = {
      ...LATER_PLAN,
      superseded: { artifactId: "224c5d1c", atIso: "x", propertyId: "p", reason: "r", replacedBy: "y" },
    };
    expect(unplaceableReplacementFor({ entries: [retired], target: NO_TREE_PLAN })).toBeUndefined();
  });

  it("refuses a later REVIEW as the replacement for a plan", () => {
    const review = entry({ artifactId: "r1-later", createdAtIso: "2026-09-27T16:00:00.000Z" });
    expect(unplaceableReplacementFor({ entries: [review], target: NO_TREE_PLAN })).toBeUndefined();
  });

  describe("a no-tree REVIEW", () => {
    const noTreeReview: UnplaceableRecord = { ...NO_TREE_PLAN, mode: "review", pass: "r1", propertyId: "r1-01" };

    it("is replaced by a later, CURRENT, conclusive review under the same property", () => {
      const later = entry({ artifactId: "r1-later", createdAtIso: "2026-09-27T16:00:00.000Z" });
      expect(unplaceableReplacementFor({ entries: [later], target: noTreeReview })!.artifactId).toBe("r1-later");
    });

    it("is not replaced by a review under another property", () => {
      const other = entry({ artifactId: "r1-other", createdAtIso: "2026-09-27T16:00:00.000Z", propertyId: "r1-02" });
      expect(unplaceableReplacementFor({ entries: [other], target: noTreeReview })).toBeUndefined();
    });

    it("is not replaced by a STALE review", () => {
      const stale = entry({
        artifactId: "r1-stale",
        createdAtIso: "2026-09-27T16:00:00.000Z",
        freshness: { kind: "stale", reason: "moved" },
      });
      expect(unplaceableReplacementFor({ entries: [stale], target: noTreeReview })).toBeUndefined();
    });
  });
});
