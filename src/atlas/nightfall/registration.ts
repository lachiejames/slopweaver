/**
 * The Nightfall atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes the
 * compiled generation, and `reset` archives one.
 *
 * They sit under `atlas nightfall` rather than a noun of their own. The platform is the THIRD WORD — a
 * top-level platform verb does not exist by the owner's rule — and one platform must
 * appear in the catalogue exactly once, which is the property `kit/contract.ts` makes a type to protect.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The nightfall row of the registry. */
export const NIGHTFALL_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` compiles a generation out of a committed table and writes only the local atlas under
    // $SLOPWEAVER_HOME. It makes no network call at all and needs no credential, so this is local-state
    // rather than external-write, and there is no door for it to route through.
    doorRouted: false,
    example: "slopweaver atlas nightfall read --kind violation --json",
    summary:
      "The Nightfall DLP atlas: `read` its stored entities or `coverage` for what it knows it does NOT " +
      "know, plus `sync` to publish the compiled surface map — every operation, parameter, response " +
      "field and declared record shape across the vendor's six published APIs — and `reset` to archive " +
      "a generation. Detections are shape-indexed, never stored row by row",
  },
  platform: "nightfall",
  readDescriptor: async () => (await import("./descriptor.js")).NIGHTFALL_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readNightfallSnapshot(args),
  verbs: [
    {
      describe: "publish the compiled generation — no credential, no network call",
      load: async () => (await import("../../cli/commands/atlas/nightfall/syncRun.js")).nightfallSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/nightfall/resetRun.js")).nightfallResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
