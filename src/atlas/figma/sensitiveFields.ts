/**
 * The response fields this atlas withholds, named by KIND rather than by bare name.
 *
 * ## Why this table exists BEFORE the first entity does
 *
 * Nothing in this generation carries an entity yet — this installation holds no Figma credential. The file
 * is still here, and reviewed, because the alternative is writing it in the same change that first fetches
 * real data, which is the change least able to review it carefully. The Datadog atlas's own lesson was that
 * the INSTRUMENT matters more than any row: an incomplete denial table is worse than a missing one, because
 * it makes the table look finished.
 *
 * ## A bare-name denylist would be catastrophically wrong here, and that is measured
 *
 * Scanning every schema in the pinned document for credential-shaped property names returns 46 hits.
 * Reproduce with:
 *
 * ```bash
 * yarn tsx tools/generateFigmaSurfaces.ts --verify   # confirms the document these names were read from
 * ```
 *
 * Of those 46, exactly ONE name carries credential material. Every other hit is a `key` — and on Figma a
 * `key` is the platform's own stable public identifier for a component, a component set, a style, a
 * variable, a variable collection or a file. `Component.key` is the value `getComponent` takes as its path
 * parameter. Denying on the substring `key` would not withhold a secret; it would delete the primary
 * identifier of most of this atlas's entity kinds and keep nothing extra. The same conclusion the Airtable
 * and Datadog atlases reached, arrived at independently and considerably more sharply.
 *
 * So every denial names the field AND the kind it is denied under, and `figmaFieldIsWithheld` is the one
 * place that decision is made.
 *
 * ## The one denial is DEFENCE IN DEPTH, and saying so is more useful than overstating it
 *
 * `WebhookV2.passcode` is the shared secret Figma echoes back in every delivery so a receiver can
 * authenticate the call. Figma already blanks it on the read path — its own description says "For security,
 * when using the GET endpoints, the value is an empty string" — so on the operations this read-only atlas
 * calls, the field arrives empty anyway. The denial stays because a table whose correctness depends on a
 * vendor continuing to blank a field is not a table, and because `postWebhook` and `putWebhook` return the
 * populated value should this atlas ever stop being read-only. Claiming it as the thing that stops a leak
 * would be the overstatement; recording what it actually is costs one sentence.
 *
 * ## Three fields carry a person's EMAIL, and none of them needs a denial
 *
 * `ActivityLogUserEntity.email`, `DeveloperLogActor.user_email` and `AiUsageDailyRow.user_email` sit
 * exclusively on families `exclusions.ts` marks `shape-index` — the activity log, the developer log and the
 * AI-usage feed — whose rows are never stored at all. The absence of a denial for them is therefore a
 * consequence of a disposition rather than an oversight, and it is written down here because an unstated
 * absence is exactly what a later reader mistakes for one.
 */
import type { FigmaAtlasKind } from "./kinds.js";

/**
 * One withheld field: the name, the kinds it is withheld under, and why.
 * @internal
 */
export interface FigmaFieldDenial {
  /** The property name exactly as the response carries it. */
  readonly field: string;
  /** The kinds this name carries credential material under. Never "every kind". */
  readonly kinds: readonly FigmaAtlasKind[];
  /** Why it is material, in English, so a reader can disagree with the judgement rather than the list. */
  readonly reason: string;
}

/**
 * Every field withheld from a stored entity, and where.
 *
 * One row, and the count is the finding rather than a shortfall — see this file's header on the 46
 * credential-shaped names that turned out to be public identifiers.
 */
export const FIGMA_FIELD_DENIALS: readonly FigmaFieldDenial[] = [
  {
    field: "passcode",
    kinds: ["webhook"],
    reason:
      "the shared secret Figma passes back to a webhook's endpoint so the receiver can tell a genuine" +
      " delivery from a forged one. A copy here would let anything that can read this atlas forge a" +
      " delivery to that endpoint. Figma blanks it on the GET operations this atlas calls, which makes the" +
      " denial defence in depth rather than the thing that stops a leak — but the create and update" +
      " operations return it populated, so the rule belongs on the FIELD rather than on today's caller",
  },
];

/**
 * Whether one field of one kind is withheld from storage.
 *
 * @param field the property name as the response carries it
 * @param kind the kind the entity being projected belongs to
 * @returns the denial that applies, or `null` when the field may be stored
 */
export function figmaFieldIsWithheld({
  field,
  kind,
}: {
  field: string;
  kind: FigmaAtlasKind;
}): FigmaFieldDenial | null {
  const denial = FIGMA_FIELD_DENIALS.find((row) => row.field === field && row.kinds.includes(kind));
  if (denial === undefined) {
    return null;
  }
  return denial;
}
