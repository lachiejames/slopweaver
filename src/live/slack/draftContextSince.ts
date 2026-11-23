/**
 * What moved in the conversation a parked draft lands in since the draft was written, measured off the read
 * `slack draft context` already makes, so the Queue card can say so quietly above the draft.
 *
 * The rule: when the owner reacts to a draft, the card says whether it is still current, because a draft can be
 * carded hours before it is read and the world moves in between. It surfaces what has happened since the card was
 * created, and stays quiet rather than prominent.
 *
 * One copy of the delta: the classification is the release's own (`releaseWatermark` and `conversationChanges`,
 * `../../outbound/slack/releaseFreshness.ts`), run over the context read's raw rows. Two deliberate differences from the
 * release, both stated rather than discovered:
 *
 * - **Every author counts.** The card passes no posting identity, so a new post by the draft's own bot is a change here
 *   while the release leaves it out. The card can only ever report more than the release, never hide one.
 * - **A channel draft reads one short page.** The context read is the channel's newest few top-level rows, where the
 *   release walks back to the draft's first seen message. So a recorded message older than the page is never judged
 *   removed (it was merely not returned), and the result carries a `limit` saying what the page could not see.
 *
 * The context is read on open and the release reads again just before it sends, so a change in between is the
 * release's to catch. Pure: the rows arrive already read.
 */
import { compareStrings } from "../../lib/compare.js";
import { isRecord } from "../../lib/parsers.js";
import type { ParkedSlackDraft } from "../../outbound/slack/draftRegister.js";
import { conversationChanges, type ReleaseWatermark, releaseWatermark } from "../../outbound/slack/releaseFreshness.js";

/** Which conversation was read: a thread reply's thread, or a top-level post's channel tail. */
export type DraftContextScope = "thread" | "channel";

/** What changed since the draft's own read, or why that could not be measured. Each `ts` list is sorted. */
export type SinceDrafted =
  | {
      readonly kind: "measured";
      /** When the draft was recorded, the instant the card ages "drafted … ago" from. */
      readonly draftedIso: string;
      readonly added: readonly string[];
      readonly edited: readonly string[];
      readonly removed: readonly string[];
      /** What this read could not see, in plain words; empty when the read covers every change since. */
      readonly limits: readonly string[];
    }
  | { readonly kind: "not-measured"; readonly why: string };

/** A channel page that holds only messages newer than the draft: more may have been said before the page starts. */
export const LIMIT_MORE_BEFORE_PAGE =
  "Every message this read returned is newer than the draft, so more may have been said before them.";

/** Recorded messages older than the page: an edit or a removal of one of them would not show here. */
export const LIMIT_OLDER_OUTSIDE_PAGE =
  "Only the newest messages were read, so an edit or removal further back would not show here.";

/** A row recorded before the read kept what it saw: a removed message cannot be measured. */
export const LIMIT_NO_SEEN =
  "This draft was recorded before the read kept what it saw, so a removed message would not show here.";

/** A channel page with no message `ts` at all although Slack said more exist: nothing of the older window is visible. */
export const LIMIT_PAGE_UNDATED =
  "This read returned no dated message although older ones exist, so edits and removals were not checked.";

/** Each raw row's `ts`, when it carries one. */
function rowTimestamps({ rawMessages }: { rawMessages: readonly unknown[] }): readonly string[] {
  const out: string[] = [];
  for (const row of rawMessages) {
    if (isRecord(row) && typeof row["ts"] === "string") {
      out.push(row["ts"]);
    }
  }
  // The same string order the release's own comparisons against `throughTs` use.
  return out.toSorted((left, right) => compareStrings({ a: left, b: right }));
}

/**
 * The watermark narrowed to what one channel page can see, and the limits that narrowing leaves. A thread, or a channel
 * page that is the whole channel, sees everything the release would, so the watermark passes unchanged.
 */
function windowed({
  watermark,
  rawMessages,
  scope,
  hasMore,
}: {
  watermark: ReleaseWatermark;
  rawMessages: readonly unknown[];
  scope: DraftContextScope;
  hasMore: boolean;
}): { readonly watermark: ReleaseWatermark; readonly limits: readonly string[] } {
  if (scope === "thread" || !hasMore) {
    return { limits: [], watermark };
  }
  const stamps = rowTimestamps({ rawMessages });
  const floor = stamps.at(0);
  if (floor === undefined) {
    return { limits: [LIMIT_PAGE_UNDATED], watermark: { ...watermark, seen: [] } };
  }
  const limits: string[] = [];
  if (stamps.every((ts) => ts > watermark.throughTs)) {
    limits.push(LIMIT_MORE_BEFORE_PAGE);
  }
  if (watermark.seen === undefined) {
    return { limits, watermark };
  }
  const inPage = watermark.seen.filter((seen) => seen.ts >= floor);
  if (inPage.length < watermark.seen.length) {
    limits.push(LIMIT_OLDER_OUTSIDE_PAGE);
  }
  return { limits, watermark: { ...watermark, seen: inPage } };
}

/**
 * What changed in the conversation since the draft's own read, judged by the release's classification over the rows
 * the context read returned.
 *
 * @param draft the parked row: its id, recording instant and what its recording read
 * @param rawMessages the context read's raw rows: a thread's every reply, or one channel history page
 * @param scope which conversation those rows are
 * @param hasMore Slack's `has_more` on a channel page: older messages exist than the page holds
 * @returns the change lists with what this read could not see, or why nothing could be measured
 */
export function sinceDrafted({
  draft,
  rawMessages,
  scope,
  hasMore,
}: {
  draft: Pick<ParkedSlackDraft, "id" | "readThrough" | "tsIso">;
  rawMessages: readonly unknown[];
  scope: DraftContextScope;
  hasMore: boolean;
}): SinceDrafted {
  const watermark = releaseWatermark({ draft });
  if (watermark.isErr()) {
    return {
      kind: "not-measured",
      why: `its recording instant ${draft.tsIso} is not a date, so there is no point to measure from`,
    };
  }
  const narrowed = windowed({ hasMore, rawMessages, scope, watermark: watermark.value });
  const limits = [...narrowed.limits];
  if (watermark.value.seen === undefined) {
    limits.push(LIMIT_NO_SEEN);
  }
  const changes = conversationChanges({ rawMessages, self: {}, watermark: narrowed.watermark });
  return {
    added: changes.added,
    draftedIso: draft.tsIso,
    edited: changes.edited,
    kind: "measured",
    limits,
    removed: changes.removed,
  };
}
