/**
 * The Aether atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `walk` drives the
 * owner's own Chrome through the portal and publishes a generation, and `reset` archives one. Aether has no
 * `sync` — it has one surface, the driven browser, so the walk IS the sync.
 *
 * They sit under `atlas aether` rather than a noun of their own — the platform is the THIRD WORD, and one platform appears in the catalogue exactly once, which is the property
 * `kit/contract.ts` makes a type to protect.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The aether row of the registry. */
export const AETHER_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `doorRouted` marks a row whose SYNC reads a doored provider (Slack/GitHub/Linear/Vanta). A driven-browser
    // walk is not one of those — it writes only the local atlas under $SLOPWEAVER_HOME and stores no credential —
    // so this is `false`, exactly like the sibling CrowdStrike and Jam browser walks.
    doorRouted: false,
    example: "slopweaver atlas aether read --kind finding --json",
    summary:
      "The Aether (dvuln) pentest portal atlas: `read` its stored findings, targets, projects and pages or " +
      "`coverage` for what it knows it does NOT know, plus `walk` to drive the owner's own signed-in Chrome " +
      "through app.tryaether.ai and publish a generation, and `reset` to archive one. Holds no credential; a " +
      "walk sees exactly what the owner's live session sees",
  },
  platform: "aether",
  readDescriptor: async () => (await import("./descriptor.js")).AETHER_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readAetherSnapshot(args),
  verbs: [
    {
      describe: "drive the owner's own Chrome through the portal and publish a generation — holds no credential",
      load: async () => (await import("../../cli/commands/atlas/aether/walkRun.js")).aetherWalkCommand,
      usage: ["walk [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/atlas/aether/resetRun.js")).aetherResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
