/**
 * `crawlGmail` with no stored anchor: the window lane, the anchor read before listing, paging, the page
 * ceiling's coverage gap, and a lost message or anchor read that leaves the rest of the crawl standing.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";

import { crawlGmail, GMAIL_MAX_PAGES } from "../../../../../corpus/gmail/fetch.js";
import type { GmailApi } from "../../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { EPOCH_WINDOW, fakeApi, WINDOW } from "./harness.js";

describe("crawlGmail with no stored anchor", () => {
  it("runs the window lane and says why", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ pages: [{ ids: ["a", "b"], next: undefined }] }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.lane).toBe("window");
    expect(result.messages.length).toBe(2);
    expect(result.notes[0]).toContain("never been crawled");
  });

  it("reads the anchor BEFORE listing, so mail arriving mid-crawl is not skipped", async () => {
    const calls: string[] = [];
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: undefined,
      cap: undefined,
      onProgress: undefined,
      api: fakeApi({ calls, pages: [{ ids: ["a"], next: undefined }] }),
      epochWide: false,
      window: WINDOW,
    });
    expect(calls).toStrictEqual(["profile", "list", "get:a"]);
  });

  it("carries the pre-crawl history id forward as the next anchor", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ pages: [{ ids: [], next: undefined }], profileHistoryId: "5150" }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.nextHistoryId).toBe("5150");
  });

  it("claims a full crawl only for an epoch-wide window", async () => {
    const api = () => fakeApi({ pages: [{ ids: ["a"], next: undefined }] });
    const narrow = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: api(),
        cap: undefined,
        epochWide: false,
        onProgress: undefined,
        window: WINDOW,
      }),
    );
    const wide = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: api(),
        cap: undefined,
        epochWide: true,
        onProgress: undefined,
        window: EPOCH_WINDOW,
      }),
    );
    expect(narrow.fullCrawl).toBe(false);
    expect(wide.fullCrawl).toBe(true);
  });

  it("walks every page Gmail offers a cursor for", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({
          pages: [
            { ids: ["a"], next: "p2" },
            { ids: ["b"], next: undefined },
          ],
        }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a", "b"]);
    expect(result.gaps).toStrictEqual([]);
  });

  it("reports a coverage gap when the page ceiling cuts the walk short", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ pages: [{ ids: [], next: "always-more" }] }),
        epochWide: true,
        window: EPOCH_WINDOW,
      }),
    );
    expect(result.gaps.length).toBe(1);
    expect(result.gaps[0]).toContain(String(GMAIL_MAX_PAGES));
    // The remedy is the load-bearing half: a held cursor re-asks the same question, so a gap with no way
    // out is a loop rather than a recovery.
    expect(result.gaps[0]).toContain("--since/--until");
    expect(result.fullCrawl).toBe(false);
  });

  it("keeps every other message when one will not read, and names the one it lost", async () => {
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        cap: undefined,
        onProgress: undefined,
        api: fakeApi({ pages: [{ ids: ["a", "boom", "c"], next: undefined }] }),
        epochWide: false,
        window: WINDOW,
      }),
    );
    expect(result.messages.map((m) => m.id)).toStrictEqual(["a", "c"]);
    expect(result.warnings).toStrictEqual(["message boom: not read (unreadable)"]);
  });

  it("still ingests when the anchor read fails, and warns that it could not re-anchor", async () => {
    const api = fakeApi({ pages: [{ ids: ["a"], next: undefined }] });
    const noProfile: GmailApi = { ...api, getProfile: async () => err(GmailErrors.apiFailed({ message: "nope" })) };
    const result = unwrap(
      await crawlGmail({
        backfillFloorIso: undefined,
        anchor: undefined,
        api: noProfile,
        cap: undefined,
        epochWide: false,
        onProgress: undefined,
        window: WINDOW,
      }),
    );
    expect(result.messages.length).toBe(1);
    expect(result.nextHistoryId).toBeUndefined();
    expect(result.warnings[0]).toContain("could not read the mailbox history anchor");
  });
});
