/**
 * Lazy manifest for the `onepassword` noun — a local ground-truth atlas over a 1Password account's ADMIN
 * surface (users, groups, membership, vaults, vault access, item COUNTS, integrations, audit activity),
 * synced through `atlas/onepassword/**`.
 *
 * Neither verb writes anywhere outside `$SLOPWEAVER_HOME`, so neither routes through the admit door: `sync`
 * reads 1Password and writes only the local atlas; `reset` touches only local files. No item's contents are
 * reachable from either — see `atlas/onepassword/sensitivity.ts` for the three mechanisms that make that a
 * property rather than an intention.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/**
 * Exported so a test can assert this stays in sync with `syncRun.ts`'s own copy.
 *
 * @internal
 */
export const SYNC_USAGE = "usage: slopweaver onepassword sync [--since <iso>] [--json] [--home <dir>]";

/**
 * Exported so a test can assert this stays in sync with `resetRun.ts`'s own copy.
 *
 * @internal
 */
export const RESET_USAGE = "usage: slopweaver onepassword reset --confirm archive [--json] [--home <dir>]";

export const onepasswordManifest: Readonly<Record<string, VerbManifestEntry>> = {
  reset: lazy({
    load: () => import("../commands/onepassword/resetRun.js").then((m) => m.onepasswordResetCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver onepassword reset --confirm archive",
      parseRejectIsIoFree: true,
      summary:
        "Archive the current 1Password atlas generation and install a fresh, empty one — nothing is ever deleted",
      usage: RESET_USAGE,
    },
  }),
  sync: lazy({
    load: () => import("../commands/onepassword/syncRun.js").then((m) => m.onepasswordSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // Shells the local `op` binary and reads the Events API, writing only the local atlas under
      // $SLOPWEAVER_HOME — no Slack/GitHub/Linear write, so this is local-state, exactly like `vanta sync`.
      effect: "local-state",
      example: "slopweaver onepassword sync --json",
      parseRejectIsIoFree: true,
      summary:
        "Sync a 1Password account's admin surface (people, groups, vaults, access, activity) into the local atlas",
      usage: SYNC_USAGE,
    },
  }),
};
