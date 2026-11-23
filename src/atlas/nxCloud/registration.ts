/**
 * The Nx Cloud atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` fills the
 * `web-data` surface with the owner's own session, `walk` fills the browser surface in the owner's own Chrome,
 * `refresh` runs both — which is what makes the descriptor's one-command resync claim true — `report` prints
 * the corroboration between the two, and `reset` archives a generation.
 *
 * They sit under `atlas nx-cloud` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The nx-cloud row of the registry. */
export const NX_CLOUD_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // Reads Nx Cloud with the owner's own signed-in session and, for `walk`, drives the owner's own Chrome. It
    // writes only the local atlas under $SLOPWEAVER_HOME, so this is local-state rather than
    // external-write, and it launches no browser of its own (docs/browser-route.md).
    doorRouted: false,
    example: "slopweaver atlas nx-cloud report",
    summary:
      "The Nx Cloud atlas: build and CI ground truth — the organisation, the workspace, every route and " +
      "HTTP operation the web client reaches, screenshotted in your own Chrome, and the voluminous run " +
      "families enumerated and declared rather than stored row by row. Strictly read-only",
  },
  platform: "nx-cloud",
  readDescriptor: async () => (await import("./descriptor.js")).NX_CLOUD_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readNxCloudSnapshot(args),
  verbs: [
    {
      describe: "fill the web-data surface by reading Nx Cloud with your own signed-in session; no browser",
      load: async () => (await import("../../cli/commands/nxCloudAtlas/syncRun.js")).nxCloudAtlasSyncCommand,
      usage: ["sync [--org <id>] [--workspace <id>] [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking every declared route in your own Chrome, photographing each",
      load: async () => (await import("../../cli/commands/nxCloudAtlas/walkRun.js")).nxCloudAtlasWalkCommand,
      usage: ["walk [--org <id>] [--workspace <id>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk — the one command that brings both surfaces current",
      load: async () => (await import("../../cli/commands/nxCloudAtlas/refreshRun.js")).nxCloudAtlasRefreshCommand,
      usage: ["refresh [--org <id>] [--workspace <id>] [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the two surfaces disagree, which is an output rather than a build-time check",
      load: async () => (await import("../../cli/commands/nxCloudAtlas/reportRun.js")).nxCloudAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/nxCloudAtlas/resetRun.js")).nxCloudAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
