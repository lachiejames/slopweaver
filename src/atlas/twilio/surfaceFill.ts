/**
 * Whether a surface is FILLED is read off this install's own store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent, measured three times on siblings
 *
 * A descriptor's `status` is a static string. Left that way it is filled on every install, including one
 * where the sync has never run — and the sibling atlases prove the failure is not hypothetical. The Slack
 * atlas graded its browser surface synced whenever pages-walked exceeded zero, while canon records it
 * left destinations it asked for unreached. The CrowdStrike walk graded green while its declared console
 * routes went unlanded, every miss screenshotted and classified. The Notion walk reported pages
 * reached and photographed, and every one of those screenshots was the same not-found shell.
 *
 * So the flip is computed here, from what the manifest actually records, against an exact invariant: **both
 * compiled kinds must carry a recorded success**. Not "most", not "at least one" — the kit's own success
 * predicate is existential, and inheriting that here would make `filled` mean "something worked once".
 *
 * ## What the denominator is, and why it is two kinds rather than five
 *
 * `api` and `method` are what a compile of the published definitions produces, so they are what its own
 * success is measured over. `account` and `resource` belong to the credentialled surface and `page` to the
 * console walk; requiring a success for any of them would make the definition surface permanently
 * unfillable for a reason that has nothing to do with the definitions. Each of those three says what it is
 * waiting for in its own coverage cell, which is the difference between a stated exclusion and a silent one.
 *
 * The console surface has a store-derived route of its own — {@link twilioConsoleFilled}, keyed on the page
 * kind's `lastSuccessAt` rather than on a page COUNT, because a signed-out walk writes eighty rows and
 * reaches nothing. MEASURED, one signed-in walk on the owner's install flipped it, its pages landed and
 * photographed. `account-api` is the one surface with no derived route, and it is not waiting on evidence —
 * it is waiting on a ruling about a WRITE, which `descriptor.ts` states. It stays `declared-unfilled` from
 * the absence of a credential rather than from a literal somebody could edit.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { TWILIO_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { TwilioAtlasKind, TwilioAtlasManifest } from "./model.js";

/**
 * The kinds a compile of the published definitions is answerable for — the denominator of the fill check.
 *
 * @returns the two compiled kinds, in declaration order
 *
 * @internal
 */
export function compiledKinds(): readonly TwilioAtlasKind[] {
  return ["api", "method"];
}

/**
 * What the store says about the definition surface.
 * @internal
 */
export interface TwilioSpecFill {
  readonly filled: boolean;
  /** Compiled kinds carrying a recorded success. */
  readonly succeeded: number;
  /** Compiled kinds in total. */
  readonly applicable: number;
  /** Compiled kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
}

/**
 * Judge the definition surface from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether the surface is filled, and the numbers behind the verdict
 */
export function twilioSpecFill({ manifest }: { manifest: TwilioAtlasManifest | null }): TwilioSpecFill {
  const applicable = compiledKinds();
  const outstanding = applicable.filter((kind) => manifest?.kinds[kind].lastSuccessAt == null).toSorted();
  return {
    applicable: applicable.length,
    filled: manifest !== null && outstanding.length === 0,
    outstanding,
    succeeded: applicable.length - outstanding.length,
  };
}

/**
 * Whether the console surface has actually reached a page.
 *
 * Separate from the manifest's own success flag because a signed-out walk RUNS and records an attempt: the
 * page kind gets a file, a coverage cell and eighty rows, none of which is a page this atlas holds. Keyed
 * on `lastSuccessAt`, which `walkPublish.ts` deliberately does not advance when every route hit the wall.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether at least one console page has been reached and photographed
 *
 * @internal
 */
export function twilioConsoleFilled({ manifest }: { manifest: TwilioAtlasManifest | null }): boolean {
  return manifest?.kinds.page.lastSuccessAt != null;
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns the descriptor with the compiled and browser surfaces derived rather than declared
 */
export function twilioDescriptorFor({ manifest }: { manifest: TwilioAtlasManifest | null }): AtlasDescriptor {
  const fill = twilioSpecFill({ manifest });
  const consoleFilled = twilioConsoleFilled({ manifest });
  return {
    ...TWILIO_ATLAS_DESCRIPTOR,
    surfaces: TWILIO_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.acquisition === "driven-browser" && consoleFilled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      if (surface.acquisition !== "compiled") {
        return surface;
      }
      if (fill.filled) {
        return { ...surface, status: "filled" as const, unfilledBecause: null };
      }
      return {
        ...surface,
        status: "declared-unfilled" as const,
        unfilledBecause:
          `${String(fill.succeeded)} of ${String(fill.applicable)} compiled kinds carry a recorded ` +
          `success; still outstanding: ${fill.outstanding.join(", ")}. Run: slopweaver atlas twilio sync`,
      };
    }),
  };
}
