/**
 * The Figma atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes both
 * compiled surface maps — the operation registry generated from Figma's own OpenAPI document and the
 * browser route inventory measured without an account — and `reset` archives a generation.
 *
 * There is deliberately no `walk` here yet, and its absence is a statement rather than an oversight. A walk
 * needs a signed-in Figma session and this installation holds no Figma credential —
 * `src/atlas/figma/descriptor.ts` carries the measurement. Shipping a verb that could only ever photograph
 * the sign-in page forty-one times would be worse than the declared-unfilled surface that says so.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The figma row of the registry. */
export const FIGMA_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads a committed registry and a committed route inventory and writes only the local atlas
    // under $SLOPWEAVER_HOME. It makes no network call at all and presents no credential, so this is
    // local-state rather than external-read, and there is no door for it to route through.
    doorRouted: false,
    example: "slopweaver atlas figma read --kind method --query variables",
    summary:
      "The Figma atlas: EVERYTHING REACHABLE, because nothing else here holds a Figma file. Today that " +
      "is both surface maps — 54 REST operations from Figma's own pinned OpenAPI document, each " +
      "carrying a disposition, and 41 browser routes with 23 confirmed to exist and 2 confirmed absent " +
      "— while the sixteen entity kinds report not-configured naming the missing token. Its headline " +
      "gap: no operation returns the set of teams, so most of the REST surface needs an id only the " +
      "browser supplies",
  },
  platform: "figma",
  readDescriptor: async () => (await import("./descriptor.js")).FIGMA_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readFigmaSnapshot(args),
  verbs: [
    {
      describe:
        "publish both surface maps from the pinned OpenAPI document and the measured route\n" +
        "inventory; no network call and no credential",
      load: async () => (await import("../../cli/commands/figmaAtlas/syncRun.js")).figmaAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/figmaAtlas/resetRun.js")).figmaAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
