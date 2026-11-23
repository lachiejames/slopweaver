/**
 * The Linear atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `sync` reads the whole GraphQL schema and every configuration surface and, unless told not to, fills the
 * browser surface in the same run; `walk` fills only the browser surface; `report` reads the published
 * generation and prints where the two disagree, making no network call at all; `reset` archives a
 * generation. `sync` and `walk` live in `cli/commands/atlas/linearRun.ts`, where `sync` is the door;
 * `report` and `reset` live in `cli/commands/atlas/linearGenerationRun.ts`.
 *
 * They sit under `atlas linear` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once. The top-level `linear` noun is a different thing
 * entirely — it reads and writes ISSUES through the door, where this reads the platform's own surface.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The linear row of the registry. */
export const LINEAR_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // Linear answers four verbs of its own beyond the kit's, and one of them drives the owner's own Chrome —
    // so its row cannot take the generic summary without under-advertising it. `sync` reads Linear through
    // the one shared transport under a read-only grant, which is why the row is door-routed.
    doorRouted: true,
    example: "slopweaver atlas linear read --kind setting --query workflow",
    summary:
      "The Linear SURFACE MAP: `read` its stored operations, schema types, settings pages and workspace " +
      "configuration, or `coverage` for what it knows it does NOT know, plus `sync` to read the whole " +
      "GraphQL schema and every configuration surface, `walk` to fill the browser surface in your own " +
      "Chrome, `report` for where the two surfaces disagree, and `reset` to archive a generation",
  },
  platform: "linear",
  readDescriptor: async () => (await import("./descriptor.js")).LINEAR_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readLinearSnapshot(args),
  verbs: [
    {
      describe: "read the whole GraphQL schema and every configuration surface, and publish a generation",
      load: async () => (await import("../../cli/commands/atlas/linearRun.js")).linearSyncCommand,
      usage: ["sync [--skip-browser] [--limit <n>] [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface: every declared settings page, in your own Chrome, photographed",
      load: async () => (await import("../../cli/commands/atlas/linearRun.js")).linearWalkCommand,
      usage: ["walk [--limit <n>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "where the two surfaces disagree — no network call, and it resolves nothing",
      load: async () => (await import("../../cli/commands/atlas/linearGenerationRun.js")).linearReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/linearGenerationRun.js")).linearResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
