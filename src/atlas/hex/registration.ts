/**
 * The Hex atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` compiles the
 * anonymous evidence into the surface map, `walk` drives the app in the owner's own Chrome, `refresh` runs
 * both, `report` prints where the surfaces disagree without resolving any of them, and `reset` archives a
 * generation.
 *
 * They sit under `atlas hex` rather than a noun of their own. A platform is addressed, not passed, and one
 * platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The hex row of the registry. */
export const HEX_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` fetches ONE document Hex publishes to anybody — the OpenAPI description its own public API
    // reference renders from — and republishes two committed measurements beside it, writing only under
    // $SLOPWEAVER_HOME. No Hex credential, no workspace reached, no door. `walk` drives the owner's own
    // Chrome and still only writes locally: the criterion is about the SYNC and says nothing about a walk.
    doorRouted: false,
    example: "slopweaver atlas hex report",
    summary:
      "The Hex atlas: the SURFACE MAP, and the withholding is the point. `sync` compiles the published " +
      "OpenAPI document, the measured census of which /api/v1 nouns the router mounts, and the shipped " +
      "web client's own route table and GraphQL operation names — a whole first-party API the document " +
      "declares nothing of. `walk` photographs every static route in your own Chrome. Operations whose " +
      "response is or renders a query result are mapped in full and NEVER called for their body, not even " +
      "for its shape: the owner's ruling that this atlas stores no customer data locally",
  },
  platform: "hex",
  readDescriptor: async () => (await import("./descriptor.js")).HEX_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readHexSnapshot(args),
  verbs: [
    {
      describe:
        "compile the published OpenAPI document, the unauthenticated noun census and the shipped\n" +
        "client's own routes and GraphQL operations; one network call, no credential",
      load: async () => (await import("../../cli/commands/hexAtlas/syncRun.js")).hexAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking app.hex.tech in your own Chrome, photographing each page",
      load: async () => (await import("../../cli/commands/hexAtlas/walkRun.js")).hexAtlasWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk — the one command that brings both channels current",
      load: async () => (await import("../../cli/commands/hexAtlas/refreshRun.js")).hexAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the surfaces disagree — it resolves none of them",
      load: async () => (await import("../../cli/commands/hexAtlas/reportRun.js")).hexAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/hexAtlas/resetRun.js")).hexAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
