import { describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../../lib/result.js";
import { SlackLiveSearchErrors } from "../../../../live/slack/searchErrors.js";
import {
  parseSearchMessages,
  type SlackSearchMessages,
  searchAllPages,
} from "../../../../live/slack/searchMessages.js";

describe("parseSearchMessages", () => {
  it("shapes a match into permalink, conversation, author, instant and text", () => {
    const page = unwrap(
      parseSearchMessages({
        body: {
          messages: {
            matches: [
              {
                channel: { id: "D1", name: "U2" },
                permalink: "https://x/archives/D1/p1",
                text: "review it",
                ts: "1787942086.747699",
                user: "U1",
              },
            ],
            total: 2,
          },
        },
      }),
    );
    expect(page.total).toBe(2);
    expect(page.pageCount).toBe(2);
    expect(page.matches).toEqual([
      {
        channelId: "D1",
        channelName: "U2",
        permalink: "https://x/archives/D1/p1",
        text: "review it",
        ts: "1787942086.747699",
        tsIso: "2026-08-28T18:34:46.000Z",
        userId: "U1",
      },
    ]);
  });

  it("reads an empty result as zero matches rather than a failure", () => {
    const page = unwrap(parseSearchMessages({ body: { messages: { matches: [], total: 0 } } }));
    expect(page.matches).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("fails by name when the body carries no messages object", () => {
    const parsed = parseSearchMessages({ body: { ok: true } });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("SEARCH_UNREADABLE");
  });

  it("reads an unparseable ts as the empty instant rather than an invalid date", () => {
    const page = unwrap(parseSearchMessages({ body: { messages: { matches: [{ ts: "nope" }], total: 1 } } }));
    expect(page.matches[0]!.tsIso).toBe("");
  });
});

describe("parseSearchMessages — page count", () => {
  it("reads Slack's documented paging.pages, and pagination.page_count when that is all it sends", () => {
    const paging = unwrap(
      parseSearchMessages({ body: { messages: { matches: [], paging: { pages: 4 }, total: 350 } } }),
    );
    const pagination = unwrap(
      parseSearchMessages({ body: { messages: { matches: [], pagination: { page_count: 3 }, total: 250 } } }),
    );
    expect([paging.pageCount, pagination.pageCount]).toEqual([4, 3]);
  });

  it("sizes a result from its own total when the body names no page count, so a capped page is never complete", () => {
    const page = unwrap(parseSearchMessages({ body: { messages: { matches: [{ ts: "1" }, { ts: "2" }], total: 5 } } }));
    expect(page.pageCount).toBe(3);
  });
});

/** A search seam answering each 1-based page from a list, recording which pages were asked for. */
function pagedSearch({
  answers,
  asked,
}: {
  answers: readonly Awaited<ReturnType<SlackSearchMessages>>[];
  asked: number[];
}): SlackSearchMessages {
  return ({ page }) => {
    asked.push(page);
    return Promise.resolve(answers[page - 1]!);
  };
}

const match = ({ text }: { text: string }) => ({
  channelId: "C1",
  channelName: "c",
  permalink: text,
  text,
  ts: "1",
  tsIso: "",
  userId: "U1",
});

describe("searchAllPages", () => {
  it("reads every page Slack names and calls the read complete", async () => {
    const asked: number[] = [];
    const read = await searchAllPages({
      count: 1,
      maxPages: 5,
      query: "q",
      search: pagedSearch({
        answers: [
          ok({ matches: [match({ text: "a" })], pageCount: 2, total: 2 }),
          ok({ matches: [match({ text: "b" })], pageCount: 2, total: 2 }),
        ],
        asked,
      }),
    });
    expect(asked).toEqual([1, 2]);
    expect(read.matches.map((m) => m.text)).toEqual(["a", "b"]);
    expect(read.receipt).toEqual({
      complete: true,
      pageCount: 2,
      pagesRead: 2,
      query: "q",
      stoppedBecause: "",
      total: 2,
    });
  });

  it("keeps the pages read before a failure and says why it stopped", async () => {
    const read = await searchAllPages({
      count: 1,
      maxPages: 5,
      query: "q",
      search: pagedSearch({
        answers: [
          ok({ matches: [match({ text: "a" })], pageCount: 3, total: 3 }),
          err(SlackLiveSearchErrors.callFailed({ cause: undefined, message: "ratelimited" })),
        ],
        asked: [],
      }),
    });
    expect(read.matches.map((m) => m.text)).toEqual(["a"]);
    expect(read.receipt.complete).toBe(false);
    expect(read.receipt.stoppedBecause).toBe("slack search could not be read: ratelimited");
  });

  it("stops at the page bound and reports the read incomplete rather than truncating silently", async () => {
    const asked: number[] = [];
    const read = await searchAllPages({
      count: 1,
      maxPages: 1,
      query: "q",
      search: pagedSearch({ answers: [ok({ matches: [match({ text: "a" })], pageCount: 9, total: 9 })], asked }),
    });
    expect(asked).toEqual([1]);
    expect(read.receipt.complete).toBe(false);
    expect(read.receipt.stoppedBecause).toBe("read 1 of 9 pages, the bound");
  });
});
