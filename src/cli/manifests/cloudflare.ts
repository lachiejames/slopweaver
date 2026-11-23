/**
 * Lazy manifest for the `cloudflare` noun — a local ground-truth atlas over one Cloudflare account's
 * configuration (Access, Gateway Lists, Pages, Workers, notifications, audit logs, certificates, settings,
 * plus deep zone DNS/firewall/SSL/analytics/API Gateway reads for one explicitly configured zone), synced
 * through `atlas/cloudflare/**`. Neither verb writes anywhere outside `$SLOPWEAVER_HOME`, so neither routes
 * through the admit door: `sync` reads Cloudflare and writes only the local atlas; `reset` touches only
 * local files.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Exported so a test can assert this stays in sync with `resetRun.ts`'s own copy. */
export const RESET_USAGE = "usage: slopweaver cloudflare reset --confirm archive [--json] [--home <dir>]";
/** Exported so a test can assert this stays in sync with `syncRun.ts`'s own copy. */
export const SYNC_USAGE =
  "usage: slopweaver cloudflare sync [--account-id <id>] [--deep-zone <name>] [--json] [--home <dir>]";

export const cloudflareManifest: Readonly<Record<string, VerbManifestEntry>> = {
  reset: lazy({
    load: () => import("../commands/cloudflare/resetRun.js").then((m) => m.cloudflareResetCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver cloudflare reset --confirm archive",
      parseRejectIsIoFree: true,
      summary:
        "Archive the current Cloudflare atlas generation and install a fresh, empty one — nothing is ever deleted",
      usage: RESET_USAGE,
    },
  }),
  sync: lazy({
    load: () => import("../commands/cloudflare/syncRun.js").then((m) => m.cloudflareSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Reads the configured Cloudflare account/deep zone and writes only the local atlas under
      // $SLOPWEAVER_HOME — no Slack/GitHub/Linear write, so this is local-state rather than external-write,
      // exactly like vanta's own sync entry.
      effect: "local-state",
      example: "slopweaver cloudflare sync --json",
      parseRejectIsIoFree: true,
      summary:
        "Sync every account-scoped and configured-deep-zone Cloudflare surface (Access, Pages, Workers, DNS, firewall, SSL, analytics, API Gateway) into the local atlas",
      usage: SYNC_USAGE,
    },
  }),
};
