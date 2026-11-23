/*
 * The atlases whose gap vocabulary SPREADS the kit's own two conditions, and whose gaps close through the kit's
 * lifecycle.
 *
 * `kit/gaps.test.ts` already proves the lifecycle itself — first-detection preserved, a failed run closes
 * nothing, a duplicate refused. What it cannot prove is the seam each platform owns: that a platform's own
 * constructor mints the id the kit's reconcile will look up. Reconcile finds a stored gap by
 * `stableGapId({ condition, scope })`, so a platform whose id drifted from that would raise gaps nothing can
 * ever close. The composed open -> recheck -> closed case below is what breaks when that happens.
 */
import { describe, expect, it } from "vitest";

import { KIT_GAP_CONDITIONS } from "../../../../atlas/kit/gaps.js";
import { stableGapId } from "../../../../atlas/kit/identity.js";
import { AT, LATER, REASON, SCOPE } from "./harness.js";
import { SPREAD_CASES } from "./spreadCases.js";

describe("a vocabulary that spreads the kit's conditions", () => {
  it("covers every platform in this family", () => {
    expect(SPREAD_CASES.length).toBeGreaterThan(0);
    expect(SPREAD_CASES.map((entry) => entry.platform)).toEqual([
      "aether",
      "airtable",
      "braze",
      "clerk",
      "figma",
      "gemini-ai-studio",
      "inngest",
      "knock",
      "notion",
      "onepassword",
      "prisma-data-platform",
      "trelica",
    ]);
  });

  it.each(SPREAD_CASES)("$platform can raise every condition the kit requires", ({ vocabulary }) => {
    expect(KIT_GAP_CONDITIONS.filter((condition) => !vocabulary.includes(condition))).toEqual([]);
  });

  it.each(SPREAD_CASES)("$platform names no condition twice", ({ vocabulary }) => {
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
  });

  it.each(SPREAD_CASES)("$platform's constructor opens its gap stamped at the run's instant", ({ open, condition }) => {
    const gap = open({ at: AT });

    expect(gap.condition).toBe(condition);
    expect(gap.scope).toBe(SCOPE);
    expect(gap.reason).toBe(REASON);
    expect(gap.kind).toBe(null);
    expect(gap.status).toBe("open");
    expect(gap.firstDetectedAt).toBe(AT);
    expect(gap.lastDetectedAt).toBe(AT);
    expect(gap.lastCheckedAt).toBe(AT);
  });

  it.each(SPREAD_CASES)(
    "$platform's gap carries the caller's fields and surfaces through exactly",
    ({ open, carried }) => {
      expect(open({ at: AT })).toMatchObject(carried);
    },
  );

  it.each(SPREAD_CASES)(
    "$platform keys its gap on the kit's stable id, never on when it was found",
    ({ open, condition }) => {
      expect(open({ at: AT }).id).toBe(stableGapId({ condition, scope: SCOPE }));
      expect(open({ at: LATER }).id).toBe(open({ at: AT }).id);
    },
  );

  it.each(SPREAD_CASES)(
    "$platform's gap closes when its own condition and scope are rechecked",
    ({ openThenRecheck }) => {
      const reconciled = openThenRecheck();

      expect(reconciled.length).toBe(1);
      expect(reconciled[0]!.status).toBe("closed");
      expect(reconciled[0]!.lastCheckedAt).toBe(LATER);
      expect(reconciled[0]!.firstDetectedAt).toBe(AT);
    },
  );
});
