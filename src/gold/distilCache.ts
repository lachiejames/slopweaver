/**
 * The distil batch cache: `content-hash → digest`, persisted at `corpus/.cache/distil/batches.json`
 * (rebuildable, gitignored). This is the incrementality engine — a batch whose hash is already cached is
 * served without an LLM call, so a re-run only spends tokens on batches whose bronze changed. Stale
 * hashes simply go unreferenced; the cache is keyed by hash, never pruned.
 */

import { readFileIfPresent } from "../atlas/atlasFile.js";
import { distilCachePath, distilPromptMarkerPath } from "../corpus/corpusPaths.js";
import { ALL_CORPUS_SOURCES } from "../integrations/corpusSources.js";
import { readJsonFile, writeJsonFile } from "../lib/jsonFile.js";
import { isOneOf, isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { BatchDigest, DigestPoint } from "./distil.js";

/** Validate one cached value into a `BatchDigest`, or undefined if malformed. */
function parseCachedDigest({ value }: { value: unknown }): BatchDigest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const source = value["source"];
  const container = value["container"];
  const summary = value["summary"];
  const rawPoints = value["points"];
  if (
    typeof source !== "string" ||
    !isOneOf(source, ALL_CORPUS_SOURCES) ||
    typeof container !== "string" ||
    typeof summary !== "string" ||
    !Array.isArray(rawPoints)
  ) {
    return undefined;
  }
  const points: DigestPoint[] = [];
  for (const raw of rawPoints) {
    if (isRecord(raw) && typeof raw["point"] === "string" && Array.isArray(raw["citations"])) {
      points.push({
        citations: raw["citations"].filter((c): c is string => typeof c === "string"),
        point: raw["point"],
      });
    }
  }
  return { container, points, source, summary };
}

/**
 * Load the batch cache.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns a map from batch hash to cached digest (empty when no cache file)
 */
export function loadDistilCache({ home }: { home?: string } = {}): Map<string, BatchDigest> {
  const raw = readJsonFile({ path: distilCachePath(home === undefined ? {} : { home }) });
  const cache = new Map<string, BatchDigest>();
  if (isRecord(raw)) {
    for (const [hash, value] of Object.entries(raw)) {
      const digest = parseCachedDigest({ value });
      if (digest !== undefined) {
        cache.set(hash, digest);
      }
    }
  }
  return cache;
}

/**
 * Persist the batch cache.
 *
 * @param cache the hash → digest map
 * @param home the Slopweaver home (defaults to the resolved home)
 */
export function saveDistilCache({ cache, home }: { cache: ReadonlyMap<string, BatchDigest>; home?: string }): void {
  writeJsonFile({ path: distilCachePath(home === undefined ? {} : { home }), value: Object.fromEntries(cache) });
}

/**
 * The distil contract fingerprint the cached digests were produced under.
 *
 * A marker that is there but unreadable is refused rather than read as none: read as none, it named the
 * cached digests "unversioned (pre-PR5.4 cache)", which a corrupt file is not.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the stored fingerprint, `null` when no marker exists (a pre-PR5.4 home, or a cold cache), or why
 *   the one on disk cannot be trusted
 */
export function readDistilPromptMarker({ home }: { home?: string } = {}): Result<string | null> {
  const path = distilPromptMarkerPath(home === undefined ? {} : { home });
  const untrusted = ({ detail }: { detail: string }): Result<never> =>
    err([
      `distil: the contract marker at ${path} is there but cannot be trusted (${detail}) — delete it, then ` +
        "re-run `distil brief --accept-prompt-change` to confirm the cached digests",
    ]);
  const text = readFileIfPresent({ path });
  if (text.isErr()) {
    return untrusted({ detail: text.error.join("; ") });
  }
  if (text.value === null) {
    return ok(null);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch {
    return untrusted({ detail: "it is not JSON" });
  }
  if (!isRecord(raw) || typeof raw["fingerprint"] !== "string") {
    return untrusted({ detail: "it carries no fingerprint" });
  }
  return ok(raw["fingerprint"]);
}

/**
 * Record the distil contract the cache now holds. Written only once a run is authorised to spend under the
 * current contract, so an unauthorised (refused) run leaves the previous marker intact and refuses again.
 *
 * @param fingerprint the current contract fingerprint
 * @param home the Slopweaver home (defaults to the resolved home)
 */
export function writeDistilPromptMarker({ fingerprint, home }: { fingerprint: string; home?: string }): void {
  writeJsonFile({ path: distilPromptMarkerPath(home === undefined ? {} : { home }), value: { fingerprint } });
}
