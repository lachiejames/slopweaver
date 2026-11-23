/**
 * Whether the two published surfaces are FILLED is read off the store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent
 *
 * A descriptor's `status` is a static string. Left that way it is `filled` on every install, including one
 * where `atlas braze sync` has never run — and `jumpcloud/surfaceFill.ts` records the two measured cases
 * where a static or existential grade was simply false about what a walk had reached. So the flip is computed
 * here, from what the manifest actually records, against an exact invariant: **every applicable kind must
 * carry a recorded success.** Not "most", not "at least one".
 *
 * ## Both compiled surfaces share one denominator, and that is deliberate
 *
 * One `sync` writes both channels in one pass over the same kinds, so there is no state in which the
 * reference is complete and the collection is not. Deriving them separately would invent a distinction the
 * writer cannot produce, and a reader would reasonably conclude the two could drift apart on disk. They
 * cannot; what they disagree about is CONTENT, which is what `report.ts` is for.
 *
 * ## What "applicable" excludes, and why that is not a loophole
 *
 * The `page` kind holds the browser surface's declared routes and is never written by a compile, so requiring
 * a success for it would make the published surfaces permanently unfillable for a reason that has nothing to
 * do with either document. It is excluded from the denominator and its own coverage cell says what it is
 * waiting on, which is the difference between a stated exclusion and a silent one.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { BRAZE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { BRAZE_KINDS, BRAZE_PAGE_KIND, type BrazeAtlasManifest, type BrazeKind } from "./model.js";

/**
 * Every kind the published surfaces are answerable for — the denominator of the fill check.
 *
 * @returns the declared kinds minus `page`, which only a browser walk can fill
 *
 * @internal
 */
export function applicablePublishedKinds(): readonly BrazeKind[] {
  return BRAZE_KINDS.filter((kind) => kind !== BRAZE_PAGE_KIND);
}

/**
 * What the store says about the published surfaces.
 *
 * @internal
 */
export interface BrazePublishedFill {
  readonly filled: boolean;
  /** Applicable kinds carrying a recorded success. */
  readonly succeeded: number;
  /** Applicable kinds in total. */
  readonly applicable: number;
  /** Kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/** How many outstanding kinds are named before the list is elided. */
const OUTSTANDING_SHOWN = 8;

/**
 * Judge the published surfaces from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether they are filled, and the numbers behind the verdict
 *
 * @internal
 */
export function brazePublishedFill({ manifest }: { manifest: BrazeAtlasManifest | null }): BrazePublishedFill {
  const applicable = applicablePublishedKinds();
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
 * @returns the descriptor with both compiled surfaces' status derived rather than declared
 */
export function brazeDescriptorFor({ manifest }: { manifest: BrazeAtlasManifest | null }): AtlasDescriptor {
  const fill = brazePublishedFill({ manifest });
  return {
    ...BRAZE_ATLAS_DESCRIPTOR,
    surfaces: BRAZE_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
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
        unfilledBecause: `${String(fill.succeeded)} of ${String(fill.applicable)} applicable kinds carry a recorded success; still outstanding: ${head}${tail}. Run: slopweaver atlas braze sync`,
      };
    }),
  };
}
