/**
 * The three `store measurement-*` readers' manifest rows — the measurements read back out of the store.
 *
 * Split out of `./store.ts` for the same reason `./storeProjectionMeta.ts` was: that manifest sits at its size
 * ratchet. These three belong together because each answers from `measurement_location`, `measurement_blob`
 * and the Storage bucket and none reads the home, so a reader comparing them is reading one idea.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `store measurement-list` — every stored location a filter selects. */
const measurementListMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store measurement-list --class proof --prefix proof/1263",
  parseRejectIsIoFree: true,
  summary:
    "List the measurements the store holds — bakeoff, datadog-shots, evidence and proof — from the store only, never the disk copy",
  usage: "usage: slopweaver store measurement-list [--class <c>] [--prefix <path>] [--home <dir>] [--json]",
} as const;

/** `store measurement-show` — one measurement's body, by anchor, path or hash. */
const measurementShowMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store measurement-show --ref ~/.slopweaver/proof/1263/gold.md",
  parseRejectIsIoFree: true,
  summary:
    "Print one measurement from the store by anchor, path or sha-256 — a Storage body (an image) is written byte-exact to --out",
  usage: "usage: slopweaver store measurement-show --ref <anchor|path|sha256> [--out <file>] [--home <dir>] [--json]",
} as const;

/** `store measurement-restore` — the stored measurements, written back out as files. */
const measurementRestoreMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store measurement-restore --into /tmp/restored --class evidence --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Write the newest stored body of every selected measurement back under a directory with its mtime — never over a file that differs",
  usage:
    "usage: slopweaver store measurement-restore --into <dir> [--class <c>] [--prefix <path>] [--dry-run] [--home <dir>] [--json]",
} as const;

/** The three verbs, spread into the `store` manifest. */
export const measurementVerbs: Readonly<Record<string, VerbManifestEntry>> = {
  "measurement-list": lazy({
    load: () => import("../commands/store/measurementRun.js").then((m) => m.storeMeasurementListCommand),
    meta: measurementListMeta,
  }),
  "measurement-restore": lazy({
    load: () => import("../commands/store/measurementRestoreRun.js").then((m) => m.storeMeasurementRestoreCommand),
    meta: measurementRestoreMeta,
  }),
  "measurement-show": lazy({
    load: () => import("../commands/store/measurementShowRun.js").then((m) => m.storeMeasurementShowCommand),
    meta: measurementShowMeta,
  }),
};
