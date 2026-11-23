/**
 * Lazy manifest for the `cycle` noun — Linear cycle hygiene and overdue project updates, as proposals.
 *
 * The bare noun and `reconcile` resolve to the same handler, so both share one loader.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare-noun + `reconcile` verb. */
const reconcileMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run takes an empty tail and runs the whole pass over the corpus, so it acts rather than printing usage.
  dryParseSafe: false,
  // One meta covers every form, and `--write` publishes the report under the home
  // (`live/hygiene/cycle-reconcile.json`), so the verb is `local-state` though a bare run only reads.
  effect: "local-state",
  example: "slopweaver cycle reconcile",
  parseRejectIsIoFree: true,
  summary:
    "Propose which of your current-cycle tickets to close and which projects are overdue an update — evidence attached, one word each, nothing sent and nothing changed in Linear or GitHub; `--write` only publishes the local JSON document",
  usage:
    "usage: slopweaver cycle reconcile [--json | --form] [--verify] [--post --dry-run] [--write] [--now <iso>] [--home <dir>]",
} as const;

/** Lazy loader for the shared reconcile handler. */
const loadReconcile = () => import("../commands/cycle/reconcileRun.js").then((m) => m.cycleReconcileCommand);

/** The `cycle` noun's verbs as lazy manifest entries. */
export const cycleManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadReconcile, meta: reconcileMeta }),
  reconcile: lazy({ load: loadReconcile, meta: reconcileMeta }),
};
