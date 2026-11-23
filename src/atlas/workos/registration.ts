/**
 * The WorkOS atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` probes the
 * route map and reads the content, `walk` briefs and then judges a dashboard walk in the owner's own
 * Chrome, `refresh` runs both — which is what makes the descriptor's one-command resync claim true —
 * `report` prints the corroboration between the surfaces, and `reset` archives a generation.
 *
 * They sit under `atlas workos` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The workos row of the registry. */
export const WORKOS_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reaches WorkOS's own REST origin and writes only the local atlas under $SLOPWEAVER_HOME.
    // No Slack/GitHub/Linear/Vanta write, so this is local-state rather than external-write — and it
    // opens no browser of its own: `walk` prints a brief the visible session carries out in the owner's
    // real Chrome (docs/browser-route.md, docs/browser-route/proof-and-capture-verbs.md).
    doorRouted: false,
    example: "slopweaver atlas workos read --kind operation --json",
    summary:
      "The WorkOS atlas: EVERYTHING REACHABLE, because nothing else holds an auth provider's " +
      "organisations, users, SSO connections or SCIM directories — `sync` measures which routes the " +
      "running API actually serves with NO credential at all and reads the content when a key allows " +
      "it, `walk` briefs the dashboard surface in your own Chrome, and `report` shows where the " +
      "surfaces disagree",
  },
  platform: "workos",
  readDescriptor: async () => (await import("./descriptor.js")).WORKOS_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readWorkosSnapshot(args),
  verbs: [
    {
      describe: "probe every candidate route against the running API, and read the content when a key allows it",
      load: async () => (await import("../../cli/commands/workosAtlas/syncRun.js")).workosAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "brief a dashboard walk in your own Chrome, then judge the document it hands back",
      load: async () => (await import("../../cli/commands/workosAtlas/walkRun.js")).workosAtlasWalkCommand,
      usage: ["walk [--observation <path>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then brief the walk — the one command that brings both surfaces current",
      load: async () => (await import("../../cli/commands/workosAtlas/refreshRun.js")).workosAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the surfaces disagree, which is an output rather than a build-time check",
      load: async () => (await import("../../cli/commands/workosAtlas/reportRun.js")).workosAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/workosAtlas/resetRun.js")).workosAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
