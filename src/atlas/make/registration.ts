/**
 * The Make atlas's registration: its descriptor, its store, and the one verb it answers beyond the kit's.
 *
 * `read`, `coverage` and `render` are kit-level and know no platform's vocabulary; `reset` is the kit's,
 * reached through `readReset`. `fill` is this door's own.
 *
 * Only `import type` sits at the top: every module behind a verb or a reader loads inside its own thunk, so
 * registering this platform costs an unrelated invocation nothing — and never loads the SDK.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The make row of the registry. */
export const MAKE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `fill` reads Make under the owner's own token and writes only under $SLOPWEAVER_HOME. No Slack/GitHub/
    // Linear/Vanta write, no browser: local-state.
    doorRouted: false,
    example: "slopweaver atlas make fill",
    summary:
      "The Make (make.com) atlas, READ-ONLY: every scenario the owner's token can see — its schedule, the apps " +
      "and module outline that say what it does, who made and last edited it, its newest runs — with the " +
      "organisation, teams, folders, connections and webhooks around it, over an SDK railed to GET on the " +
      "configured zone. `fill` reads and publishes; `render` draws the scenario table",
  },
  platform: "make",
  readDescriptor: async () => (await import("./descriptor.js")).MAKE_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyMakeKindFiles, initialMakeManifest } = await import("./model.js");
    const { MAKE_STORE_SPEC, makeAtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyMakeKindFiles,
      emptyManifest: initialMakeManifest,
      paths: makeAtlasPaths,
      spec: MAKE_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readMakeSnapshot(args),
  verbs: [
    {
      describe:
        "read every scenario, team, folder, connection, hook and newest run the token sees — GET only — and publish",
      load: async () => (await import("../../cli/commands/atlas/make/fillRun.js")).makeFillCommand,
      usage: ["fill [--json] [--home <dir>]"],
      verb: "fill",
    },
  ],
};
