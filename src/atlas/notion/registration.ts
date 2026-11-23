/**
 * The Notion atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` compiles the
 * API surface from the installed client, `walk` fills the browser surface in the owner's own Chrome,
 * `refresh` runs both — which is what makes the descriptor's one-command resync claim true — `report` prints
 * the corroboration between the two, and `reset` archives a generation.
 *
 * They sit under `atlas notion` rather than a noun of their own. A platform is addressed, not passed, and one
 * platform must appear in the catalogue exactly once. The existing top-level `notion` noun is a different
 * thing entirely — it reads and writes PAGES through the door, where this reads the platform's own surface.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The notion row of the registry. */
export const NOTION_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // Reads the installed SDK's own generated modules and, for `walk`, drives the owner's own Chrome and
    // writes only the local atlas under $SLOPWEAVER_HOME. No Notion write, so this is local-state rather
    // than external-write, and it opens no browser of its own (docs/browser-route.md).
    doorRouted: false,
    example: "slopweaver atlas notion report",
    summary:
      "The Notion atlas: the SURFACE MAP, not the entities — every settings and admin page the web " +
      "client exposes, screenshotted in your own Chrome, plus every endpoint the installed client " +
      "declares, and `report` for where the two disagree. Page CONTENT is the world model's",
  },
  platform: "notion",
  readDescriptor: async () => (await import("./descriptor.js")).NOTION_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readNotionSnapshot(args),
  verbs: [
    {
      describe: "compile the API surface from the installed @notionhq/client; no network call",
      load: async () => (await import("../../cli/commands/notionAtlas/syncRun.js")).notionAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking every declared page in your own Chrome, photographing each",
      load: async () => (await import("../../cli/commands/notionAtlas/walkRun.js")).notionAtlasWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "open the settings MODAL in your own Chrome — the surface that has no URL — and report what it holds",
      load: async () => (await import("../../cli/commands/notionAtlas/settingsRun.js")).notionAtlasSettingsCommand,
      usage: ["settings [--tab <id>] [--json] [--home <dir>]"],
      verb: "settings",
    },
    {
      describe: "sync then walk — the one command that brings both surfaces current",
      load: async () => (await import("../../cli/commands/notionAtlas/refreshRun.js")).notionAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the two surfaces disagree, which is an output rather than a build-time check",
      load: async () => (await import("../../cli/commands/notionAtlas/reportRun.js")).notionAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/notionAtlas/resetRun.js")).notionAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
