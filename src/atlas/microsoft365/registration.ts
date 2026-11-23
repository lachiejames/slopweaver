/**
 * The Microsoft 365 / Entra atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` compiles the
 * pinned Graph specification into the atlas's only filled surface, and `reset` archives a generation.
 *
 * There is deliberately no `walk` yet. The browser surface is declared and unfilled, and a verb that could
 * not fill it would be a promise rather than a capability — `browserPages.ts` is the declaration, and the
 * descriptor says what it would take.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The microsoft365 row of the registry. */
export const MICROSOFT365_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` may fetch one immutable, commit-addressed public document when it is not already cached, and
    // writes only under $SLOPWEAVER_HOME. No Microsoft credential, no tenant reached, no door.
    doorRouted: false,
    example: "slopweaver atlas microsoft365 read --kind policies --json",
    summary:
      "The Microsoft 365 / Entra atlas — the largest surface here: every Microsoft Graph v1.0 operation " +
      "compiled from a pinned specification, each classed reachable, voluminous or excluded, plus the " +
      "admin-console pages it declares and has not yet walked. The LIVE Graph surface is unfilled: no " +
      "Entra application registration is configured, so no entity of this tenant has been read",
    kitDescriptions: {
      coverage: "what this atlas knows it does NOT know — including that no tenant has ever been read",
      read: "the stored operations, filtered by kind, surface, id or query",
    },
  },
  platform: "microsoft365",
  readDescriptor: async () => (await import("./descriptor.js")).MICROSOFT365_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readMicrosoft365Snapshot(args),
  verbs: [
    {
      describe: "compile the pinned Microsoft Graph v1.0 specification; no credential, no tenant reached",
      load: async () => (await import("../../cli/commands/microsoft365Atlas/syncRun.js")).microsoft365AtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () =>
        (await import("../../cli/commands/microsoft365Atlas/resetRun.js")).microsoft365AtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
