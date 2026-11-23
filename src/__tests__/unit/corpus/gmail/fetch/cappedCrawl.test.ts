/**
 * `crawlGmail` under a deliberate cap: reads and pages stop at it, it never claims a full crawl, and the delta
 * lane is capped too.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { crawlGmail } from "../../../../../corpus/gmail/fetch.js";
import { EPOCH_WINDOW, fakeApi, WINDOW } from "./harness.js";

describe("a deliberately capped crawl", () => {
  it("reads only up to the cap and says it was capped", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a", "b", "c"], next: undefined }] }),
        cap: { maxMessages: 2 },
        onProgress: undefined,
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a", "b"]);
    expect(result.capped).toBe(true);
  });

  it("stops PAGING once the cap is met, so the bound holds requests down and not only reads", async () => {
    const calls: string[] = [];
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: undefined,
      api: fakeApi({
        calls,
        pages: [
          { ids: ["a", "b"], next: "p2" },
          { ids: ["c"], next: undefined },
        ],
      }),
      cap: { maxMessages: 2 },
      onProgress: undefined,
      epochWide: false,
      window: WINDOW,
    });
    expect(calls.filter((call) => call === "list").length).toBe(1);
  });

  it("never claims a full crawl, however wide the window was", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a", "b"], next: undefined }] }),
        cap: { maxMessages: 1 },
        onProgress: undefined,
        epochWide: true,
        window: EPOCH_WINDOW,
      }),
    );
    expect(result.fullCrawl).toBe(false);
  });

  it("is not capped when the cap was never reached", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a"], next: undefined }] }),
        cap: { maxMessages: 10 },
        onProgress: undefined,
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.capped).toBe(false);
  });

  it("caps the delta lane too", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: { anchoredAtIso: "2026-08-27T00:00:00.000Z", fullCrawl: true, historyId: "9903" },
        api: fakeApi({ history: [{ historyId: "11542", ids: ["a", "b", "c"], next: undefined }] }),
        cap: { maxMessages: 1 },
        onProgress: undefined,
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a"]);
    expect(result.capped).toBe(true);
  });
});
