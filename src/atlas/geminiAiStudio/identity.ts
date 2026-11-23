/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `gemini-ai-studio:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's
 * atlas can produce the same id for a different thing.
 *
 * There is no version component, and that is the point rather than an omission: the same operation published
 * at `v1`, `v1beta` and `v1alpha` is ONE thing this atlas holds, carrying the versions that declare it as a
 * field. A version in the id would make three rows out of one and hide the only interesting question about
 * them, which is where the three disagree.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { GeminiAiStudioKind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the version-independent dotted method name, or the declared route for a page
 * @returns a 32-character hex digest
 */
export function geminiAiStudioEntityId({ kind, providerId }: { kind: GeminiAiStudioKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `gemini-ai-studio:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function geminiAiStudioGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
