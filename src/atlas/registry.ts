/**
 * Which atlases this build has, and the one seam EVERY generic verb goes through.
 *
 * `kit/contract.ts` makes ONE platform per atlas a type; `kit/registration.ts` makes what a platform
 * contributes a shape; this file makes it a lookup. A platform appears here exactly once, and
 * `slopweaver atlas <p> <verb>` resolves through it rather than through a switch in the CLI — the kit's
 * four verbs, the platform's own, its catalogue row and its usage block all read the same row. So adding an
 * atlas is one `registration.ts` beside its descriptor, named as the `atlas` feature of its integration's
 * manifest (`src/integrations/<id>/integration.ts`), and no verb, manifest or dispatcher changes.
 *
 * ## The list is DERIVED from the integration registry
 *
 * The rows are every integration's `atlas` feature, read off `src/integrations/registry.ts` in its order —
 * alphabetical by id, and an atlas's id is its platform name, so the catalogue order is alphabetical by platform.
 * There is no second list of atlases here to forget a row in: `unit/integrations/registry.test.ts` pins the set
 * and the order, and `unit/atlas/registryCoversEveryAtlas.test.ts` still fails a descriptor on disk no row reaches.
 *
 * ## Why every registration is cheap to import
 *
 * Each row is strings and `import()` thunks only — its descriptor, its read adapter and each verb's run
 * module are loaded when asked for and never before. Loading all of them to answer one verb would make the
 * cheapest verb in the noun pay for every atlas in the build, which is the same reason `cli/manifest.ts`
 * loads command modules lazily. That is why the integration registry can import every row eagerly and why the
 * manifest can build a catalogue row from each without loading anything.
 */
import { atlasRegistrationsOf, integrations } from "../integrations/registry.js";

import type { AtlasPlatformRegistration } from "./kit/registration.js";

export type { AtlasPlatformRegistration } from "./kit/registration.js";

/**
 * Every platform, in the order a catalogue lists them.
 *
 * Alphabetical by PLATFORM NAME rather than by age, so the list a reader gets back from an unknown-platform
 * error is predictable — `slack` sorts by its platform, not by its `slackApi/` directory.
 */
const REGISTRATIONS: readonly AtlasPlatformRegistration[] = atlasRegistrationsOf({ manifests: integrations() });

/**
 * Every platform name this build can read.
 *
 * @returns the platform names, in registry order
 */
export function atlasPlatforms(): readonly string[] {
  return REGISTRATIONS.map((registration) => registration.platform);
}

/**
 * Every registration, in registry order — what a manifest or a sweep iterates.
 *
 * Each row's read is guarded exactly as {@link findAtlasPlatform}'s is, so there is no unguarded door to a
 * `readSnapshot` anywhere.
 *
 * @returns the guarded registrations
 */
export function atlasRegistrations(): readonly AtlasPlatformRegistration[] {
  return REGISTRATIONS.map((registration) => guarded({ registration }));
}

/**
 * The registration for one platform.
 *
 * The returned registration's read is WRAPPED: every snapshot goes through
 * {@link refuseUnanswerableAtlas} before it reaches a caller, so an atlas that cannot answer refuses rather
 * than answering nothing. Applying it here rather than in each adapter is deliberate — this is the only
 * door to a `readSnapshot`, so a new atlas inherits the guard by being registered and there is nothing to
 * remember and nothing to reach around.
 *
 * @param platform the platform name a caller asked for
 * @returns its guarded registration, or `null` when this build has no such atlas — the CALLER turns that
 *   into an {@link AtlasReadError}, because only it knows whether a miss is worth the known-platform list
 */
export function findAtlasPlatform({ platform }: { platform: string }): AtlasPlatformRegistration | null {
  const registration = REGISTRATIONS.find((candidate) => candidate.platform === platform);
  if (registration === undefined) {
    return null;
  }
  return guarded({ registration });
}

/** The row with its read wrapped in the answerability guard; every other field passes through untouched. */
function guarded({ registration }: { registration: AtlasPlatformRegistration }): AtlasPlatformRegistration {
  return {
    ...registration,
    readSnapshot: async (args) => {
      // Loaded here rather than at the top: the answerability guard reaches zod and neverthrow, and this
      // registry is read on EVERY invocation to build the atlas manifest rows (manifestBarrelClosure.test.ts).
      const { refuseUnanswerableAtlas } = await import("./kit/answerable.js");
      const snapshot = await registration.readSnapshot(args);
      return snapshot.andThen((value) => refuseUnanswerableAtlas({ snapshot: value }));
    },
  };
}
