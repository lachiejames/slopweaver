/**
 * The Canva atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes the
 * compiled generation, and `reset` archives one.
 *
 * They sit under `atlas canva` rather than a noun of their own. The platform is the THIRD WORD, because a top-level platform verb has no place in the
 * command surface, and one platform must
 * appear in the catalogue exactly once, which is the property `kit/contract.ts` makes a type to protect.
 *
 * There is deliberately no `walk` verb yet. The web-app surface is declared and unfilled, and advertising a
 * verb that does nothing would be the one dishonesty the descriptor's `status` field exists to prevent.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The canva row of the registry. */
export const CANVA_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` compiles a generation out of a committed table and writes only the local atlas under
    // $SLOPWEAVER_HOME. It makes no network call at all and needs no credential, so this is local-state
    // rather than external-write, and there is no door for it to route through.
    doorRouted: false,
    example: "slopweaver atlas canva read --kind design --json",
    summary:
      "The Canva atlas: the SURFACE MAP of the Connect API — `read` its stored operations and OAuth " +
      "scopes or `coverage` for what it knows it does NOT know, plus `sync` to publish the compiled map " +
      "(every operation, parameter, response field, per-user rate limit and scope, with each one's " +
      "stability and plan entitlement read from the vendor's own prose) and `reset` to archive a " +
      "generation. No credential and no network",
  },
  platform: "canva",
  readDescriptor: async () => (await import("./descriptor.js")).CANVA_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readCanvaSnapshot(args),
  verbs: [
    {
      describe: "publish the compiled generation — no credential, no network call",
      load: async () => (await import("../../cli/commands/atlas/canva/syncRun.js")).canvaSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/canva/resetRun.js")).canvaResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
