/**
 * The two history anchors the Gmail DELTA crawl handles, kept apart because they are different facts.
 *
 * The REQUESTED anchor is the one this run resumes from: stored by an earlier run, sent as `startHistoryId`,
 * and — when Google no longer holds history that far back — the floor of the window an expired-cursor
 * recovery crawls instead ({@link recoveryWindow}). The RETURNED anchor is the one Gmail reports on each
 * `history.list` page, which is where the change log stands now and what this run stores for the next one
 * (held by {@link walkHistory}). The returned anchor never falls back to the requested one: storing the cursor
 * a run resumed FROM would make the next run re-ask the same question rather than advance.
 *
 * Split from `./fetch.ts`, which drives both and is at its size ceiling. Effectful only through the injected
 * Gmail seam the walk is handed.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "../../live/gmail/api.js";
import type { GmailError } from "../../live/gmail/errors.js";
import type { ExportWindow } from "../types.js";
import type { GmailHistoryAnchor } from "./historyAnchor.js";

/**
 * Walk `history.list` from an anchor until Gmail stops giving cursors, the caller's message cap is met, or the
 * page ceiling is reached.
 *
 * @param api the injected Gmail seam
 * @param startHistoryId the REQUESTED anchor to resume from, which is never the one returned
 * @param maxPages the runaway-guard page ceiling
 * @param maxMessages the caller's deliberate message cap, `undefined` when the crawl is uncapped
 * @returns the added message ids, whether the page ceiling cut the walk short, and the RETURNED anchor —
 *   `undefined` when no page reported one — or the failure, which the CALLER inspects for an expiry, because
 *   an expired cursor is a recovery rather than a stop
 */
export async function walkHistory({
  api,
  startHistoryId,
  maxPages,
  maxMessages,
}: {
  api: GmailApi;
  startHistoryId: string;
  maxPages: number;
  maxMessages: number | undefined;
}): Promise<
  Result<{ ids: readonly string[]; cappedByPageCeiling: boolean; historyId: string | undefined }, GmailError>
> {
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;
  let held: string | undefined = undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const listed = await api.listHistory({ pageToken, startHistoryId });
    if (listed.isErr()) {
      return err(listed.error);
    }
    ids.push(...listed.value.added.map((change) => change.id));
    const reported = listed.value.historyId;
    // `historyId` is optional on a `history.list` page. A page that omits it says nothing about where the log
    // stands, so it cannot erase the position an earlier page reported; one that carries it moves the anchor.
    if (reported !== undefined) {
      held = reported;
    }
    pageToken = listed.value.nextPageToken;
    if (pageToken === undefined || (maxMessages !== undefined && ids.length >= maxMessages)) {
      return ok({ cappedByPageCeiling: false, historyId: held, ids });
    }
  }
  return ok({ cappedByPageCeiling: true, historyId: held, ids });
}

/**
 * The window an EXPIRED-anchor recovery crawls, which is not the window the run was planned with.
 *
 * The planned window starts at the pooled `tsIso` cursor, and that cursor is not a safe floor for this
 * recovery. Measured on a real run: after a pass that projected nothing, the shared ingest shell advances
 * the pooled cursor to the window's own `until` — by design, so an empty window is not re-scanned — which
 * left the stored cursor at a date EQUAL to the next run's exclusive upper bound and the query
 * `after:<day> before:<the same day>`, matching zero messages. Harmless while the delta lane works, and
 * silent data loss the one time it does not: the fallback would find nothing, re-anchor on the mailbox's
 * current `historyId`, and never ask for the gap again.
 *
 * The anchor's own `anchoredAtIso` is the honest floor — it is when this cursor was last known good, so
 * everything after it is exactly what the expired history would have reported. The wider of the two is
 * taken, so a planned window that already reaches further back is never narrowed. Pure.
 *
 * @param anchor the expired anchor, whose recorded time bounds what must be re-read
 * @param window the window the run was planned with
 * @returns the window to recover over
 */
export function recoveryWindow({ anchor, window }: { anchor: GmailHistoryAnchor; window: ExportWindow }): ExportWindow {
  // A legacy anchor with no recorded time leaves the planned window as the only floor there is.
  if (anchor.anchoredAtIso.length === 0) {
    return window;
  }
  const anchored = anchor.anchoredAtIso.slice(0, 10);
  return { since: anchored < window.since ? anchored : window.since, until: window.until };
}
