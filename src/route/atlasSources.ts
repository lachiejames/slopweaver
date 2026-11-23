/**
 * Read the atlas registry, so `src/route/`'s pure planners can be handed one row per registered platform.
 *
 * The split is the one `./atlasReading.ts` and `./atlasReadings.ts` already established, for the same
 * reason: `./atlasCapability.ts` decides what a derived row SAYS and imports nothing from `src/atlas/`,
 * while this module performs the registry read. It is cheap — `atlas/registry.ts` holds strings and
 * `import()` thunks only, and a catalogue entry is data, so nothing here loads a platform's Zod model or
 * opens a generation.
 */
import { atlasCatalogueSummary } from "../atlas/kit/verbs.js";
import { atlasRegistrations } from "../atlas/registry.js";

import type { RegisteredAtlasSource } from "./atlasCapability.js";

/**
 * Every atlas this build registers, reduced to what a routing row needs.
 *
 * @returns one entry per registered platform, in registry order, each carrying the sentence the atlas
 *   writes about itself — or the kit's generic one where it declares none
 */
export function registeredAtlasSources(): readonly RegisteredAtlasSource[] {
  return atlasRegistrations().map((registration) => ({
    platform: registration.platform,
    summary: atlasCatalogueSummary({
      platform: registration.platform,
      summary: registration.catalogue.summary,
    }),
  }));
}
