/**
 * The Google Admin atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes
 * the compiled generation, and `reset` archives one.
 *
 * They sit under `atlas google-admin` rather than a noun of their own. The platform is the THIRD WORD —
 * owner ruling that a top-level platform verb should not exist — and one platform
 * must appear in the catalogue exactly once, which is the property `kit/contract.ts` makes a type to
 * protect.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The google-admin row of the registry. */
export const GOOGLE_ADMIN_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` fetches nothing at all: the eleven discovery documents are compiled into the build by
    // `tools/generateGoogleAdminSurfaces.ts` and pinned by digest, so this writes only under
    // $SLOPWEAVER_HOME. No Google credential, no Workspace account reached, no browser opened, no door.
    // `connect` and `fill` are the two verbs here that do reach Google — one runs the shared consent flow
    // and writes an owner-only grant, the other reads the Admin APIs under it — and the row stays
    // `local-state`: the classification follows the SYNC, exactly as it does for Hex's walk.
    doorRouted: false,
    example: "slopweaver atlas google-admin read --kind directory-users --json",
    summary:
      "The Google Workspace Admin console SURFACE MAP, not the entities the corpus and the Gmail, Drive " +
      "and Calendar doors already hold: `sync` publishes every method, parameter, response field and " +
      "declared record shape across the eleven APIs behind admin.google.com, with the administrator " +
      "scope each one needs; `connect` authorises this install to READ those APIs, requesting readonly " +
      "administrator scopes and nothing that can write, and `fill` then calls every operation that " +
      "grant reaches and stores each record's key and field names; `walk` prints the brief for a console walk in " +
      "your own Chrome and publishes the routes it brings back; `coverage` says which surfaces are " +
      "filled and what would fill the rest",
  },
  platform: "google-admin",
  readDescriptor: async () => (await import("./descriptor.js")).GOOGLE_ADMIN_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readGoogleAdminSnapshot(args),
  verbs: [
    {
      describe: "publish the compiled generation — no credential, no network call",
      load: async () => (await import("../../cli/commands/atlas/googleAdmin/syncRun.js")).googleAdminSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "authorise this install to READ the Admin APIs — readonly scopes only, browser consent",
      load: async () => (await import("../../cli/commands/atlas/googleAdmin/connectRun.js")).googleAdminConnectCommand,
      usage: [
        "connect [--grant <all|directory|reports|chrome|cloud-identity|vault>] [--without <capability,...>]",
        "        [--status] [--json] [--home <dir>]",
      ],
      verb: "connect",
    },
    {
      describe: "call every operation the grant reaches and republish with admin-api filled",
      load: async () => (await import("../../cli/commands/atlas/googleAdmin/fillRun.js")).googleAdminFillCommand,
      usage: ["fill [--json] [--home <dir>]"],
      verb: "fill",
    },
    {
      describe: "print the browser brief, or publish from the observation it hands back",
      load: async () => (await import("../../cli/commands/atlas/googleAdmin/walkRun.js")).googleAdminWalkCommand,
      usage: ["walk [--observation <path>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/googleAdmin/resetRun.js")).googleAdminResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
