/**
 * Lazy manifest for the `velocity` noun — the machine's own trailing-window pace (see `cli/manifest.ts`).
 *
 * The bare-noun and `run` verb resolve to the SAME handler, so both entries share one loader, exactly like
 * `doctor`.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare-noun + `run` verb. */
const velocityMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // Every flag is optional: a bare `runVelocity` reads git and the ledgers and prints the report, so it is not a dry parse.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver velocity --days 7",
  parseRejectIsIoFree: true,
  summary:
    "Trailing-window pace read from git + the local ledgers: merges/day, docs landed/day, doc latency, turns/ask",
  usage: "usage: slopweaver velocity [--repo <dir>] [--ref <ref>] [--days N] [--json] [--home <dir>]",
} as const;

/** Lazy loader for the shared velocity handler — one module fetch, reused across the bare-noun + `run` verb. */
const loadVelocity = () => import("../commands/velocity/run.js").then((m) => m.velocityRunCommand);

/** The `velocity` noun's verbs as lazy manifest entries. */
export const velocityManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadVelocity, meta: velocityMeta }),
  run: lazy({ load: loadVelocity, meta: velocityMeta }),
};
