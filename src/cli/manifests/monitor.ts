/**
 * Lazy manifest for the `monitor` noun — the local Datadog: named conditions over this machine's own
 * ledgers, each firing the floating card the hand register already draws.
 *
 * `effect: "local-state"` for `check` and `filter` (`list` only prints its declaration, so it is `none`): every
 * read is a file on this machine and every write lands in
 * `$SLOPWEAVER_HOME/hand-steps/` or `$SLOPWEAVER_HOME/hooks/`. No network, no model. `monitor filter
 * install` writes one file outside the state home — the shim at the path cmux's own config already names —
 * and backs up what was there.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `monitor` noun's verbs as lazy manifest entries. */
export const monitorManifest: Readonly<Record<string, VerbManifestEntry>> = {
  check: lazy({
    load: () => import("../commands/monitor/check.js").then((m) => m.monitorCheckCommand),
    meta: {
      ...sharedMeta,
      // A bare run is the rehearsal: `readOpenHandSteps` and `runMonitorPass` read the register and every ledger and print a report.
      dryParseSafe: false,
      example: "slopweaver monitor check --landing /tmp/landing.json --push --by-session workspace:29",
      summary:
        "Run every monitor once over this machine's own ledgers, posting a hand step for what ARRIVED and " +
        "settling what is gone — deciding and writing nothing without --fire",
      usage:
        "usage: slopweaver monitor check [--only <monitor>] [--landing <path>] [--fire] [--push] [--now <iso>] " +
        "[--by-session <text>] [--home <dir>] [--json]",
    },
  }),
  filter: lazy({
    load: () => import("../commands/monitor/filter.js").then((m) => m.monitorFilterCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver monitor filter install",
      summary:
        "The cmux notification filter: no cmux banner or sound reaches the desktop, the chair's included — the " +
        "floating note is the one surface; the record stays, and it fails open",
      usage: "usage: slopweaver monitor filter <install|show|status> [--hook-script <path>] [--home <dir>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/monitor/list.js").then((m) => m.monitorListCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // A bare run prints every monitor rather than usage, so it acts and is not dry-parse safe.
      dryParseSafe: false,
      // `runMonitorList` only prints the in-memory `MONITORS` declaration (list.ts:22-57): no ledger, clock or write.
      effect: "none",
      example: "slopweaver monitor list --json",
      summary: "Every monitor this install declares: what it reads, when it fires, and what makes it stop",
      usage: "usage: slopweaver monitor list [--home <dir>] [--json]",
    },
  }),
};
