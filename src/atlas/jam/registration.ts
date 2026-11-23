/**
 * The Jam atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` publishes the
 * compiled tables, `walk` fills the browser surface in the owner's real Chrome, `refresh` is both, `report`
 * prints where the surfaces disagree, and `reset` archives a generation.
 *
 * They sit under `atlas jam` rather than a noun of their own. A platform is addressed, not passed, and one
 * platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The jam row of the registry. */
export const JAM_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` makes NO request at all — it publishes tables committed under `src/atlas/jam/generated/`,
    // which `tools/generateJamSurfaces.ts` produced from Jam's own public documents and its own servers'
    // answers — and `walk` drives the owner's own Chrome. Both write only the local atlas under
    // $SLOPWEAVER_HOME. No Slack/GitHub/Linear/Vanta write, so this is local-state rather than
    // external-write, and neither opens a browser of its own (docs/browser-route.md).
    doorRouted: false,
    example: "slopweaver atlas jam read --kind route --query mcp",
    summary:
      "The Jam atlas: EVERYTHING REACHABLE rather than a surface map, because nothing else here holds a " +
      "Jam team, member or connected application — with a recording's PAYLOAD withheld on disclosure, so " +
      "there is no `jam` kind at all. `sync` publishes what Jam's own description declares, what its " +
      "authorisation server grants and which paths its two hosts actually serve; `walk` maps the " +
      "application in your own Chrome and records what its client calls; `report` shows where the " +
      "surfaces disagree. Its sharpest finding needs no credential: the published API declares fourteen " +
      "operations and not one returns a jam, a team or a member",
  },
  platform: "jam",
  readDescriptor: async () => (await import("./descriptor.js")).JAM_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyJamKindFiles, initialJamManifest } = await import("./model.js");
    const { JAM_STORE_SPEC, jamAtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyJamKindFiles,
      emptyManifest: initialJamManifest,
      paths: jamAtlasPaths,
      spec: JAM_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readJamSnapshot(args),
  verbs: [
    {
      describe: "publish the compiled tables — no credential, no request, no account reached",
      load: async () => (await import("../../cli/commands/jamAtlas/syncRun.js")).jamAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the browser surface: the Jam application, in your own Chrome",
      load: async () => (await import("../../cli/commands/jamAtlas/walkRun.js")).runJamWalk,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk, which is the one command that brings both channels current",
      load: async () => (await import("../../cli/commands/jamAtlas/refreshRun.js")).jamAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the surfaces disagree; no network call, and it resolves nothing",
      load: async () => (await import("../../cli/commands/jamAtlas/reportRun.js")).jamAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
  ],
};
