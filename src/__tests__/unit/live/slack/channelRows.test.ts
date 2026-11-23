import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { projectChannelRows } from "../../../../live/slack/channelRows.js";

const WORKSPACE = "https://acme.slack.com";

describe("projectChannelRows", () => {
  it("puts a newest-first page oldest first, carrying each row's reply count", () => {
    const rows = unwrap(
      projectChannelRows({
        channel: "C0CHAN",
        rows: [
          { text: "newer", ts: "1790000900.000900", user: "U0B" },
          { reply_count: 4, text: "older", thread_ts: "1790000100.000100", ts: "1790000100.000100", user: "U0A" },
        ],
        workspace: WORKSPACE,
      }),
    );

    expect(rows.map((row) => [row.message.ts, row.message.text, row.replyCount])).toEqual([
      ["1790000100.000100", "older", 4],
      ["1790000900.000900", "newer", 0],
    ]);
  });

  it("reads a broadcast reply under its own thread, so its link names that thread", () => {
    const rows = unwrap(
      projectChannelRows({
        channel: "C0CHAN",
        rows: [{ subtype: "thread_broadcast", text: "also", thread_ts: "1790000100.000100", ts: "1790000500.000500" }],
        workspace: WORKSPACE,
      }),
    );

    expect(rows.at(0)!.message.permalink).toBe(
      "https://acme.slack.com/archives/C0CHAN/p1790000500000500?thread_ts=1790000100.000100&cid=C0CHAN",
    );
  });

  it("reads a reply count that is not a non-negative integer as none", () => {
    const rows = unwrap(
      projectChannelRows({
        channel: "C0CHAN",
        rows: [
          { reply_count: -1, text: "a", ts: "1790000100.000100" },
          { reply_count: 1.5, text: "b", ts: "1790000200.000200" },
          { reply_count: "3", text: "c", ts: "1790000300.000300" },
        ],
        workspace: WORKSPACE,
      }),
    );

    expect(rows.map((row) => row.replyCount)).toEqual([0, 0, 0]);
  });

  it("refuses the whole page when one row cannot be vouched for", () => {
    const refused = unwrapErr(
      projectChannelRows({
        channel: "C0CHAN",
        rows: [{ text: "fine", ts: "1790000100.000100" }, "not a message"],
        workspace: WORKSPACE,
      }),
    );

    expect(refused.code).toBe("NON_OBJECT_MESSAGE_ROW");
  });

  it("answers an empty page with no rows", () => {
    expect(unwrap(projectChannelRows({ channel: "C0CHAN", rows: [], workspace: WORKSPACE }))).toEqual([]);
  });
});
