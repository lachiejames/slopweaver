/**
 * The GraphQL Hive atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` introspects
 * Hive's own schema and reads the registry, `walk` briefs and then judges a console walk in the owner's own
 * Chrome, `refresh` runs both — which is what makes the descriptor's one-command resync claim true —
 * `report` prints the corroboration between the two surfaces, and `reset` archives a generation.
 *
 * They sit under `atlas graphql-hive` rather than a noun of their own. A platform is addressed, not passed,
 * and one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The graphql-hive row of the registry. */
export const GRAPHQL_HIVE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reaches Hive's own GraphQL endpoint and writes only the local atlas under $SLOPWEAVER_HOME.
    // No Slack/GitHub/Linear/Vanta write, so this is local-state rather than external-write — and it
    // opens no browser of its own: `walk` prints a brief the visible session carries out in the owner's
    // real Chrome (docs/browser-route.md, docs/browser-route/proof-and-capture-verbs.md).
    doorRouted: false,
    example: "slopweaver atlas graphql-hive read --kind operation --json",
    summary:
      "The GraphQL Hive atlas: EVERYTHING REACHABLE, because nothing else holds a schema registry — " +
      "`sync` introspects Hive's own API in one request and reads the organisations, projects, targets " +
      "and composed schemas the registry holds, `walk` briefs the console surface in your own Chrome, " +
      "and `report` shows where the two disagree",
  },
  platform: "graphql-hive",
  readDescriptor: async () => (await import("./descriptor.js")).HIVE_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readGraphqlHiveSnapshot(args),
  verbs: [
    {
      describe: "introspect Hive's own GraphQL schema, and read the registry when a token and --organization allow it",
      load: async () => (await import("../../cli/commands/graphqlHiveAtlas/syncRun.js")).graphqlHiveAtlasSyncCommand,
      usage: ["sync [--organization <slug[,slug]>] [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "brief a console walk in your own Chrome, then judge the document it hands back",
      load: async () => (await import("../../cli/commands/graphqlHiveAtlas/walkRun.js")).graphqlHiveAtlasWalkCommand,
      usage: ["walk [--observation <path>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then brief the walk — the one command that brings both surfaces current",
      load: async () =>
        (await import("../../cli/commands/graphqlHiveAtlas/refreshRun.js")).graphqlHiveAtlasRefreshCommand,
      usage: ["refresh [--organization <slug[,slug]>] [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the two surfaces disagree, which is an output rather than a build-time check",
      load: async () =>
        (await import("../../cli/commands/graphqlHiveAtlas/reportRun.js")).graphqlHiveAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/graphqlHiveAtlas/resetRun.js")).graphqlHiveAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
