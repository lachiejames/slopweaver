/**
 * `crawlGmail` with a stored anchor: the delta lane and the anchor it carries forward, the expiry fallback to
 * the window lane in the same run and how wide it reaches, and a delta walk that stops or hits the ceiling.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import { crawlGmail } from "../../../../../corpus/gmail/fetch.js";
import type { GmailApi } from "../../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { EPOCH_WINDOW, fakeApi, WINDOW } from "./harness.js";

const ANCHOR = { anchoredAtIso: "2026-08-27T00:00:00.000Z", fullCrawl: true, historyId: "9903" };

describe("crawlGmail with a stored anchor", () => {
  it("runs the delta lane and anchors on the id the last page reported", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ history: [{ historyId: "11542", ids: ["a"], next: undefined }] }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.lane).toBe("delta");
    expect(result.nextHistoryId).toBe("11542");
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a"]);
  });

  it("keeps an earlier page's returned anchor when the last page reported none", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({
          history: [
            { historyId: "11542", ids: ["a"], next: "p2" },
            { historyId: undefined, ids: ["b"], next: undefined },
          ],
        }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.nextHistoryId).toBe("11542");
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a", "b"]);
  });

  it("establishes no anchor when no page reported one, never re-storing the anchor it resumed from", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ history: [{ historyId: undefined, ids: ["a"], next: undefined }] }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(ANCHOR.historyId).toBe("9903");
    expect(result.nextHistoryId).toBe(undefined);
  });

  it("never claims a full crawl, because it only saw what arrived after its anchor", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ history: [{ historyId: "11542", ids: [], next: undefined }] }),
        epochWide: true,
        window: EPOCH_WINDOW,
      }),
    );
    expect(result.fullCrawl).toBe(false);
  });

  it("falls back to the window lane IN THE SAME RUN when the anchor has expired", async () => {
    const calls: string[] = [];
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({
          calls,
          historyError: GmailErrors.historyExpired({ startHistoryId: "9903" }),
          pages: [{ ids: ["a"], next: undefined }],
        }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.lane).toBe("window");
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a"]);
    expect(calls).toStrictEqual(["history", "profile", "list", "get:a"]);
    expect(result.notes[0]).toContain("had expired");
    expect(result.warnings.some((w) => w.includes("keeps roughly a week"))).toBe(true);
  });

  it("widens the expiry fallback to the anchor's own age, so a degenerate window cannot lose the gap", async () => {
    // Measured live: after a pass that projected nothing, the shared shell advances the pooled cursor to the
    // window's own `until`, leaving `since === until` and a query that matches zero messages. Recovering
    // over that window would find nothing, re-anchor, and never ask for the gap again.
    const queries: string[] = [];
    const api = fakeApi({
      historyError: GmailErrors.historyExpired({ startHistoryId: "9903" }),
      pages: [{ ids: [], next: undefined }],
    });
    const recording: GmailApi = {
      ...api,
      listMessageIds: async ({ query }) => {
        queries.push(query!);
        return ok({ ids: [], nextPageToken: undefined, resultSizeEstimate: 0, threadIds: [] });
      },
    };
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: { anchoredAtIso: "2026-08-20T00:00:00.000Z", fullCrawl: true, historyId: "9903" },
      api: recording,
      cap: undefined,
      epochWide: false,
      onProgress: undefined,
      window: { since: "2026-08-28", until: "2026-08-28" },
    });
    expect(queries).toStrictEqual(["after:2026-08-20 before:2026-08-28"]);
  });

  it("never NARROWS the expiry fallback below the window it was planned with", async () => {
    const queries: string[] = [];
    const api = fakeApi({
      historyError: GmailErrors.historyExpired({ startHistoryId: "9903" }),
      pages: [{ ids: [], next: undefined }],
    });
    const recording: GmailApi = {
      ...api,
      listMessageIds: async ({ query }) => {
        queries.push(query!);
        return ok({ ids: [], nextPageToken: undefined, resultSizeEstimate: 0, threadIds: [] });
      },
    };
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: { anchoredAtIso: "2026-08-20T00:00:00.000Z", fullCrawl: true, historyId: "9903" },
      api: recording,
      cap: undefined,
      epochWide: false,
      onProgress: undefined,
      window: { since: "2026-01-01", until: "2026-08-28" },
    });
    expect(queries).toStrictEqual(["after:2026-01-01 before:2026-08-28"]);
  });

  it("stops on any OTHER history failure rather than quietly re-crawling the window", async () => {
    const result = await crawlGmail({
      backfillFloorIso: undefined,
      anchor: ANCHOR,
      cap: undefined,
      onProgress: undefined,
      api: fakeApi({ historyError: GmailErrors.apiFailed({ message: "revoked" }) }),
      epochWide: false,
      window: WINDOW,
    });
    expect(unwrapErr(result).code).toBe("API_FAILED");
    expect(unwrapErr(result).message).toBe("revoked");
  });

  it("reports a coverage gap when the delta walk hits the page ceiling", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: ANCHOR,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ history: [{ historyId: "1", ids: [], next: "always-more" }] }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.gaps.length).toBe(1);
    expect(result.gaps[0]).toContain("delta");
  });
});
