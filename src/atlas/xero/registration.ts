/**
 * The Xero atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These six do: `sync` compiles the
 * API surface and the family enumeration from the installed client, `walk` fills the browser surface in the
 * owner's own Chrome, `refresh` runs both — which is what makes the descriptor's one-command resync claim
 * true — `report` prints the corroboration between the two, `families` prints the enumeration the owner's
 * voluminous bound requires, and `reset` archives a generation.
 *
 * They sit under `atlas xero` rather than a noun of their own. A platform is addressed, not passed, and one
 * platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The xero row of the registry. */
export const XERO_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // Reads the installed SDK's own generated modules and, for `walk`, drives the owner's own Chrome and
    // writes only the local atlas under $SLOPWEAVER_HOME. No Xero write of any kind, so this is
    // local-state rather than external-write, and it opens no browser of its own (docs/browser-route.md).
    doorRouted: false,
    example: "slopweaver atlas xero families --disposition voluminous",
    summary:
      "The Xero atlas: EVERYTHING REACHABLE, because nothing else holds these books — every operation the " +
      "installed client declares with its parameters and response fields, every web page walked and " +
      "screenshotted in your own Chrome, and every business-object family with its disposition. The " +
      "ledger and bank-feed families are enumerated and declared, never stored whole",
  },
  platform: "xero",
  readDescriptor: async () => (await import("./descriptor.js")).XERO_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readXeroSnapshot(args),
  verbs: [
    {
      describe: "compile the API surface and the family enumeration from the installed xero-node; no network call",
      load: async () => (await import("../../cli/commands/xeroAtlas/syncRun.js")).xeroAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking every declared page in your own Chrome, photographing each",
      load: async () => (await import("../../cli/commands/xeroAtlas/walkRun.js")).xeroAtlasWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk — the one command that brings both surfaces current",
      load: async () => (await import("../../cli/commands/xeroAtlas/refreshRun.js")).xeroAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the two surfaces disagree, which is an output rather than a build-time check",
      load: async () => (await import("../../cli/commands/xeroAtlas/reportRun.js")).xeroAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "every business-object family, its disposition and which page shows it",
      load: async () => (await import("../../cli/commands/xeroAtlas/familiesRun.js")).xeroAtlasFamiliesCommand,
      usage: ["families [--disposition configuration|voluminous|mixed|unjudged] [--json] [--home <dir>]"],
      verb: "families",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/xeroAtlas/resetRun.js")).xeroAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
