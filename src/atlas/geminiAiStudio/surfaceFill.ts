/**
 * Whether the compiled surface is FILLED is read off the store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent
 *
 * A descriptor's `status` is a static string. Left that way it is `filled` on every install, including one
 * where `atlas gemini-ai-studio sync` has never run — and `jumpcloud/surfaceFill.ts` records the two
 * measured cases where a static or existential grade was simply false about what a walk had reached. So the
 * flip is computed here, from what the manifest actually records, against an exact invariant: **every
 * applicable kind must carry a recorded success.** Not "most", not "at least one".
 *
 * ## What "applicable" excludes, and why that is not a loophole
 *
 * The `page` kind holds the browser surface's declared pages and is never written by a compile, so requiring
 * a success for it would make the compiled surface permanently unfillable for a reason that has nothing to
 * do with the discovery documents. It is excluded from the denominator and its own coverage cell says what
 * it is waiting on, which is the difference between a stated exclusion and a silent one.
 *
 * ## The other two surfaces have no store-derived route to `filled` at all yet
 *
 * `gemini-api` needs an API key this installation does not hold, and `studio-and-app-pages` needs a walk
 * that does not exist. Neither has a code path that could publish evidence, so both stay `declared-unfilled`
 * from the absence of evidence rather than from a literal somebody could edit — and each carries its own
 * reason, unchanged from the descriptor.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  GEMINI_AI_STUDIO_KINDS,
  GEMINI_AI_STUDIO_PAGE_KIND,
  type GeminiAiStudioAtlasManifest,
  type GeminiAiStudioKind,
} from "./model.js";

/** How many outstanding kinds an unfilled surface's reason names before it elides the rest. */
const OUTSTANDING_SHOWN = 8;

/**
 * Every kind the compiled surface is answerable for — the denominator of the fill check.
 *
 * @returns the declared kinds minus `page`, which only a browser walk can fill
 *
 * @internal
 */
export function applicableCompiledKinds(): readonly GeminiAiStudioKind[] {
  return GEMINI_AI_STUDIO_KINDS.filter((kind) => kind !== GEMINI_AI_STUDIO_PAGE_KIND);
}

/**
 * What the store says about the compiled surface.
 *
 * @internal
 */
export interface GeminiAiStudioCompiledFill {
  readonly filled: boolean;
  /** Applicable kinds carrying a recorded success. */
  readonly succeeded: number;
  /** Applicable kinds in total. */
  readonly applicable: number;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/**
 * Judge the compiled surface from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether the surface is filled, and the numbers behind the verdict
 *
 * @internal
 */
export function geminiAiStudioCompiledFill({
  manifest,
}: {
  manifest: GeminiAiStudioAtlasManifest | null;
}): GeminiAiStudioCompiledFill {
  const applicable = applicableCompiledKinds();
  const outstanding = applicable
    .filter((kind) => (manifest === null ? true : manifest.kinds[kind].lastSuccessAt === null))
    .toSorted();
  return {
    applicable: applicable.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: applicable.length - outstanding.length,
  };
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns the descriptor with the compiled surface's status derived rather than declared
 */
export function geminiAiStudioDescriptorFor({
  manifest,
}: {
  manifest: GeminiAiStudioAtlasManifest | null;
}): AtlasDescriptor {
  const fill = geminiAiStudioCompiledFill({ manifest });
  return {
    ...GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR,
    surfaces: GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.acquisition !== "compiled") {
        return surface;
      }
      if (fill.filled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      const head = fill.outstanding.slice(0, OUTSTANDING_SHOWN).join(", ");
      const tail = fill.outstanding.length > OUTSTANDING_SHOWN ? ", …" : "";
      return {
        ...surface,
        status: "declared-unfilled" as const,
        unfilledBecause:
          `${String(fill.succeeded)} of ${String(fill.applicable)} applicable kinds carry a recorded ` +
          `success; still outstanding: ${head}${tail}. Run: slopweaver atlas gemini-ai-studio sync`,
      };
    }),
  };
}
