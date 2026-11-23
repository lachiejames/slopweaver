/**
 * How far back this install's bronze can be TRUSTED to say whether a capture was complete.
 *
 * `seenIndex.ts` skips a page when bronze holds it at the same `last_edited_time` and that capture is not
 * marked `capture: "partial"`. The marker is written only on truncated captures, so a complete one carries
 * no attr — which keeps an unchanged page's fingerprint byte-identical instead of churning the corpus, and
 * leaves exactly one hole: **bronze written before the marker existed also carries no attr, so a capture
 * that was truncated back then reads as complete.** Left there, the very first truncated capture of a page
 * would authorise skipping the re-fetch that would repair it, permanently and silently. An adversarial
 * review pass named that as the counterexample, and it is the failure class this corpus cares most about —
 * a page whose body was never indexed is invisible to a query and nothing about the answer reports it.
 *
 * The fix is one recorded fact rather than a flag someone has to remember. A crawl that COMPLETED, was not
 * bounded by a cap, and hit no gap that withholds the cursor has re-captured every page edited at or after
 * its own `since` — so from that point on, every one of those pages carries a marker if it needed one.
 * This file records the oldest such `since` ever completed, and the index refuses to trust an unmarked
 * capture older than it. Before the first qualifying crawl the file is absent and NOTHING is skipped,
 * which is the safe direction to be wrong in.
 */
import { join } from "node:path";
import { slopweaverHome } from "../../config.js";
import { readJsonFile, writeJsonFile } from "../../lib/jsonFile.js";
import { isRecord } from "../../lib/parsers.js";
import { bronzeSourceDir } from "../corpusPaths.js";

/** The on-disk shape. Versioned so a future widening is a migration rather than a silent reinterpretation. */
interface CaptureCoverageFile {
  readonly version: 1;
  readonly coveredSinceIso: string;
}

/** The path of the sidecar, beside the bronze window files whose trustworthiness it describes. */
function coveragePath({ home }: { home: string }): string {
  return join(bronzeSourceDir({ home, source: "notion" }), ".capture-coverage.json");
}

/**
 * The oldest `since` a qualifying marker-aware crawl has completed, or undefined when none has.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the covered-since instant, or undefined ⇒ trust no unmarked capture at all
 */
export function readNotionCaptureCoverage({ home = slopweaverHome() }: { home?: string } = {}): string | undefined {
  const parsed = readJsonFile({ path: coveragePath({ home }) });
  if (!isRecord(parsed) || parsed["version"] !== 1) {
    return undefined;
  }
  const covered = parsed["coveredSinceIso"];
  return typeof covered === "string" ? covered : undefined;
}

/**
 * Widen the recorded coverage to include this crawl's window. Keeps the OLDEST `since` ever completed: a
 * later, narrower crawl does not un-mark the pages an earlier, wider one already marked.
 *
 * The CALLER decides whether a crawl qualifies (see {@link notionCrawlCoversWindow}) — this only records.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param sinceIso the completed crawl's own `since`
 */
export function recordNotionCaptureCoverage({
  home = slopweaverHome(),
  sinceIso,
}: {
  home?: string;
  sinceIso: string;
}): void {
  const existing = readNotionCaptureCoverage({ home });
  const coveredSinceIso = existing !== undefined && existing < sinceIso ? existing : sinceIso;
  writeJsonFile({ path: coveragePath({ home }), value: { coveredSinceIso, version: 1 } satisfies CaptureCoverageFile });
}

/**
 * Whether this crawl actually covered its whole window, and so may widen the recorded coverage. Pure.
 *
 * The same three conditions the cursor already turns on, for the same reason: a capped run stopped early,
 * and a run with a transient gap did not read everything it was asked for. Either would record coverage
 * over pages it never visited, which is precisely the false claim this file exists to prevent.
 *
 * The third condition is the one that is easy to miss, and an adversarial review pass found it: a failed
 * `dataSources.query` or `search` page produces NO items to mark partial, so the rows under it are simply
 * absent while the pages lane's own shadow of such a row lands looking complete. Coverage is the claim
 * that everything from `since` onward was re-captured, and a crawl that never enumerated part of the
 * workspace cannot make it.
 *
 * @param bounded whether `--fetch-cap` or `--sample` cut the run short of its window
 * @param gaps the coverage gaps the run reported (transient reasons only — see `skips.ts`)
 * @param enumerationIncomplete whether any enumeration call failed recoverably (see
 *   `skips.ts#enumerationWasIncomplete`)
 * @returns true when the crawl's `since` may be recorded as covered
 */
export function notionCrawlCoversWindow({
  bounded,
  gaps,
  enumerationIncomplete,
}: {
  bounded: boolean;
  gaps: readonly string[];
  enumerationIncomplete: boolean;
}): boolean {
  return !bounded && gaps.length === 0 && !enumerationIncomplete;
}
