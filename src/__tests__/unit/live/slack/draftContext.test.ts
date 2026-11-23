import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  CHANNEL_CONTEXT_MESSAGES,
  draftContextDocument,
  draftContextMemberIds,
} from "../../../../live/slack/draftContext.js";

const WORKSPACE = "https://acme.slack.com";
const OBSERVED = "2026-09-29T02:20:40.922Z";

/** The parked row: recorded after the thread's last reply, its read keeping every message it saw. */
const DRAFT = {
  id: "sd-0a0b0c0d",
  readThrough: {
    seen: [
      { ts: "1790000000.000100" },
      { ts: "1790000100.000200" },
      { editedTs: "1790000300.000000", ts: "1790000200.000300" },
    ],
    throughTs: "1790000200.000300",
  },
  tsIso: "2026-09-21T14:30:00.000Z",
};

/** The thread a reply draft goes under: the root, then two replies — one with a file, one edited. */
const THREAD_ROWS: readonly unknown[] = [
  { reply_count: 2, text: "the question <@U0ASKED>", ts: "1790000000.000100", user: "U0ROOT" },
  {
    files: [{ id: "F0ONE", mimetype: "image/png", name: "graph.png" }],
    text: "a graph",
    thread_ts: "1790000000.000100",
    ts: "1790000100.000200",
    user: "U0REPLY",
  },
  {
    edited: { ts: "1790000300.000000", user: "U0ROOT" },
    text: "edited answer",
    thread_ts: "1790000000.000100",
    ts: "1790000200.000300",
    user: "U0ROOT",
  },
];

/** One `conversations.history` page, newest first as Slack returns it, with a thread broadcast in it. */
const HISTORY_ROWS: readonly unknown[] = [
  { text: "newest", ts: "1790000900.000900", user: "U0NEW" },
  {
    subtype: "thread_broadcast",
    text: "a broadcast reply",
    thread_ts: "1790000100.000100",
    ts: "1790000500.000500",
    user: "U0CAST",
  },
  { reply_count: 4, text: "oldest", ts: "1790000100.000100", user: "U0OLD" },
];

describe("CHANNEL_CONTEXT_MESSAGES", () => {
  it("is one short page, never a channel walk", () => {
    expect(CHANNEL_CONTEXT_MESSAGES).toBe(6);
  });
});

