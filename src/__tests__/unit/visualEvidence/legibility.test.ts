/**
 * Feature prominence, pinned to the calibration table in `legibility.ts`'s header: the two incident-shaped
 * negatives and the one live positive. A moved threshold has to move these rows.
 */
import { describe, expect, it } from "vitest";

import {
  fitScale,
  LEGIBILITY_POLICY_V1,
  legibilityIssues,
  MIN_PROJECTED_FEATURE_PX,
  projectedFeaturePx,
} from "../../../visualEvidence/legibility.js";

const PROFILE = LEGIBILITY_POLICY_V1.profile;

describe("fitScale", () => {
  it("never scales up", () => {
    expect(fitScale({ heightPx: 100, profile: PROFILE, widthPx: 100 })).toBe(1);
  });

  it("is bound by whichever axis overflows more", () => {
    expect(fitScale({ heightPx: 6722, profile: PROFILE, widthPx: 4032 })).toBeCloseTo(900 / 6722, 6);
    expect(fitScale({ heightPx: 1510, profile: PROFILE, widthPx: 2772 })).toBeCloseTo(1400 / 2772, 6);
  });
});

describe("the calibration table", () => {
  it("fails the incident image: 15px labels in a 4032x6722 full page project to 2.0px", () => {
    const measurements = { featurePx: 15, heightPx: 6722, widthPx: 4032 };
    expect(projectedFeaturePx({ measurements, profile: PROFILE })).toBeCloseTo(2.0, 1);
    const issues = legibilityIssues({ measurements, policy: LEGIBILITY_POLICY_V1 });
    expect(issues.map((issue) => issue.code)).toEqual(["FEATURE_TOO_SMALL"]);
    expect(issues[0]!.message).toBe(
      "the smallest text feature is 15px in a 4032x6722 image, which is 2.0px once it fits slack-desktop-expanded-v1 " +
        "(1400x900); the floor is 7px",
    );
  });

  it("fails this build's own --raw full page: 4032x6512 projects to 2.1px", () => {
    const measurements = { featurePx: 15, heightPx: 6512, widthPx: 4032 };
    expect(projectedFeaturePx({ measurements, profile: PROFILE })).toBeCloseTo(2.1, 1);
    expect(legibilityIssues({ measurements, policy: LEGIBILITY_POLICY_V1 }).length).toBe(1);
  });

  it("passes the evidence crop: 2772x1510 projects to 7.6px", () => {
    const measurements = { featurePx: 15, heightPx: 1510, widthPx: 2772 };
    expect(projectedFeaturePx({ measurements, profile: PROFILE })).toBeCloseTo(7.58, 2);
    expect(legibilityIssues({ measurements, policy: LEGIBILITY_POLICY_V1 })).toEqual([]);
  });

  it("sits the floor at 7, and a feature projecting just under it fails", () => {
    expect(MIN_PROJECTED_FEATURE_PX).toBe(7);
    // 13.8px at fit 0.505 = 6.97
    const measurements = { featurePx: 13.8, heightPx: 1510, widthPx: 2772 };
    expect(legibilityIssues({ measurements, policy: LEGIBILITY_POLICY_V1 }).map((issue) => issue.code)).toEqual([
      "FEATURE_TOO_SMALL",
    ]);
  });
});

describe("legibilityIssues", () => {
  it("cannot judge an unmeasured feature, and says so rather than passing", () => {
    const issues = legibilityIssues({
      measurements: { featurePx: null, heightPx: 100, widthPx: 100 },
      policy: LEGIBILITY_POLICY_V1,
    });
    expect(issues.map((issue) => issue.code)).toEqual(["FEATURE_UNMEASURED"]);
    expect(
      projectedFeaturePx({ measurements: { featurePx: null, heightPx: 100, widthPx: 100 }, profile: PROFILE }),
    ).toBe(null);
  });

  it("passes a small image whose feature needs no scaling", () => {
    expect(
      legibilityIssues({ measurements: { featurePx: 7, heightPx: 400, widthPx: 600 }, policy: LEGIBILITY_POLICY_V1 }),
    ).toEqual([]);
  });
});
