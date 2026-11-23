import { describe, expect, it } from "vitest";
import {
  LIMIT_MORE_BEFORE_PAGE,
  LIMIT_NO_SEEN,
  LIMIT_OLDER_OUTSIDE_PAGE,
  LIMIT_PAGE_UNDATED,
  sinceDrafted,
} from "../../../../live/slack/draftContextSince.js";

/** The thread a reply draft goes under, as the recording read it: the root, a reply, and an edited reply. */
const THREAD_AT_RECORDING: readonly unknown[] = [
  { text: "the question", ts: "1790000000.000100", user: "U0ROOT" },
  { text: "a graph", thread_ts: "1790000000.000100", ts: "1790000100.000200", user: "U0REPLY" },
  {
    edited: { ts: "1790000300.000000", user: "U0ROOT" },
    text: "edited answer",
    thread_ts: "1790000000.000100",
    ts: "1790000200.000300",
    user: "U0ROOT",
  },
];

/** What that recording kept: the newest `ts` and every message with its edit stamp. */
const THREAD_READ_THROUGH = {
  seen: [
    { ts: "1790000000.000100" },
    { ts: "1790000100.000200" },
    { editedTs: "1790000300.000000", ts: "1790000200.000300" },
  ],
  throughTs: "1790000200.000300",
};

/** One channel history page, newest first as Slack returns it. */
const CHANNEL_PAGE: readonly unknown[] = [
  { text: "newest", ts: "1790000900.000900", user: "U0NEW" },
  { text: "middle", ts: "1790000500.000500", user: "U0MID" },
  { text: "oldest", ts: "1790000100.000100", user: "U0OLD" },
];

const DRAFTED = "2026-09-21T14:30:00.000Z";

describe("sinceDrafted", () => {
  it("says nothing moved, with no limits, when the whole thread reads as the recording left it", () => {
    const since = sinceDrafted({
      draft: { id: "sd-0a0b0c0d", readThrough: THREAD_READ_THROUGH, tsIso: DRAFTED },
      hasMore: false,
      rawMessages: THREAD_AT_RECORDING,
      scope: "thread",
    });

    expect(since).toEqual({
      added: [],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [],
      removed: [],
    });
  });

  it("names a new reply, an edit and a removal in a thread, counting the bot's own new post too", () => {
    const now: readonly unknown[] = [
      THREAD_AT_RECORDING[0],
      {
        edited: { ts: "1790000600.000000", user: "U0ROOT" },
        text: "edited again",
        thread_ts: "1790000000.000100",
        ts: "1790000200.000300",
        user: "U0ROOT",
      },
      { bot_id: "B0OURS", text: "a bot follow-up", thread_ts: "1790000000.000100", ts: "1790000400.000400" },
    ];
    const since = sinceDrafted({
      draft: { id: "sd-0a0b0c0d", readThrough: THREAD_READ_THROUGH, tsIso: DRAFTED },
      hasMore: false,
      rawMessages: now,
      scope: "thread",
    });

    expect(since).toEqual({
      added: ["1790000400.000400"],
      draftedIso: DRAFTED,
      edited: ["1790000200.000300"],
      kind: "measured",
      limits: [],
      removed: ["1790000100.000200"],
    });
  });

  it("never calls a recorded message older than a channel page removed, and says the page could not see it", () => {
    const since = sinceDrafted({
      draft: {
        id: "sd-0a0b0c0d",
        readThrough: {
          seen: [{ ts: "1790000050.000050" }, { ts: "1790000100.000100" }, { ts: "1790000500.000500" }],
          throughTs: "1790000500.000500",
        },
        tsIso: DRAFTED,
      },
      hasMore: true,
      rawMessages: CHANNEL_PAGE,
      scope: "channel",
    });

    expect(since).toEqual({
      added: ["1790000900.000900"],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [LIMIT_OLDER_OUTSIDE_PAGE],
      removed: [],
    });
  });

  it("still counts a recorded message missing from INSIDE the page as removed", () => {
    const since = sinceDrafted({
      draft: {
        id: "sd-0a0b0c0d",
        readThrough: {
          seen: [{ ts: "1790000100.000100" }, { ts: "1790000300.000300" }, { ts: "1790000500.000500" }],
          throughTs: "1790000500.000500",
        },
        tsIso: DRAFTED,
      },
      hasMore: true,
      rawMessages: CHANNEL_PAGE,
      scope: "channel",
    });

    expect(since).toEqual({
      added: ["1790000900.000900"],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [],
      removed: ["1790000300.000300"],
    });
  });

  it("says more may sit before the page when every message it returned is newer than the draft", () => {
    const since = sinceDrafted({
      draft: {
        id: "sd-0a0b0c0d",
        readThrough: { seen: [{ ts: "1790000050.000050" }], throughTs: "1790000050.000050" },
        tsIso: DRAFTED,
      },
      hasMore: true,
      rawMessages: CHANNEL_PAGE,
      scope: "channel",
    });

    expect(since).toEqual({
      added: ["1790000100.000100", "1790000500.000500", "1790000900.000900"],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [LIMIT_MORE_BEFORE_PAGE, LIMIT_OLDER_OUTSIDE_PAGE],
      removed: [],
    });
  });

  it("judges a removal anywhere when the page was the whole channel", () => {
    const since = sinceDrafted({
      draft: {
        id: "sd-0a0b0c0d",
        readThrough: { seen: [{ ts: "1790000050.000050" }], throughTs: "1790000050.000050" },
        tsIso: DRAFTED,
      },
      hasMore: false,
      rawMessages: CHANNEL_PAGE,
      scope: "channel",
    });

    expect(since).toEqual({
      added: ["1790000100.000100", "1790000500.000500", "1790000900.000900"],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [],
      removed: ["1790000050.000050"],
    });
  });

  it("checks no edit or removal on an undated page that says older messages exist", () => {
    const since = sinceDrafted({
      draft: {
        id: "sd-0a0b0c0d",
        readThrough: { seen: [{ ts: "1790000050.000050" }], throughTs: "1790000050.000050" },
        tsIso: DRAFTED,
      },
      hasMore: true,
      rawMessages: [],
      scope: "channel",
    });

    expect(since).toEqual({
      added: [],
      draftedIso: DRAFTED,
      edited: [],
      kind: "measured",
      limits: [LIMIT_PAGE_UNDATED],
      removed: [],
    });
  });

  it("measures a row recorded before the read kept what it saw from its recording instant, and says removals cannot show", () => {
    // `slopweaver slack when 1790000100.000000` derives this instant.
    const since = sinceDrafted({
      draft: { id: "sd-0a0b0c0d", readThrough: undefined, tsIso: "2026-09-21T14:15:00.000Z" },
      hasMore: false,
      rawMessages: THREAD_AT_RECORDING,
      scope: "thread",
    });

    expect(since).toEqual({
      added: ["1790000100.000200", "1790000200.000300"],
      draftedIso: "2026-09-21T14:15:00.000Z",
      edited: [],
      kind: "measured",
      limits: [LIMIT_NO_SEEN],
      removed: [],
    });
  });

  it("is not measured when the recording instant is not a date and nothing else marks the draft's read", () => {
    const since = sinceDrafted({
      draft: { id: "sd-0a0b0c0d", readThrough: undefined, tsIso: "2026-09-21T14:1xZ" },
      hasMore: false,
      rawMessages: THREAD_AT_RECORDING,
      scope: "thread",
    });

    expect(since).toEqual({
      kind: "not-measured",
      why: "its recording instant 2026-09-21T14:1xZ is not a date, so there is no point to measure from",
    });
  });
});
