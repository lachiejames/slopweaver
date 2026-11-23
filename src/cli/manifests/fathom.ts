/**
 * Lazy manifest for the `fathom` noun — calls OTHER people recorded and shared with the owner.
 *
 * `refresh --source fathom` crawls the calls the owner's API key can list, which are the ones they recorded. A call a
 * colleague or a consultant recorded reaches the owner only as a share link, so these two verbs are the second
 * way in: `share` reads one link's raw transcript through the owner's own Chrome, and `discover` finds the links in
 * Fathom's own mail. Both write `local-state` — bronze and the local store — and neither is door-routed:
 * the page read is a relay READ with no click, and the mail read is `gmail read`'s own reader on the read
 * grant. `clear-inbox` is the one external write: `discover --ingest`, then `gmail archive` over each inbox mail
 * whose meeting the source now holds — the inbox triage never cards Fathom's mail.
 */
import { FATHOM_CLEAR_INBOX_USAGE, FATHOM_DISCOVER_USAGE, FATHOM_SHARE_USAGE } from "../commands/fathom/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `fathom` noun's verbs as lazy manifest entries. */
export const fathomManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "clear-inbox": lazy({
    load: () => import("../commands/fathom/clearInboxRun.js").then((m) => m.fathomClearInboxCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // The archive is `gmail archive`'s own run, so every mailbox change goes through that verb's door request.
      doorRouted: true,
      // A bare `clear-inbox` reads the mailbox and may archive, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver fathom clear-inbox --dry-run",
      parseRejectIsIoFree: true,
      summary: "Ingest what Fathom's inbox mail points at, then archive each mail whose meeting is proven held",
      usage: FATHOM_CLEAR_INBOX_USAGE,
    },
  }),
  discover: lazy({
    load: () => import("../commands/fathom/run.js").then((m) => m.fathomDiscoverCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare `fathom discover` is a real mailbox read, so it is not no-args-safe; its REJECT path is.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver fathom discover --ingest",
      parseRejectIsIoFree: true,
      summary: "Find Fathom share links in Fathom's own mail and say which calls the fathom source lacks",
      usage: FATHOM_DISCOVER_USAGE,
    },
  }),
  share: lazy({
    load: () => import("../commands/fathom/run.js").then((m) => m.fathomShareCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver fathom share https://fathom.video/share/<token>",
      parseRejectIsIoFree: true,
      summary:
        "Read one Fathom share link in your own Chrome and store its raw transcript by speaker — never the summary",
      usage: FATHOM_SHARE_USAGE,
    },
  }),
};
