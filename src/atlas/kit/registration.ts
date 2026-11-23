/**
 * What one platform contributes to the registry — the whole of "its differences", in one shape.
 *
 * `kit/contract.ts` makes ONE platform per atlas a type; `registry.ts` makes it a lookup; this is the row.
 * A new atlas is its descriptor plus one of these, and every generic verb — the kit's four, the platform's
 * own, the catalogue row, the usage block — is derived from it rather than written beside it. Held apart
 * from `registry.ts` so a platform's `registration.ts` can name the type without importing the list it is
 * about to be a member of.
 *
 * ## Why every field that loads code is a thunk
 *
 * Each adapter pulls in its platform's whole Zod model; each verb's run module pulls in its transport and
 * browser plumbing. Loading all of them to answer `atlas vanta --help` would make the cheapest verb in the
 * noun pay for every atlas in the build, which is the same reason `cli/manifest.ts` loads command modules
 * lazily. A registration is therefore strings and `import()` thunks only — cheap enough for `registry.ts`
 * to import all of them eagerly and for a manifest row to be built from one without loading anything.
 */
import type { CommandRun } from "../../cli/defineCommand.js";
import type { Result } from "../../lib/result.js";

import type { AtlasDescriptor } from "./contract.js";
import type { AtlasReadError, AtlasReadSnapshot } from "./read.js";
import type { AtlasPlatformReset } from "./reset.js";
import type { AtlasCatalogueEntry, AtlasOwnVerb } from "./verbs.js";

/** One platform's row: its name, what it declares about itself, how to read its store, and its verbs. */
export interface AtlasPlatformRegistration {
  readonly platform: string;
  /**
   * The atlas's own declaration — its window, its resync command, its bounded live read.
   *
   * A lazy thunk rather than an eager import: a descriptor pulls its platform's kind list in with it, and
   * a sweep that only wants freshness should not pay for every atlas's model. It is on the REGISTRATION
   * rather than gathered separately because the registry is the one seam a generic verb goes through, and
   * a second list of atlases is a second list to forget.
   */
  readonly readDescriptor: () => Promise<AtlasDescriptor>;
  /** Reads the platform's own strict store and projects it. Never repairs; a bad generation is reported. */
  readonly readSnapshot: (args: { home?: string }) => Promise<Result<AtlasReadSnapshot, AtlasReadError>>;
  /** What the catalogue row says about this atlas — summary, example, door — beyond the generic text. */
  readonly catalogue: AtlasCatalogueEntry;
  /**
   * The verbs this platform answers beyond the kit's four, in the order its usage block lists them.
   *
   * Empty is a legitimate row: an atlas whose sync lives elsewhere (Cloudflare, CrowdStrike, 1Password)
   * answers the kit verbs and nothing else, and says so by declaring none.
   */
  readonly verbs: readonly AtlasOwnVerb[];
  /**
   * A command that runs when the tail names neither a kit verb nor one of {@link verbs}.
   *
   * Slack alone has one: `atlas slack --never-read` reads the map with flags and no verb at all, because
   * its three rows predate the kit and the map IS the platform's default. Every other platform leaves this
   * absent, and an unknown verb is then a usage error naming the verb and printing the block.
   */
  readonly fallback?: () => Promise<CommandRun>;
  /**
   * How this platform archives its current generation — the whole of what `reset` needs from it.
   *
   * `reset` is a kit verb like `coverage`, `read`, `render` and `restore`: the protocol is `./reset.ts`'s and
   * the argv tail, the `--confirm archive` guard, both output shapes and the exit codes are
   * `cli/commands/atlas/resetRunCore.ts`'s. What is genuinely a platform's own is the EMPTY generation it
   * installs — its kind files, its initial manifest, its store spec and where its paths resolve — and all
   * four are already exported by its `model.ts` and `store.ts`, so `atlasResetFor` binds them and this field
   * hands the result back.
   *
   * A thunk for the same reason every other field that loads code is one — a reset pulls in the platform's
   * whole Zod model, and `atlas vanta --help` must not pay for every atlas in the build. **Never import
   * `./model.js`, `./store.js` or the kit's `reset.js` at the top of a `registration.ts`**: nothing fails if
   * you do, the registry just gets slower, which is why `unit/atlas/registrationLaziness.test.ts` asserts it
   * instead of a reviewer noticing.
   *
   * `undefined` is a legitimate row and means this platform does not answer `reset` through the `atlas`
   * noun. Three do not because they are their OWN top-level noun (`slopweaver cloudflare reset`,
   * `crowdstrike`, `onepassword`).
   */
  readonly readReset?: () => Promise<AtlasPlatformReset>;
}
