/**
 * ORIGIN SURVIVAL — whether a lane could actually be rebuilt by re-running the scan that filled it.
 *
 * A lane fetched from a provider can be re-fetched. A lane scanned off the local filesystem can only be
 * re-scanned, and a re-scan reads the tree as it is TODAY. When that tree has been pruned since, the lane is
 * the only copy of everything that was removed, and no amount of comparing the corpus to itself will say so:
 * the records are all still present, every count is stable, and a rebuild verdict computed from
 * {@link ./manifest.compareManifests} alone reads the lane as freely disposable.
 *
 * That is not hypothetical. Both a fleet session and the supervisor independently graded this
 * install's `self` lane WIPE at high confidence, each having checked that the scan was read-only and that it
 * targeted the right directory, and neither having checked whether the files it scanned still existed. 3,982
 * of 5,019 did not. Reproduce the reading on any corpus with `slopweaver dev manifest`.
 *
 * The three verdicts below are the whole model, and the third one is the reason this is a module rather than a
 * boolean: a lane with no local origins is not INTACT, it is outside what this reading can speak to, and
 * collapsing those two into "fine" is the same false reassurance in a new place.
 */
import type { CorpusManifest } from "./manifest.js";

/**
 * What origin survival can say about one lane.
 *
 * - `no-local-origins` — nothing in the lane was scanned from a local file, so this reading is silent about it
 *   and a rebuildable verdict has to be argued some other way.
 * - `intact` — every local origin the lane was built from is still on disk, so a re-scan would reproduce it.
 * - `lossy` — at least one origin is GONE, so the lane holds text a re-scan cannot bring back.
 *
 * @internal
 */
export type SurvivalVerdict = "no-local-origins" | "intact" | "lossy";

/**
 * One lane's origin survival.
 *
 * @internal
 */
export interface LaneSurvival {
  readonly source: string;
  /** Distinct local origin files still on disk. */
  readonly present: number;
  /** Distinct local origin files that are gone — the number a rebuildable verdict cites. */
  readonly missing: number;
  readonly verdict: SurvivalVerdict;
}

/**
 * The survival reading for every source in a manifest, sorted by source name. Pure.
 *
 * Every source in `bySource` gets a row, including the ones with no local origins at all — an omitted row
 * would be read as an absent problem rather than an absent measurement.
 *
 * @param manifest the manifest to read the origin tallies off
 * @returns one row per source, sorted by name
 */
export function laneSurvival({ manifest }: { manifest: CorpusManifest }): readonly LaneSurvival[] {
  return Object.keys(manifest.bySource)
    .toSorted((left, right) => left.localeCompare(right))
    .map((source) => {
      const present = manifest.originsPresentBySource[source] ?? 0;
      const missing = manifest.originsMissingBySource[source] ?? 0;
      return { missing, present, source, verdict: verdictFor({ missing, present }) };
    });
}

/** The verdict for one lane's two counts. Pure. */
function verdictFor({ present, missing }: { present: number; missing: number }): SurvivalVerdict {
  if (present === 0 && missing === 0) {
    return "no-local-origins";
  }
  if (missing > 0) {
    return "lossy";
  }
  return "intact";
}

/**
 * Whether a lane may be called rebuildable ON THIS EVIDENCE. Pure.
 *
 * False for `lossy` AND for `no-local-origins`, which is the point: this answers "has survival cleared this
 * lane", not "is this lane a problem". A fetched lane is rebuildable for reasons this module cannot see, and
 * saying so here would let a caller cite a reading that never looked at anything.
 *
 * @param lane the lane's survival row
 * @returns true only when every local origin the lane was built from still exists
 */
export function survivalClearsRebuild({ lane }: { lane: LaneSurvival }): boolean {
  return lane.verdict === "intact";
}

/**
 * The human lines for a survival reading, lossy lanes first. Pure.
 *
 * Paths are never named — a lane's origins are absolute paths under the owner's home, which is a leak class
 * the hygiene gate catches — so this renders counts only and is safe to paste anywhere.
 *
 * @param lanes the rows from {@link laneSurvival}
 * @returns the ordered lines
 */
export function renderSurvival({ lanes }: { lanes: readonly LaneSurvival[] }): readonly string[] {
  const lossy = lanes.filter((lane) => lane.verdict === "lossy");
  const header =
    lossy.length === 0
      ? "origin survival: no lane has lost an origin file"
      : `origin survival: ${String(lossy.length)} lane(s) CANNOT be rebuilt by re-scanning`;
  const rest = lanes.filter((lane) => lane.verdict !== "lossy");
  return [header, ...lossy.map((lane) => describeLane({ lane })), ...rest.map((lane) => describeLane({ lane }))];
}

/** One lane's line. Pure. */
function describeLane({ lane }: { lane: LaneSurvival }): string {
  const scanned = lane.present + lane.missing;
  if (lane.verdict === "no-local-origins") {
    return `  ----  ${lane.source}: no local origins — this reading says nothing about it`;
  }
  if (lane.verdict === "lossy") {
    return (
      `  LOST  ${lane.source}: ${String(lane.missing)} of ${String(scanned)} origin file(s) are GONE — ` +
      `a re-scan cannot rebuild this lane`
    );
  }
  return `  ok    ${lane.source}: all ${String(scanned)} origin file(s) still exist`;
}
