/**
 * Lazy manifest for the `checkout` noun — keeping the main checkouts this install builds on current and
 * correctly installed.
 *
 * `status` is `diagnostic: true`: it reads git and stats a lockfile, and a non-zero exit REPORTS a drifted or
 * mis-installed checkout (a finding), never a broken tool — the same channel `doctor` uses. It is
 * `effect: "local-state"` because `--fetch` moves each checkout's remote-tracking refs and one meta covers both
 * forms. `sync` is `local-state` too: it fast-forwards a local branch and runs a local install. None of the three
 * writes to Slack, GitHub or Linear, so none is the admit door's concern.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The `checkout` noun's verbs as lazy manifest entries. */
export const checkoutManifest: Readonly<Record<string, VerbManifestEntry>> = {
  // `local-state` rather than a read: a reading fetches the upstream's remote when the last fetch is a minute old,
  // and files a fetch claim and stamp under the cache root's `docs-site/` (`src/checkouts/consoleBuildDeps.ts`) to keep
  // two readers from fetching at once. It moves only remote-tracking refs, and writes nothing to any provider. A
  // bare run does all of that, so it is not `dryParseSafe`.
  console: lazy({
    load: () => import("../commands/checkout/consoleRun.js").then((m) => m.checkoutConsoleCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver checkout console --json",
      parseRejectIsIoFree: true,
      summary:
        "Report which build the console serves from this checkout, against its HEAD and its upstream's newest commits",
      usage: "usage: slopweaver checkout console [--json]",
    },
  }),
  status: lazy({
    load: () => import("../commands/checkout/statusRun.js").then((m) => m.checkoutStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run inspects every declared checkout with `git`, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver checkout status --fetch",
      parseRejectIsIoFree: true,
      summary:
        "Report each declared main checkout's drift from its upstream and whether node_modules matches its lockfile",
      usage: "usage: slopweaver checkout status [--fetch] [--home <value>] [--json] [--path <value>]",
    },
  }),
  sync: lazy({
    load: () => import("../commands/checkout/syncRun.js").then((m) => m.checkoutSyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare run fetches and fast-forwards each checkout, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver checkout sync --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Fast-forward each declared main checkout onto its upstream, install when the pull requires it, and " +
        "bring the console it serves onto the new HEAD",
      usage: "usage: slopweaver checkout sync [--dry-run] [--home <value>] [--path <value>]",
    },
  }),
};
