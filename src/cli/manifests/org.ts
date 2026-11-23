/**
 * Lazy manifest for the `org` noun — the organisation this install works for, one row in the store.
 *
 * The organisation is written once and used everywhere. A reader that takes the
 * organisation takes the row `org show` prints; a fresh install that has not run `org set` is refused by name rather
 * than placing nothing. Both verbs are LOCAL: they read and write this install's own store, and nothing leaves it.
 */
import { ORG_SET_USAGE, ORG_SHOW_USAGE } from "../commands/org/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const orgManifest: Readonly<Record<string, VerbManifestEntry>> = {
  set: lazy({
    load: () => import("../commands/org/run.js").then((m) => m.orgSetCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // LOCAL: one row in this install's own store. Nothing reaches a provider or a person, so no door.
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example:
        "slopweaver org set --display-name Acme --github-owner acme --google-domain acme.com " +
        "--slack-host acme.slack.com --linear-workspace acme --vanta-workspace acme --repository acme/acme-admin",
      parseRejectIsIoFree: true,
      summary:
        "Write the organisation this install works for — once, in the store — for the readers that place work by it",
      usage: ORG_SET_USAGE,
    },
  }),
  show: lazy({
    load: () => import("../commands/org/run.js").then((m) => m.orgShowCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Reads one store row and the checkout's origin, and writes nothing.
      effect: "none",
      example: "slopweaver org show --json",
      parseRejectIsIoFree: true,
      summary: "Print the organisation from the store, with this build's own repository derived from its origin",
      usage: ORG_SHOW_USAGE,
    },
  }),
};
