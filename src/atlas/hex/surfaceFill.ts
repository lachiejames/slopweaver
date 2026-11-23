/**
 * Whether a surface is FILLED is read off this install's own store, never off a literal in the descriptor.
 *
 * ## The failure this exists to prevent, measured three times on siblings
 *
 * A descriptor's `status` is a static string. Left that way it is filled on every install, including one
 * where the sync has never run — and the sibling atlases prove the failure is not hypothetical. The Slack
 * atlas graded its browser surface synced whenever pages-walked exceeded zero, while canon records it
 * reached only one of the destinations it asked for. The CrowdStrike walk declared every compiled console
 * route and a single one landed, every miss screenshotted, classified and green. The Notion walk reported
 * its pages reached and photographed, and every one of those screenshots was the same not-found shell.
 *
 * So the flip is computed here, from what the manifest actually records, against an exact invariant: **both
 * compiled kinds must carry a recorded success**. Not "most", not "at least one" — the kit's own success
 * predicate is existential, and inheriting that here would make `filled` mean "something worked once".
 *
 * ## Three api-channel surfaces share ONE denominator, and that is not a shortcut
 *
 * `spec-declared`, `unauthenticated-probe` and `client-bundle` are three bodies of evidence published by one
 * pass over two kinds. There is no way for the census to publish and the document not to: `sync.ts` builds
 * both kind files or neither. So one derived verdict is the honest one, and giving each surface a
 * denominator of its own would invent three independent states a single publish can never produce.
 *
 * The `web-app` surface has a store-derived route of its own — {@link hexWebAppFilled}, keyed on the page
 * kind's `lastSuccessAt` rather than on a page COUNT, because a signed-out walk writes rows and reaches
 * nothing. `workspace-api` is the one surface with no derived route, and it is not waiting on evidence — it
 * is waiting on a ruling about a WRITE, which `descriptor.ts` states.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { HEX_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { HexAtlasKind, HexAtlasManifest } from "./model.js";

/**
 * The kinds one compile of the anonymous evidence is answerable for — the denominator of the fill check.
 *
 * @returns the two compiled kinds, in declaration order
 *
 * @internal
 */
export function compiledKinds(): readonly HexAtlasKind[] {
  return ["api", "method"];
}

/**
 * What the store says about the three compiled surfaces.
 * @internal
 */
export interface HexSpecFill {
  /** Compiled kinds in total. */
  readonly applicable: number;
  readonly filled: boolean;
  /** Compiled kinds with no recorded success, sorted — what a reader chases. */
  readonly outstanding: readonly string[];
  /** Compiled kinds carrying a recorded success. */
  readonly succeeded: number;
}

/**
 * Judge the compiled surfaces from the manifest alone.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether they are filled, and the numbers behind the verdict
 *
 * @internal
 */
export function hexSpecFill({ manifest }: { manifest: HexAtlasManifest | null }): HexSpecFill {
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
 * Whether the web-app surface has actually reached a page.
 *
 * Separate from the manifest's own success flag because a signed-out walk RUNS and records an attempt: the
 * page kind gets a file, a coverage cell and a row per declared route, none of which is a page this atlas
 * holds. Keyed on `lastSuccessAt`, which `walkPublish.ts` deliberately does not advance when every route
 * hit the wall.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns whether at least one app page has been reached and photographed
 *
 * @internal
 */
export function hexWebAppFilled({ manifest }: { manifest: HexAtlasManifest | null }): boolean {
  return manifest?.kinds.page.lastSuccessAt != null;
}

/**
 * The descriptor as this install's own store makes it true.
 *
 * @param manifest the published manifest, or `null` when nothing has been published
 * @returns the descriptor with the compiled and browser surfaces derived rather than declared
 */
export function hexDescriptorFor({ manifest }: { manifest: HexAtlasManifest | null }): AtlasDescriptor {
  const fill = hexSpecFill({ manifest });
  const webAppFilled = hexWebAppFilled({ manifest });
  return {
    ...HEX_ATLAS_DESCRIPTOR,
    surfaces: HEX_ATLAS_DESCRIPTOR.surfaces.map((surface) => {
      if (surface.acquisition === "driven-browser") {
        return webAppFilled ? { ...surface, status: "filled" as const, unfilledBecause: null } : surface;
      }
      if (surface.name === "workspace-api") {
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
          `success; still outstanding: ${fill.outstanding.join(", ")}. Run: slopweaver atlas hex sync`,
      };
    }),
  };
}
