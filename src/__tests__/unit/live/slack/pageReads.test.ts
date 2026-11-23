import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { cursorContradiction, readHistoryPage, readPage } from "../../../../live/slack/pageReads.js";

type HistoryArgs = Parameters<SlackApi["history"]>[0];
type RepliesArgs = Parameters<SlackApi["replies"]>[0];

/** A plain fake history seam recording every call it was given. */
function historySeam(): { api: Pick<SlackApi, "history">; calls: HistoryArgs[] } {
  const calls: HistoryArgs[] = [];
  return {
    api: {
      history: (args) => {
        calls.push(args);
        return Promise.resolve({ hasMore: false, messages: [] });
      },
    },
    calls,
  };
}

/** A plain fake replies seam recording every call it was given. */
function repliesSeam(): { api: Pick<SlackApi, "replies">; calls: RepliesArgs[] } {
  const calls: RepliesArgs[] = [];
  return {
    api: {
      replies: (args) => {
        calls.push(args);
        return Promise.resolve({ hasMore: false, messages: [] });
      },
    },
    calls,
  };
}

const WINDOW = { channel: "C0SYNINCIDENTS", latest: "1790200000.000000", oldest: "0" };

describe("readHistoryPage", () => {
  it("asks for metadata only when the caller opted in", async () => {
    const seam = historySeam();
    unwrap(await readHistoryPage({ ...WINDOW, api: seam.api, cursor: undefined, includeAllMetadata: true }));
    unwrap(await readHistoryPage({ ...WINDOW, api: seam.api, cursor: "c2", includeAllMetadata: false }));
    expect(seam.calls).toEqual([
      { ...WINDOW, includeAllMetadata: true },
      { ...WINDOW, cursor: "c2" },
    ]);
  });

  it("decodes a removed bot as NOT_IN_CHANNEL rather than a generic failure", async () => {
    const api: Pick<SlackApi, "history"> = { history: () => Promise.reject(new Error("not_in_channel")) };
    expect(unwrapErr(await readHistoryPage({ ...WINDOW, api, cursor: undefined })).code).toBe("NOT_IN_CHANNEL");
  });
});

describe("readPage", () => {
  it("reads the whole thread from its root, forwarding metadata only on opt-in", async () => {
    const seam = repliesSeam();
    const thread = { channel: "C0SYNINCIDENTS", oldest: "0", threadTs: "1790130000.000100" };
    unwrap(await readPage({ ...thread, api: seam.api, cursor: undefined, includeAllMetadata: true }));
    unwrap(await readPage({ ...thread, api: seam.api, cursor: undefined }));
    expect(seam.calls).toEqual([
      { channel: "C0SYNINCIDENTS", includeAllMetadata: true, oldest: "0", ts: "1790130000.000100" },
      { channel: "C0SYNINCIDENTS", oldest: "0", ts: "1790130000.000100" },
    ]);
  });

  it("decodes a stale link as THREAD_NOT_FOUND", async () => {
    const api: Pick<SlackApi, "replies"> = { replies: () => Promise.reject(new Error("thread_not_found")) };
    const failure = unwrapErr(
      await readPage({ api, channel: "C0SYNINCIDENTS", cursor: undefined, oldest: "0", threadTs: "1.2" }),
    );
    expect(failure.code).toBe("THREAD_NOT_FOUND");
  });
});

describe("cursorContradiction", () => {
  it("refuses more-to-come with no cursor, and passes a consistent pair", () => {
    expect([
      cursorContradiction({ hasMore: true, nextCursor: "" })!.code,
      cursorContradiction({ hasMore: true, nextCursor: "c2" }),
      cursorContradiction({ hasMore: false, nextCursor: undefined }),
    ]).toEqual(["CURSOR_CONTRADICTION", undefined, undefined]);
  });
});
