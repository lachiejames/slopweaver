/**
 * Feature prominence — whether the smallest thing the evidence rests on survives being shown in a box.
 *
 * ## What this is and is not
 *
 * A scale-free ratio does not work: `12 / 6722 ≈ 0.001785` is 0.89px in a
 * 500px box and 12px at native size, so "illegible in any box" does not follow from a ratio, and a ratio
 * alone also misses low native resolution, contrast and blur. So this is named for what it measures: the
 * projected size of the smallest text feature inside a DECLARED display box. It is not proof of
 * readability at every Slack thumbnail size, and the reviewer's own read-back of the final bytes stays
 * required (`./types.ts`).
 *
 * ## The profile is declared, and the boundary is calibrated on measured captures
 *
 * The box is 1400x900 — what a desktop Slack client gives an image once it is clicked open, stated as an
 * assumption rather than a measurement of Slack. The feature is the smallest computed font size among the
 * target's own text leaves, scaled to image pixels (`observation.ts` § smallestFontPx): on the Log
 * Explorer that is the 10px axis label and facet count, painted at 1.5 on the owner's 75%-zoomed Chrome,
 * so 15 image pixels. Calibration, all on the Log Explorer (`/logs?…viz=timeseries`)
 * (reproduce: `slopweaver browser shot --url <that address> --json` and read `evidence.legibility`):
 *
 * | capture                                   | size      | feature | fit   | projected | verdict |
 * | ----------------------------------------- | --------- | ------- | ----- | --------- | ------- |
 * | incident image, full page, 20s settle     | 4032x6722 | 15px    | 0.134 | 2.0px     | fail    |
 * | `--raw` full page, 5s settle, this build  | 4032x6512 | 15px    | 0.138 | 2.1px     | fail    |
 * | evidence crop, this build (`live8`)       | 2772x1510 | 15px    | 0.505 | 7.6px     | pass    |
 *
 * `MIN_PROJECTED_FEATURE_PX` is 7: below the one positive sample, 3.5x above both negatives, and — the
 * reason it is 7 rather than 8 — the same label is 7.5 device-independent pixels on the owner's OWN screen
 * at that zoom, so a floor above that would refuse what the owner reads every day. The unit test for this module
 * pins all three rows so a moved threshold has to move the table.
 */

/** The box an image is judged in. Declared, not measured — see the module header. */
export interface DisplayProfile {
  readonly name: string;
  readonly fitWidthPx: number;
  readonly fitHeightPx: number;
}

/** The whole policy: a version, a box and a floor. */
export interface LegibilityPolicy {
  readonly version: number;
  readonly profile: DisplayProfile;
  readonly minProjectedFeaturePx: number;
}

/** The smallest projected feature the policy accepts, in display pixels. */
export const MIN_PROJECTED_FEATURE_PX = 7;

/** The policy this build judges by. */
export const LEGIBILITY_POLICY_V1: LegibilityPolicy = {
  minProjectedFeaturePx: MIN_PROJECTED_FEATURE_PX,
  profile: { fitHeightPx: 900, fitWidthPx: 1400, name: "slack-desktop-expanded-v1" },
  version: 1,
};

/** What is measured about one final image. */
export interface ImageMeasurements {
  readonly widthPx: number;
  readonly heightPx: number;
  /** The smallest text feature, in IMAGE pixels, or `null` when none could be measured. */
  readonly featurePx: number | null;
}

/** Why an image fails the policy. */
export type LegibilityIssue =
  | { readonly code: "FEATURE_UNMEASURED"; readonly message: string }
  | { readonly code: "FEATURE_TOO_SMALL"; readonly message: string; readonly projectedPx: number };

/**
 * The factor a `width x height` image is scaled by to fit the profile's box, never above 1.
 *
 * @param widthPx the image's width
 * @param heightPx the image's height
 * @param profile the box
 * @returns the scale, in `(0, 1]`
 */
export function fitScale({
  widthPx,
  heightPx,
  profile,
}: {
  widthPx: number;
  heightPx: number;
  profile: DisplayProfile;
}): number {
  return Math.min(1, profile.fitWidthPx / widthPx, profile.fitHeightPx / heightPx);
}

/**
 * How large the smallest feature is once the image fits the box.
 *
 * @param measurements the image's size and its smallest feature
 * @param profile the box
 * @returns the projected size in display pixels, or `null` when the feature was not measured
 */
export function projectedFeaturePx({
  measurements,
  profile,
}: {
  measurements: ImageMeasurements;
  profile: DisplayProfile;
}): number | null {
  if (measurements.featurePx === null) {
    return null;
  }
  return measurements.featurePx * fitScale({ heightPx: measurements.heightPx, profile, widthPx: measurements.widthPx });
}

/**
 * Everything that fails the policy. Empty is a pass.
 *
 * @param measurements the image's size and its smallest feature
 * @param policy the box and the floor
 * @returns every issue; empty when the projected feature clears the floor
 */
export function legibilityIssues({
  measurements,
  policy,
}: {
  measurements: ImageMeasurements;
  policy: LegibilityPolicy;
}): readonly LegibilityIssue[] {
  const projected = projectedFeaturePx({ measurements, profile: policy.profile });
  if (projected === null) {
    return [
      {
        code: "FEATURE_UNMEASURED",
        message: "no text feature was measured inside the target, so prominence cannot be judged",
      },
    ];
  }
  if (projected < policy.minProjectedFeaturePx) {
    return [
      {
        code: "FEATURE_TOO_SMALL",
        message:
          `the smallest text feature is ${String(measurements.featurePx)}px in a ` +
          `${String(measurements.widthPx)}x${String(measurements.heightPx)} image, which is ${projected.toFixed(1)}px ` +
          `once it fits ${policy.profile.name} (${String(policy.profile.fitWidthPx)}x${String(policy.profile.fitHeightPx)}); ` +
          `the floor is ${String(policy.minProjectedFeaturePx)}px`,
        projectedPx: projected,
      },
    ];
  }
  return [];
}
