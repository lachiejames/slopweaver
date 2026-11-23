/**
 * The Trelica atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` publishes the
 * two API surfaces, `walk` fills the browser surface in the owner's own Chrome, `refresh` runs both — which
 * is what makes the descriptor's one-command resync claim true — `report` prints the corroboration between
 * the three or, with `--offboarding`, the joined offboarding evidence, and `reset` archives a generation.
 *
 * They sit under `atlas trelica` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The trelica row of the registry. */
export const TRELICA_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads the tenant's own published documents and makes the reads `inventory.ts` admits, and
    // `walk` drives the owner's own Chrome; both write only the local atlas under $SLOPWEAVER_HOME. No
    // Slack/GitHub/Linear/Vanta write, so this is local-state rather than external-write, and it opens no
    // browser of its own (docs/browser-route.md).
    doorRouted: false,
    example: "slopweaver atlas trelica read --kind app --json",
    summary:
      "The Trelica atlas: EVERYTHING REACHABLE on the organisation's own SaaS-discovery platform — every " +
      "application, its vendor, how it was discovered, who owns it, how many accounts it has and what it " +
      "costs, every person and their accounts, every workflow and each run's per-step outcome, integrations, " +
      "contracts, devices, teams, access reviews and assessments — plus the surface map across the vendor's " +
      "published API, the undocumented first-party API and the web app walked in your own Chrome, and " +
      "`report` for where they disagree or, with --offboarding, who was not offboarded cleanly",
  },
  platform: "trelica",
  readDescriptor: async () => (await import("./descriptor.js")).TRELICA_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readTrelicaSnapshot(args),
  verbs: [
    {
      describe: "publish both API surfaces — the vendor's own published documents, and the first-party calls",
      load: async () => (await import("../../cli/commands/trelicaAtlas/syncRun.js")).trelicaAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking every declared page in your own Chrome, photographing each",
      load: async () => (await import("../../cli/commands/trelicaAtlas/walkRun.js")).trelicaAtlasWalkCommand,
      usage: ["walk [--limit <n>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk — the one command that brings every surface current",
      load: async () => (await import("../../cli/commands/trelicaAtlas/refreshRun.js")).trelicaAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe:
        "where the three surfaces disagree, or with --offboarding each offboarding workflow's runs and who the " +
        "evidence shows was not offboarded cleanly",
      load: async () => (await import("../../cli/commands/trelicaAtlas/reportRun.js")).trelicaAtlasReportCommand,
      usage: ["report [--offboarding] [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/trelicaAtlas/resetRun.js")).trelicaAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