describe("draftContextDocument", () => {
  it("reads a reply draft's whole thread, root first, linking out to the root", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        hasMore: true,
        draft: DRAFT,
        observedAtIso: OBSERVED,
        rows: THREAD_ROWS,
        threadTs: "1790000000.000100",
        workspace: WORKSPACE,
      }),
    );

    expect(document.kind).toBe("slopweaver.slack.draft-context");
    expect(document.schemaVersion).toBe(2);
    expect(document.id).toBe("sd-0a0b0c0d");
    expect(document.scope).toBe("thread");
    // The thread reads as the recording left it, measured off the same rows the card draws.
    expect(document.sinceDrafted).toEqual({
      added: [],
      draftedIso: "2026-09-21T14:30:00.000Z",
      edited: [],
      kind: "measured",
      limits: [],
      removed: [],
    });
    expect(document.threadTs).toBe("1790000000.000100");
    // A thread is read whole, so nothing is ever withheld — whatever `has_more` the caller passed.
    expect(document.earlierWithheld).toBe(false);
    expect(document.link).toBe("https://acme.slack.com/archives/C0CHAN/p1790000000000100");
    expect(document.messages.map((message) => message.ts)).toEqual([
      "1790000000.000100",
      "1790000100.000200",
      "1790000200.000300",
    ]);
    expect(document.messages.map((message) => message.fileCount)).toEqual([0, 1, 0]);
    expect(document.messages.map((message) => message.edited)).toEqual([false, false, true]);
    // Inside the thread there is nothing further to open, so no reply count is drawn.
    expect(document.messages.map((message) => message.replyCount)).toEqual([0, 0, 0]);
    expect(document.messages.at(0)!.tsIso).toBe("2026-09-21T14:13:20.000Z"); // `slopweaver slack when 1790000000.000100`
  });

  it("reads a top-level draft's channel tail oldest first, each row on its own thread", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        hasMore: true,
        draft: DRAFT,
        observedAtIso: OBSERVED,
        rows: HISTORY_ROWS,
        threadTs: undefined,
        workspace: WORKSPACE,
      }),
    );

    expect(document.scope).toBe("channel");
    expect(document.threadTs).toBe(undefined);
    expect(document.earlierWithheld).toBe(true);
    expect(document.link).toBe("https://acme.slack.com/archives/C0CHAN");
    expect(document.messages.map((message) => message.text)).toEqual(["oldest", "a broadcast reply", "newest"]);
    expect(document.messages.map((message) => message.replyCount)).toEqual([4, 0, 0]);
    expect(document.messages.at(1)!.subtype).toBe("thread_broadcast");
    // A channel page measured against a thread's read: every row is newer, and the page cannot see further back.
    expect(document.sinceDrafted).toEqual({
      added: ["1790000500.000500", "1790000900.000900"],
      draftedIso: "2026-09-21T14:30:00.000Z",
      edited: [],
      kind: "measured",
      limits: ["Only the newest messages were read, so an edit or removal further back would not show here."],
      removed: ["1790000100.000200", "1790000200.000300"],
    });
  });

  it("still draws the conversation when the draft's recording instant cannot be measured from", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        draft: { id: "sd-0a0b0c0d", readThrough: undefined, tsIso: "2026-09-21T14:1xZ" },
        hasMore: false,
        observedAtIso: OBSERVED,
        rows: THREAD_ROWS,
        threadTs: "1790000000.000100",
        workspace: WORKSPACE,
      }),
    );

    expect(document.messages.length).toBe(3);
    expect(document.sinceDrafted).toEqual({
      kind: "not-measured",
      why: "its recording instant 2026-09-21T14:1xZ is not a date, so there is no point to measure from",
    });
  });

  it("says nothing older exists when the page was the whole channel", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        hasMore: false,
        draft: DRAFT,
        observedAtIso: OBSERVED,
        rows: HISTORY_ROWS,
        threadTs: undefined,
        workspace: WORKSPACE,
      }),
    );

    expect(document.earlierWithheld).toBe(false);
  });

  it("draws an empty channel as an empty conversation, not a failure", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        hasMore: false,
        draft: DRAFT,
        observedAtIso: OBSERVED,
        rows: [],
        threadTs: undefined,
        workspace: WORKSPACE,
      }),
    );

    expect(document.messages).toEqual([]);
  });

  it("refuses a thread whose root the read never returned, rather than drawing half of it", () => {
    const document = draftContextDocument({
      channel: "C0CHAN",
      hasMore: false,
      draft: DRAFT,
      observedAtIso: OBSERVED,
      rows: THREAD_ROWS.slice(1),
      threadTs: "1790000000.000100",
      workspace: WORKSPACE,
    });

    expect(unwrapErr(document).code).toBe("MISSING_PARENT");
  });
});

describe("draftContextMemberIds", () => {
  it("collects every author, mrkdwn mention and Block Kit user element once, first-seen order", () => {
    const document = unwrap(
      draftContextDocument({
        channel: "C0CHAN",
        hasMore: false,
        draft: DRAFT,
        observedAtIso: OBSERVED,
        rows: [
          ...THREAD_ROWS,
          {
            attachments: [{ blocks: [{ elements: [{ type: "user", user_id: "U0SYNATTACHED" }], type: "rich_text" }] }],
            blocks: [
              {
                elements: [{ elements: [{ type: "user", user_id: "U0BLOCK" }], type: "rich_text_section" }],
                type: "rich_text",
              },
            ],
            text: "cc <@U0ROOT> <@W0SYNLABELLED|someone>",
            thread_ts: "1790000000.000100",
            ts: "1790000400.000400",
            user: "U0REPLY",
          },
        ],
        threadTs: "1790000000.000100",
        workspace: WORKSPACE,
      }),
    );

    expect(draftContextMemberIds({ messages: document.messages })).toEqual([
      "U0ROOT",
      "U0ASKED",
      "U0REPLY",
      "W0SYNLABELLED",
      "U0BLOCK",
      "U0SYNATTACHED",
    ]);
  });

  it("names nobody in an empty conversation", () => {
    expect(draftContextMemberIds({ messages: [] })).toEqual([]);
  });
});
