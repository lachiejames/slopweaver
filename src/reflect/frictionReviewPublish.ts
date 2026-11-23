/**
 * Read/write `$SLOPWEAVER_HOME/live/friction-review/published.json` — the stamp `reflect friction-review
 * --republish` writes once its page is published, and `--mark-published` writes alone for a page a session
 * published itself.
 * See `frictionReviewGap.ts` for why this exists and what it's compared against.
 *
 * Not sensitive (unlike `judgement/miningStore.ts`'s private profile), so this goes through the generic
 * `lib/jsonFile.ts` writer rather than owner-only `0600` treatment, the same call `codex/quotaCache.ts`
 * makes for its own small backstop record.
 */
import { readJsonFile, writeJsonFile } from "../lib/jsonFile.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * The stamp one republish writes.
 *
 * @internal
 */
export interface FrictionReviewPublishStamp {
  /** The `$home/morning` report date this republish carried onto the artifact, `YYYY-MM-DD`. */
  readonly localDate: string;
  /** When the mark was written. */
  readonly publishedAtIso: string;
}

/** Structurally validate an already-decoded stamp value, or undefined if malformed. Pure. */
function parseStamp({ value }: { value: unknown }): FrictionReviewPublishStamp | undefined {
  if (!isRecord(value) || typeof value["localDate"] !== "string" || typeof value["publishedAtIso"] !== "string") {
    return undefined;
  }
  return { localDate: value["localDate"], publishedAtIso: value["publishedAtIso"] };
}

/**
 * Read the last republish stamp, if any.
 *
 * @internal read outside this module through {@link publishedReportDate}; exported for its own tests.
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the stamp, or undefined when none has been written (or it is unparseable)
 */
export function readFrictionReviewPublishStamp({ home }: { home?: string } = {}):
  FrictionReviewPublishStamp | undefined {
  const path = stateHomePaths(home === undefined ? {} : { home }).live.frictionReview.publishedJson;
  return parseStamp({ value: readJsonFile({ path }) });
}

/**
 * The report date the Friction Review artifact was last republished with, or `null` when it was never
 * republished — no readable stamp — which the gap check reads as "nothing published yet". Reads under the
 * given `home`, else the resolved home.
 *
 * @returns the republished report date, `YYYY-MM-DD`, or `null` when the artifact was never republished
 */
export function publishedReportDate(options: { home?: string } = {}): string | null {
  const stamp = readFrictionReviewPublishStamp(options);
  if (stamp == null) {
    // Never republished: no readable stamp, so there is no date to compare against.
    return null;
  }
  return stamp.localDate;
}

/**
 * Persist a republish.
 *
 * @param stamp the report date just republished, and when
 * @param home the Slopweaver home (defaults to the resolved home)
 */
export function writeFrictionReviewPublishStamp({
  stamp,
  home,
}: {
  stamp: FrictionReviewPublishStamp;
  home?: string;
}): void {
  const path = stateHomePaths(home === undefined ? {} : { home }).live.frictionReview.publishedJson;
  writeJsonFile({ path, value: stamp });
}
