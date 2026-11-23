/**
 * The Knock atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These four do: `sync` publishes
 * both compiled surface maps offline, `walk` fills the dashboard surface by driving the owner's own Chrome,
 * `report` says where the two surfaces disagree, and `reset` archives a generation.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The knock row of the registry. */
export const KNOCK_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` and `report` read committed registries and the local generation; `walk` drives the owner's
    // own Chrome. None reaches a Knock account and none writes anything outside the local atlas, so this
    // is local-state rather than external-write, and it opens no browser of its own
    // (docs/browser-route.md).
    doorRouted: true,
    example: "slopweaver atlas knock read --kind method --query broadcast",
    summary:
      "The Knock atlas: EVERYTHING REACHABLE, because nothing else here holds a Knock workflow, guide, " +
      "broadcast or recipient. Today that is two surface maps needing no credential — 216 operations " +
      "from BOTH published OpenAPI documents, every one of the 86 declared GETs confirmed to exist by " +
      "an unauthenticated probe, and 154 dashboard routes from the client's own build manifest — while " +
      "30 entity kinds report not-configured. Its headline gap: 19 of the 57 dashboard pages a walk visits " +
      "display something no API reads, the Agents workspace, the audit log and the service tokens page " +
      "among them",
  },
  platform: "knock",
  readDescriptor: async () => (await import("./descriptor.js")).KNOCK_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyKnockKindFiles, initialKnockManifest } = await import("./model.js");
    const { KNOCK_STORE_SPEC, knockAtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyKnockKindFiles,
      emptyManifest: initialKnockManifest,
      paths: knockAtlasPaths,
      spec: KNOCK_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readKnockSnapshot(args),
  verbs: [
    {
      describe:
        "publish both surface maps from the pinned OpenAPI documents and the dashboard's own route\n" +
        "table; no network call and no credential",
      load: async () => (await import("../../cli/commands/knockAtlas/syncRun.js")).knockAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the dashboard surface by visiting every declared page in your own Chrome",
      load: async () => (await import("../../cli/commands/knockAtlas/walkRun.js")).knockAtlasWalkCommand,
      usage: ["walk [--root <account>/<environment>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "where the API surface and the dashboard disagree",
      load: async () => (await import("../../cli/commands/knockAtlas/reportRun.js")).knockAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
  ],
};
