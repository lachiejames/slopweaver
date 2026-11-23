/**
 * The Inngest atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These three do: `sync` compiles the
 * published REST catalogue and the dashboard's own route table and probes both, `walk` fills the browser
 * surface in the owner's real Chrome, and `reset` archives a generation.
 *
 * They sit under `atlas inngest` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The inngest row of the registry. */
export const INNGEST_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads two documents Inngest publishes to anybody — its API reference's own operation
    // catalogue, and the client bundle the dashboard serves a signed-out visitor — and sends only
    // unauthenticated GETs to addresses those two name. No Inngest credential, no account reached, no
    // browser opened, no door. It writes only under $SLOPWEAVER_HOME.
    doorRouted: false,
    example: "slopweaver atlas inngest read --kind page --query settings",
    summary:
      "The Inngest atlas: EVERYTHING REACHABLE rather than a surface map, because nothing else here holds " +
      "an app, a function or an event key. `sync` compiles every published REST operation from the one " +
      "machine-readable document the API reference still serves, and every dashboard route out of the " +
      "application's own route table, then probes both against controls — v1 discriminates and v2 does " +
      "not, so no v2 address's existence can be established without a credential. Runs and events are " +
      "enumerated and declared rather than stored whole. The LIVE REST surface is unfilled (no Inngest " +
      "credential is configured) and the GraphQL surface has introspection disabled, so its only census " +
      "is what the dashboard's own client is watched sending",
  },
  platform: "inngest",
  readDescriptor: async () => (await import("./descriptor.js")).INNGEST_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readInngestSnapshot(args),
  verbs: [
    {
      describe:
        "compile Inngest's published REST catalogue and the dashboard's own route table, and probe\n" +
        "both — no credential, no account reached, GET requests only",
      load: async () => (await import("../../cli/commands/inngestAtlas/syncRun.js")).inngestAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the browser surface: every declared route, in your own Chrome",
      load: async () => (await import("../../cli/commands/inngestAtlas/walkRun.js")).inngestAtlasWalkCommand,
      usage: ["walk [--limit <n>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/inngestAtlas/resetRun.js")).inngestAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
