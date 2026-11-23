/**
 * Lazy manifest for the `crowdstrike` noun — a local ground-truth atlas over one CrowdStrike Falcon
 * tenant's ENDPOINT surface: which machines carry a sensor, what policy each one is under, what Spotlight
 * has found on it, how it scores against Zero Trust, and what has been detected.
 *
 * Neither verb writes anywhere outside `$SLOPWEAVER_HOME`, so neither routes through the admit door: `sync`
 * reads Falcon and writes only the local atlas; `reset` touches only local files. Nothing either verb can
 * do changes a byte in the tenant — the API client holds Read on every scope and Write on none, and
 * `atlas/crowdstrike/inventory.ts` is a closed list of the calls that may be made at all.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/**
 * Exported so a test can assert this stays in sync with `core.ts`'s own copy.
 *
 * @internal
 */
export const SYNC_USAGE = "usage: slopweaver crowdstrike sync [--json] [--home <dir>]";

/**
 * Exported so a test can assert this stays in sync with `core.ts`'s own copy.
 *
 * @internal
 */
export const RESET_USAGE = "usage: slopweaver crowdstrike reset --confirm archive [--json] [--home <dir>]";

/**
 * Exported so a test can assert this stays in sync with `core.ts`'s own copy.
 *
 * @internal
 */
export const WALK_USAGE = "usage: slopweaver crowdstrike walk [--limit <n>] [--json] [--home <dir>]";

/**
 * Exported so a test can assert this stays in sync with `core.ts`'s own copy.
 *
 * @internal
 */
export const RECONCILE_USAGE = "usage: slopweaver crowdstrike reconcile [--fleet <file>] [--json] [--home <dir>]";

export const crowdstrikeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  reconcile: lazy({
    load: () => import("../commands/crowdstrike/reconcileRun.js").then((m) => m.crowdstrikeReconcileCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      // A pure READ of files the sync and the walk already wrote. No network call, so no door.
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver crowdstrike reconcile --json",
      parseRejectIsIoFree: true,
      summary:
        "Where the API and the console disagree, and where CrowdStrike disagrees with another fleet source about which machines exist and who last logged in — it reports the disagreements and resolves none of them",
      usage: RECONCILE_USAGE,
    },
  }),
  reset: lazy({
    load: () => import("../commands/crowdstrike/resetRun.js").then((m) => m.crowdstrikeResetCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver crowdstrike reset --confirm archive",
      parseRejectIsIoFree: true,
      summary:
        "Archive the current CrowdStrike atlas generation and install a fresh, empty one — nothing is ever deleted",
      usage: RESET_USAGE,
    },
  }),
  walk: lazy({
    load: () => import("../commands/crowdstrike/walkRun.js").then((m) => m.crowdstrikeWalkCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Drives the owner's OWN Chrome through the Playwright Extension relay and writes only the local
      // atlas under $SLOPWEAVER_HOME. It navigates and photographs; it clicks nothing and submits nothing.
      effect: "local-state",
      example: "slopweaver crowdstrike walk --limit 5",
      parseRejectIsIoFree: true,
      summary:
        "Fill the CrowdStrike atlas's BROWSER surface: walk every page the Falcon console's own sitemap declares in your real Chrome, photograph each, and record what the console itself asked for",
      usage: WALK_USAGE,
    },
  }),
  sync: lazy({
    load: () => import("../commands/crowdstrike/syncRun.js").then((m) => m.crowdstrikeSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Reads Falcon through a read-only API client and writes only the local atlas under $SLOPWEAVER_HOME
      // — no Slack/GitHub/Linear write, so this is local-state, exactly like `vanta sync`.
      effect: "local-state",
      example: "slopweaver crowdstrike sync --json",
      parseRejectIsIoFree: true,
      summary:
        "Sync one Falcon tenant's endpoint surface (hosts, host groups, prevention and sensor-update policies, Spotlight findings, Zero Trust scores, detections) into the local atlas",
      usage: SYNC_USAGE,
    },
  }),
};
