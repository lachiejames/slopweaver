/**
 * Lazy manifest for the `subset` noun — a time-bounded copy of the real corpus in a home of its own.
 *
 * Its own noun rather than a verb under `slice`, and the distance is deliberate: `slice capture|verify`
 * already means "pin a named subset of a source and prove nothing was lost", which is a completeness
 * instrument. This is a different thing entirely — a smaller corpus you can run the whole pipeline against
 * in minutes — and two meanings of one word in one CLI is a trap rather than a saving.
 *
 * The bare noun resolves to `status` (read-only), so a bare `slopweaver subset` can never start a copy.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const buildMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver subset build --limit 500 --out ~/.slopweaver-small",
  parseRejectIsIoFree: true,
  summary:
    "Slice the REAL corpus into a home of its own — by window, by per-source record count, or both — labelled a subset everywhere it answers",
  usage: "usage: slopweaver subset build --out <dir> [--days N] [--limit N] [--home <dir>] [--json]",
} as const;

const statusMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // Every flag is optional: a bare `runSubsetStatus` reads the home's subset manifest and reports it, so it is not a dry parse.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver subset status --home ~/.slopweaver-7d",
  parseRejectIsIoFree: true,
  summary:
    "Say whether a home is a subset, of what corpus, over which window or cap, and which sources it holds none of",
  usage: "usage: slopweaver subset status [--home <dir>] [--json]",
} as const;

const loadStatus = () => import("../commands/subset/run.js").then((m) => m.subsetStatusCommand);

/** The `subset` noun's verbs as lazy manifest entries. */
export const subsetManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadStatus, meta: statusMeta }),
  build: lazy({ load: () => import("../commands/subset/run.js").then((m) => m.subsetBuildCommand), meta: buildMeta }),
  status: lazy({ load: loadStatus, meta: statusMeta }),
};
