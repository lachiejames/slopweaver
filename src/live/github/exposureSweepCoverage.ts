/**
 * How completely `github exposure sweep` read one surface, from the inventory's state of it and what the sweep read.
 *
 * Two surfaces publish content the sweep does not fetch: each artifact's archive and each uploaded asset. Their names
 * and every place linking to them ARE read; their content is `not-swept` with the reason, whenever there is any. That
 * is never a clean surface, so a sweep over a repository with either is incomplete rather than an all-clear.
 *
 * Whether there are uploads is the SWEEP's count, never the inventory's: the inventory reads upload links from bodies
 * only, while the sweep sees them in every text it scans, a commit message or a job log included.
 */

import type { GithubExposureState, GithubExposureSurfaceId, GithubExposureSurfaceResult } from "./exposureModel.js";

/** Content a surface publishes that this sweep counts but does not fetch, and what it does read there instead. */
const CONTENT_NOT_READ: Partial<Record<GithubExposureSurfaceId, string>> = {
  "actions-artifacts": "artifact archives are not read; their names are",
  attachments:
    "each upload found is listed with every read place that links it in uploads.jsonl; its bytes are not read or analysed and are left for a visible session to look at",
};

/** How completely one surface's text was swept. */
export type GithubExposureSweepCoverage =
  | { readonly kind: "swept"; readonly texts: number; readonly limits: readonly string[] }
  | { readonly kind: "partial"; readonly texts: number; readonly why: readonly string[] }
  | { readonly kind: "not-swept"; readonly texts: number; readonly why: readonly string[] }
  | { readonly kind: "not-enabled"; readonly detail: string }
  | { readonly kind: "not-readable-by-api"; readonly detail: string }
  | { readonly kind: "read-failed"; readonly why: readonly string[] };

/** One surface's coverage and how many findings it holds. */
export interface GithubExposureSweepSurface {
  readonly surface: GithubExposureSurfaceId;
  readonly coverage: GithubExposureSweepCoverage;
  readonly findings: number;
}

/** How much a counted or partial surface holds. */
function heldCount({ state }: { state: GithubExposureState }): number {
  if (state.kind === "counted") {
    return state.count;
  }
  if (state.kind === "partial") {
    return state.observedAtLeast;
  }
  return 0;
}

/** Whether a surface holds content the sweep does not read: the sweep's own upload count decides `attachments`. */
function holdsUnread({ result, uploadCount }: { result: GithubExposureSurfaceResult; uploadCount: number }): boolean {
  if (result.surface === "attachments") {
    return uploadCount > 0;
  }
  return heldCount({ state: result.state }) > 0;
}

/**
 * One surface's sweep coverage, from the inventory's state of it and what the tap read. Pure.
 *
 * @param result the inventory's surface
 * @param texts how many distinct texts the tap scanned there
 * @param sweepGaps why the sweep could not read all of that surface's text, beyond what the inventory found
 * @param sweepLimits what GitHub itself no longer serves there, beyond the inventory's limits
 * @param uploadCount how many distinct uploads the sweep found linked anywhere, which decides `attachments`
 * @returns the coverage
 */
export function githubExposureSweepCoverage({
  result,
  texts,
  sweepGaps,
  sweepLimits,
  uploadCount,
}: {
  result: GithubExposureSurfaceResult;
  texts: number;
  sweepGaps: readonly string[];
  sweepLimits: readonly string[];
  uploadCount: number;
}): GithubExposureSweepCoverage {
  const { state, surface } = result;
  if (state.kind === "not-enabled" || state.kind === "not-readable-by-api") {
    return { detail: state.detail, kind: state.kind };
  }
  const inventoryGaps = state.kind === "partial" || state.kind === "read-failed" ? state.why : [];
  const notRead = CONTENT_NOT_READ[surface];
  // Before read-failed: an upload the sweep found in some other text is unread content however its listing went.
  if (notRead !== undefined && holdsUnread({ result, uploadCount })) {
    return { kind: "not-swept", texts, why: [notRead, ...inventoryGaps, ...sweepGaps] };
  }
  if (state.kind === "read-failed") {
    return { kind: "read-failed", why: [...state.why, ...sweepGaps] };
  }
  if (inventoryGaps.length > 0 || sweepGaps.length > 0) {
    return { kind: "partial", texts, why: [...inventoryGaps, ...sweepGaps] };
  }
  const inventoryLimits = state.kind === "counted" ? state.limits : [];
  return { kind: "swept", limits: [...inventoryLimits, ...sweepLimits], texts };
}
