/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * Three of these are open by construction on every successful run, and saying so is the point: an atlas
 * should be the thing that reports a gap it cannot close, not the thing that hides one it cannot fix.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { geminiAiStudioGapId } from "./identity.js";
import type { GeminiAiStudioAtlasGap, GeminiAiStudioChannel, GeminiAiStudioKind } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_GAP_CONDITIONS = [
  "spec-unreachable",
  /**
   * Google served a document whose revision or census is not the one `specLock.ts` reviewed. NOT a failure:
   * the endpoint is live by construction, so this records that what was published is newer than what was
   * read by a human, with the deltas on the gap.
   */
  "spec-revision-moved",
  "spec-root-undeclared",
  /**
   * Two published versions declare the same operation with a different shape — a different path, HTTP
   * method, response schema or query-parameter set. The compiled channel's own corroboration output.
   */
  "version-shape-disagreement",
  /**
   * Permanent while this row holds no entity. The organisation's Gemini footprint is the Google Admin
   * atlas's, and that atlas landed as a SURFACE MAP on the same §6 test that made this one a surface map —
   * so the holder this atlas names says WHERE those entities live and which administrator scope reaches
   * them, and holds no record itself. This gap keeps the `held-elsewhere` cell falsifiable by saying that
   * out loud, because a cell a reader takes as "somebody has these" would be the unfalsifiable claim
   * `kit/contract.ts` warns about wearing a truer-sounding name. It replaced `entities-holder-unbuilt`,
   * which stopped being true the day that atlas landed.
   */
  "entities-holder-is-a-surface-map",
  /**
   * Permanent while no Gemini API key is configured. Nothing on this installation has ever called the
   * platform, so every compiled operation is a declaration rather than a capability.
   */
  "api-credential-absent",
  "browser-page-unreachable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  /**
   * A reviewed disposition rule that matched nothing in the documents. A dead rule reads as considered
   * judgement and is not one, so the sync raises it rather than letting it rot unnoticed.
   */
  "disposition-rule-never-fired",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 *
 * @internal
 */
export type GeminiAiStudioGapCondition = (typeof GEMINI_AI_STUDIO_GAP_CONDITIONS)[number];

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openGeminiAiStudioGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: GeminiAiStudioGapCondition;
  scope: string;
  kind: GeminiAiStudioKind | null;
  surfaces: readonly GeminiAiStudioChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): GeminiAiStudioAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: geminiAiStudioGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/**
 * A condition and scope that were genuinely rechecked, and what the recheck found.
 *
 * @internal
 */
export type GeminiAiStudioGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileGeminiAiStudioGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly GeminiAiStudioAtlasGap[];
  observed: readonly GeminiAiStudioAtlasGap[];
  rechecks: readonly GeminiAiStudioGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly GeminiAiStudioAtlasGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 *
 * @internal
 */
export function openGeminiAiStudioGaps({
  gaps,
}: {
  gaps: readonly GeminiAiStudioAtlasGap[];
}): readonly GeminiAiStudioAtlasGap[] {
  return openGaps({ gaps });
}
