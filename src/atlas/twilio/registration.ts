/**
 * The Twilio atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These four do: `sync` compiles
 * Twilio's own published API definitions into the surface map, `walk` drives the console in the owner's own
 * Chrome, `report` prints where the two surfaces disagree without resolving any of them, and `reset`
 * archives a generation.
 *
 * They sit under `atlas twilio` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The twilio row of the registry. */
export const TWILIO_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` and `report` write only the local atlas under $SLOPWEAVER_HOME and ask Twilio nothing about
    // the account — the definitions repository is PUBLIC, so there is no Twilio write and no account
    // read. `walk` drives the owner's own Chrome and still only writes locally, which is the same call
    // the sibling GitHub atlas's walking row makes.
    doorRouted: false,
    example: 'slopweaver atlas twilio read --kind method --query "message status"',
    summary:
      "The Twilio atlas: EVERYTHING REACHABLE rather than a surface map, because nothing else here holds " +
      "a phone number, a messaging service or a delivery status. `sync` compiles every published API " +
      "definition, endpoint, parameter and response field from Twilio's own pinned `twilio-oai` " +
      "repository, recording which of the thirty-eight origins answers each and which credential reaches " +
      "it; the message and call logs and every other time-series family are declared and shape-indexed " +
      "rather than stored whole",
  },
  platform: "twilio",
  readDescriptor: async () => (await import("./descriptor.js")).TWILIO_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readTwilioSnapshot(args),
  verbs: [
    {
      describe: "compile Twilio's own published API definitions, verified against the pinned lock",
      load: async () => (await import("../../cli/commands/twilioAtlas/syncRun.js")).twilioAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking the Twilio console in your own Chrome",
      load: async () => (await import("../../cli/commands/twilioAtlas/walkRun.js")).twilioAtlasWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "where the surfaces disagree — it resolves none of them",
      load: async () => (await import("../../cli/commands/twilioAtlas/reportRun.js")).twilioAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/twilioAtlas/resetRun.js")).twilioAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
