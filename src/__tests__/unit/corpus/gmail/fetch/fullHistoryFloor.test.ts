/**
 * `crawlGmail`'s full-history backfill floor: cleared by a finished epoch-wide walk, moved by one the ceiling
 * cut short, held on a narrow, capped or delta pass, and resumed below when one is stored.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { crawlGmail } from "../../../../../corpus/gmail/fetch.js";
import { EPOCH_WINDOW, fakeApi, WINDOW } from "./harness.js";

describe("the full-history backfill floor", () => {
  it("says CLEAR after an epoch-wide walk that finished, so the next --all starts at today again", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a"], next: undefined }] }),
        backfillFloorIso: undefined,
        cap: undefined,
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );

    expect(result.backfillFloor).toStrictEqual({ kind: "clear" });
    expect(result.fullCrawl).toBe(true);
  });

  it("MOVES the floor to the oldest instant it reached when the ceiling cut an epoch-wide walk short", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a"], next: "always-more" }] }),
        backfillFloorIso: undefined,
        cap: undefined,
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );

    expect(result.backfillFloor).toStrictEqual({ floorIso: "2025-08-01T10:00:00.000Z", kind: "move" });
    // The gap now names PROGRESS and the resume, not "narrow the window" — that remedy is for a narrow
    // window, where re-running really does stop in the same place.
    expect(result.gaps[0]).toContain("made progress rather than looping");
    expect(result.gaps[0]).not.toContain("--since/--until");
  });

  it("HOLDS the floor on a narrow window, which has no claim about how far back the mailbox is read", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a"], next: "always-more" }] }),
        backfillFloorIso: undefined,
        cap: undefined,
        epochWide: false,
        onProgress: undefined,
        window: WINDOW,
      }),
    );

    expect(result.backfillFloor).toStrictEqual({ kind: "hold" });
    expect(result.gaps[0]).toContain("--since/--until");
  });

  it("HOLDS the floor on a deliberately capped run, exactly as the history anchor is held", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: ["a", "b"], next: undefined }] }),
        backfillFloorIso: undefined,
        cap: { maxMessages: 1 },
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );

    expect(result.backfillFloor).toStrictEqual({ kind: "hold" });
    expect(result.fullCrawl).toBe(false);
  });

  it("RESUMES below a stored floor, narrowing the query rather than starting again at today", async () => {
    const calls: string[] = [];
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ calls, pages: [{ ids: [], next: undefined }] }),
        backfillFloorIso: "2026-05-14T10:06:14.000Z",
        cap: undefined,
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );

    expect(result.notes[0]).toContain("after:1970-01-01 before:2026-05-14");
    expect(result.notes[1]).toContain("resumed a full-history backfill below 2026-05-14T10:06:14.000Z");
  });

  it("ignores a stored floor on a NARROW window, which is not the backfill it belongs to", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: undefined,
        api: fakeApi({ pages: [{ ids: [], next: undefined }] }),
        backfillFloorIso: "2026-05-14T10:06:14.000Z",
        cap: undefined,
        epochWide: false,
        onProgress: undefined,
        window: WINDOW,
      }),
    );

    expect(result.notes[0]).toContain("after:2026-08-01 before:2026-08-28");
  });

  it("HOLDS the floor on a delta pass, which only ever saw what arrived after its anchor", async () => {
    const result = unwrap(
      await crawlGmail({
        anchor: { anchoredAtIso: "2026-08-20T00:00:00.000Z", fullCrawl: true, historyId: "10" },
        api: fakeApi({ history: [{ historyId: "11", ids: ["a"], next: undefined }] }),
        backfillFloorIso: "2026-05-14T10:06:14.000Z",
        cap: undefined,
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );

    expect(result.lane).toBe("delta");
    expect(result.backfillFloor).toStrictEqual({ kind: "hold" });
  });
});
