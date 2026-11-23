import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { readAlertWindow } from "../../../../live/slack/alertSource.js";

/** One page the fake seam will serve. */
interface FakePage {
  readonly messages: readonly unknown[];
  readonly nextCursor?: string;
}

/**
 * A plain fake `history` seam serving the given pages in order, recording the arguments it was called with.
 *
 * A hand-written function satisfying the seam's own type — no mock, no spy, no module replacement.
 */
function fakeHistory({ pages }: { pages: readonly FakePage[] }): Pick<SlackApi, "history"> & {
  readonly calls: readonly { cursor?: string; oldest: string; latest: string }[];
} {
  const calls: { cursor?: string; oldest: string; latest: string }[] = [];
  let call = 0;
  return {
    calls,
    history: (args) => {
      calls.push({
        latest: args.latest,
        oldest: args.oldest,
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
      });
      const page = pages[call]!;
      call += 1;
      return Promise.resolve(page);
    },
  };
}

describe("readAlertWindow — complete, or nothing at all", () => {
  it("returns every message across every page, in page order", async () => {
    const api = fakeHistory({
      pages: [{ messages: [{ text: "a" }, { text: "b" }], nextCursor: "p2" }, { messages: [{ text: "c" }] }],
    });
    const read = unwrap(await readAlertWindow({ api, channel: "D1", oldest: "100" }));

    expect(read.messages).toEqual([{ text: "a" }, { text: "b" }, { text: "c" }]);
    expect(read.pageCount).toBe(2);
    expect(read.cursorExhausted).toBe(true);
  });

  it("passes the window's start as `oldest` and the widest sentinel as `latest`", async () => {
    const api = fakeHistory({ pages: [{ messages: [] }] });
    await readAlertWindow({ api, channel: "D1", oldest: "1799996400" });

    expect(api.calls).toEqual([{ latest: "9999999999", oldest: "1799996400" }]);
  });

  it("follows the cursor it was handed on the previous page", async () => {
    const api = fakeHistory({ pages: [{ messages: [{ text: "a" }], nextCursor: "p2" }, { messages: [] }] });
    await readAlertWindow({ api, channel: "D1", oldest: "100" });

    expect(api.calls.map((call) => call.cursor)).toEqual([undefined, "p2"]);
  });

  it("keeps paging THROUGH an empty page that still carries a cursor", async () => {
    // The reason this does not reuse `collectCursorPages`: that loop breaks when a page appends nothing, before
    // it looks at the cursor. Slack documents an empty Conversations page carrying `next_cursor`, so that loop
    // would return the first message and report it as the whole window.
    const api = fakeHistory({
      pages: [
        { messages: [{ text: "a" }], nextCursor: "p2" },
        { messages: [], nextCursor: "p3" },
        { messages: [{ text: "b" }] },
      ],
    });
    const read = unwrap(await readAlertWindow({ api, channel: "D1", oldest: "100" }));

    expect(read.messages).toEqual([{ text: "a" }, { text: "b" }]);
    expect(read.pageCount).toBe(3);
  });

  it("reports progress per page, so a long read is not silent", async () => {
    const seen: { pageCount: number; messageCount: number }[] = [];
    const api = fakeHistory({
      pages: [{ messages: [{ text: "a" }], nextCursor: "p2" }, { messages: [{ text: "b" }] }],
    });
    await readAlertWindow({ api, channel: "D1", oldest: "100", onPage: (progress) => seen.push(progress) });

    expect(seen).toEqual([
      { messageCount: 1, pageCount: 1 },
      { messageCount: 2, pageCount: 2 },
    ]);
  });

  it("REFUSES a repeated cursor rather than looping or returning the prefix", async () => {
    const api = fakeHistory({
      pages: [
        { messages: [{ text: "a" }], nextCursor: "same" },
        { messages: [{ text: "b" }], nextCursor: "same" },
      ],
    });
    const read = await readAlertWindow({ api, channel: "D1", oldest: "100" });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("Slack repeated a pagination cursor on D1");
  });

  it("REFUSES past the page ceiling, naming the fix rather than returning an unknown fraction", async () => {
    // Every page carries a DISTINCT cursor, so the repeated-cursor guard cannot fire and the ceiling is the only
    // thing that stops this. Sixty pages is what it stops at, and the message says what to do instead.
    let page = 0;
    const forever: Pick<SlackApi, "history"> = {
      history: () => {
        page += 1;
        return Promise.resolve({ messages: [{ text: "a" }], nextCursor: `page-${String(page)}` });
      },
    };
    const read = await readAlertWindow({ api: forever, channel: "D1", oldest: "100" });

    expect(read.isErr()).toBe(true);
    expect(page).toBe(60);
    expect(unwrapErr(read).message).toContain("carries more than 12000 messages in this window");
    expect(unwrapErr(read).message).toContain("Narrow --window");
  });

  it("turns a thrown `channel_not_found` into the two causes it actually has", async () => {
    const throwing: Pick<SlackApi, "history"> = {
      history: () => Promise.reject(new Error("An API error occurred: channel_not_found")),
    };
    const read = await readAlertWindow({ api: throwing, channel: "C9", oldest: "100" });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("no channel C9");
    expect(unwrapErr(read).message).toContain("a private channel is channel_not_found rather than a permission error");
  });

  it("names the invite when the token's identity is not in the channel", async () => {
    const throwing: Pick<SlackApi, "history"> = {
      history: () => Promise.reject(new Error("An API error occurred: not_in_channel")),
    };
    const read = await readAlertWindow({ api: throwing, channel: "C9", oldest: "100" });

    expect(unwrapErr(read).message).toBe("the token's identity is not in C9; invite it, then re-run");
  });

  it("surfaces any other thrown failure with the channel and the reason", async () => {
    const throwing: Pick<SlackApi, "history"> = {
      history: () => Promise.reject(new Error("ratelimited")),
    };
    const read = await readAlertWindow({ api: throwing, channel: "C9", oldest: "100" });

    expect(unwrapErr(read).message).toBe("reading C9 failed: ratelimited");
  });

  it("returns an empty window as a SUCCESS, because quiet is a result", async () => {
    const read = unwrap(
      await readAlertWindow({ api: fakeHistory({ pages: [{ messages: [] }] }), channel: "D1", oldest: "1" }),
    );

    expect(read.messages).toEqual([]);
    expect(read.pageCount).toBe(1);
  });
});
