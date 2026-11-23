/**
 * The Braze atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These three do: `sync` reads Braze's
 * two published descriptions of its own API into the atlas's filled surfaces, `report` says where those two
 * disagree, and `reset` archives a generation.
 *
 * There is deliberately no `walk` yet. The dashboard surface is declared and unfilled because this
 * installation has no Braze account at all, and a verb whose only possible output is a photograph of a
 * sign-in page would be a promise rather than a capability — `browserPages.ts` is the declaration, and the
 * descriptor says what it would take. The sibling Airtable atlas made the same call for the same reason.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The braze row of the registry. */
export const BRAZE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` fetches two documents Braze publishes to anybody — its documentation sitemap with the
    // endpoint pages that sitemap declares, and the official Postman collection — and writes only under
    // $SLOPWEAVER_HOME. No Braze credential, no workspace reached, no door.
    doorRouted: false,
    example: "slopweaver atlas braze report",
    summary:
      "The Braze atlas: EVERYTHING REACHABLE rather than a surface map, because nothing else here holds a " +
      "campaign, a canvas or a segment. `sync` reads Braze's own endpoint reference and its official " +
      "Postman collection — the two published sources disagree about 59 operations — and `report` says " +
      "where. The engagement series are enumerated and declared rather than stored whole. The LIVE REST " +
      "and dashboard surfaces are unfilled: this installation has no Braze API key and no Braze account",
    kitDescriptions: {
      coverage: "what this atlas knows it does NOT know — including that no workspace has ever been read",
      read: "the stored operations, filtered by kind, surface, id or query",
    },
  },
  platform: "braze",
  readDescriptor: async () => (await import("./descriptor.js")).BRAZE_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readBrazeSnapshot(args),
  verbs: [
    {
      describe: "read Braze's own endpoint reference and official Postman collection; no credential",
      load: async () => (await import("../../cli/commands/brazeAtlas/syncRun.js")).brazeAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "where those two published sources disagree about Braze's own API",
      load: async () => (await import("../../cli/commands/brazeAtlas/reportRun.js")).brazeAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/brazeAtlas/resetRun.js")).brazeAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
