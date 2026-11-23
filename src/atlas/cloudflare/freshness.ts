/**
 * Cloudflare's freshness POLICY. The judgement itself is `kit/freshness.ts`.
 *
 * Every atlas judges freshness identically — a verdict is a GATE rather than an annotation, and a future
 * timestamp is `indeterminate` rather than fresh because a negative age is a broken clock — and this atlas
 * had written those ~150 lines out a second time. The one thing that was genuinely Cloudflare's is the
 * limit below, which is why the kit takes it as a parameter.
 */
import { assessFreshness, type FreshnessAssessment, historicalQualifier } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";

import { CLOUDFLARE_ATLAS_DESCRIPTOR } from "./descriptor.js";

/**
 * How old a successful sync may be before it stops being an answer, in milliseconds.
 *
 * Read off the descriptor rather than declared here, because the owner's ruling puts the per-atlas window on
 * the descriptor, and a second number in a second file is how two clocks come to disagree. Cloudflare's
 * own reasoning for wanting two days rather than the four-hour default sits beside the field it declares.
 */
export const CLOUDFLARE_FRESHNESS_WINDOW_MS = atlasFreshnessWindowMs({ descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR });

/** The freshness of one stored answer, and the reasons behind the verdict. Kit-owned. */
export type CloudflareFreshnessAssessment = FreshnessAssessment;

/**
 * Judge whether a stored answer is current, historical, absent, or unjudgeable.
 *
 * @param lastSuccessAt when this source last synced successfully, or `null` if it never has
 * @param latestAttemptFailed whether the most recent attempt failed, whatever the last success says
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @param windowMs the policy window; defaults to {@link CLOUDFLARE_FRESHNESS_WINDOW_MS}
 * @returns the verdict, the age it rests on, and the notes to print
 */
export function assessCloudflareFreshness({
  lastSuccessAt,
  latestAttemptFailed,
  nowMs,
  windowMs = CLOUDFLARE_FRESHNESS_WINDOW_MS,
}: {
  lastSuccessAt: string | null;
  latestAttemptFailed: boolean;
  nowMs: number;
  windowMs?: number;
}): CloudflareFreshnessAssessment {
  return assessFreshness({ lastSuccessAt, latestAttemptFailed, nowMs, windowMs });
}

/**
 * The qualifier a number must carry when it is not current.
 *
 * @param assessment the verdict to label
 * @returns a bracketed qualifier, or an empty string when the answer is current
 */
export function cloudflareHistoricalQualifier({ assessment }: { assessment: CloudflareFreshnessAssessment }): string {
  return historicalQualifier({ assessment });
}
