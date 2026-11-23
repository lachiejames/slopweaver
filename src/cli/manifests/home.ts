/**
 * Lazy manifest for the `home` noun — what sits in `$SLOPWEAVER_HOME` that no longer earns its keep, and
 * taking it.
 *
 * Of the bytes in the user-level home, delete what is obviously junk —
 * node_modules, build output — with NO retention policy, keeping anything that could hold useful
 * information not re-derivable elsewhere.
 *
 * `effect: "local-state"`: `reclaim` and `reclaimed` touch only this machine's own home, and
 * `reclaim` writes nothing without `--apply`. No model and no tokens — AGENTS.md rule 2 is why the automatic half
 * has to be pure code.
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

/** The `home` noun's verbs as lazy manifest entries. */
export const homeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  reclaim: lazy({
    load: () => import("../commands/home/reclaimRun.js").then((m) => m.homeReclaimCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver home reclaim --root codex-scratch",
      summary:
        "Take the obviously-junk bytes out of the DECLARED scratch root under $SLOPWEAVER_HOME — a " +
        "FINISHED Codex pass's whole scratch workspace, never its record — reporting everything and deleting " +
        "nothing without --apply. No age anywhere in it, and no content rule either: under a scratch " +
        "root the PATH is the state, which roots.ts carries as a finding",
      usage: "usage: slopweaver home reclaim [--root <name>] [--apply] [--home <dir>] [--json]",
    },
  }),
  reclaimed: lazy({
    load: () => import("../commands/home/reclaimedRun.js").then((m) => m.homeReclaimedCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver home reclaimed",
      summary:
        "Read the reclaim ledger back — what each run took, from which root, and whether its post-apply " +
        "witness held. The RAIL: a reclaim cannot be undone, so it stays findable",
      usage: "usage: slopweaver home reclaimed [--home <dir>] [--json]",
    },
  }),
};
