/**
 * The JumpCloud atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These do: `sync` walks the
 * Directory API and publishes a generation, `walk` walks the administrator console in the owner's own Chrome and
 * publishes the console generation beside it, `auth-events` folds Directory Insights, and `reset` archives
 * both generations.
 *
 * They sit under `atlas jumpcloud` rather than a noun of their own. The platform is the THIRD WORD — owner
 * ruling that a top-level platform verb must not exist — and one platform must
 * appear in the catalogue exactly once, which is the property `kit/contract.ts` makes a type to protect.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The jumpcloud row of the registry. */
export const JUMPCLOUD_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // JumpCloud answers verbs of its own beyond the two every platform has, so its row cannot take
    // the generic summary and usage without under-advertising what it does.
    doorRouted: false,
    example: "slopweaver atlas jumpcloud read --kind systems --json",
    summary:
      "The JumpCloud atlas: `read` its stored entities or `coverage` for what it knows it does NOT know, " +
      "plus `sync` to walk the Directory API through a closed 503-row surface registry and publish a " +
      "generation, `walk` to walk the admin console's declared pages in the owner's own Chrome and photograph each, " +
      "and `reset` to archive one. Strictly read-only: no write is reachable",
  },
  platform: "jumpcloud",
  readDescriptor: async () => (await import("./descriptor.js")).JUMPCLOUD_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readJumpcloudSnapshot(args),
  verbs: [
    {
      describe:
        "read Directory Insights authentication events over a bounded window and fold them to one last-auth per identity, storing nothing",
      load: async () =>
        (await import("../../cli/commands/atlas/jumpcloud/authEventsRun.js")).jumpcloudAuthEventsCommand,
      usage: ["auth-events --since <iso> [--until <iso>] [--max-pages <n>] [--json] [--home <dir>]"],
      verb: "auth-events",
    },
    {
      describe: "walk the Directory API and publish a generation, or refuse and say which family stopped it",
      load: async () => (await import("../../cli/commands/atlas/jumpcloud/syncRun.js")).jumpcloudSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe:
        "walk every declared admin-console page in the owner's own signed-in Chrome, photograph each, and publish the console generation",
      load: async () => (await import("../../cli/commands/atlas/jumpcloud/walkRun.js")).jumpcloudWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/jumpcloud/resetRun.js")).jumpcloudResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
