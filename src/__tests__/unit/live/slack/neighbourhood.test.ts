import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { slackTsToIso } from "../../../../lib/slackTs.js";
import {
  type ChannelMessageSummary,
  projectChannelHistory,
  selectNeighbourhood,
} from "../../../../live/slack/neighbourhood.js";
import type { SlackThreadTarget } from "../../../../live/slack/permalink.js";

const TARGET: SlackThreadTarget = {
  addressedReply: false,
  addressedTs: "3.000003",
  channel: "C123",
  threadTs: "3.000003",
  workspace: "https://example.slack.com",
};

/** A compact row carrying only what selection reads. */
function summary({ ts }: { ts: string }): ChannelMessageSummary {
  return {
    attachmentCount: 0,
    author: { userId: `U${ts[0]}` },
    blockCount: 0,
    fileCount: 0,
    permalink: `https://example.slack.com/archives/C123/p${ts.replace(".", "")}`,
    relation: "parent",
    replyCount: 0,
    textPreview: `message ${ts}`,
    textWithheldCharacters: 0,
    ts,
    tsIso: slackTsToIso({ ts })!,
  };
}

describe("projectChannelHistory", () => {
  it("returns chronological compact summaries from Slack's newest-first history", () => {
    const longText = `${"x".repeat(250)}\nsecond line`;
    const projected = unwrap(
      projectChannelHistory({
        rawMessages: [
          {
            attachments: [{ fallback: "legacy" }],
            blocks: [{ type: "section" }],
            files: [{ id: "F1", is_external: false }],
            reply_count: 7,
            text: longText,
            ts: "4.000004",
            user: "U4",
          },
          { text: "anchor", ts: "3.000003", user: "U3" },
          {
            subtype: "thread_broadcast",
            text: "broadcast",
            thread_ts: "1.000001",
            ts: "2.000002",
            user: "U2",
          },
        ],
        target: TARGET,
      }),
    );

    expect(projected.map((item) => item.ts)).toEqual(["2.000002", "3.000003", "4.000004"]);
    expect(projected[0]!.permalink).toBe(
      "https://example.slack.com/archives/C123/p2000002?thread_ts=1.000001&cid=C123",
    );
    expect(projected[2]).toEqual({
      attachmentCount: 1,
      author: { userId: "U4" },
      blockCount: 1,
      fileCount: 1,
      permalink: "https://example.slack.com/archives/C123/p4000004",
      relation: "parent",
      replyCount: 7,
      textPreview: "x".repeat(240),
      textWithheldCharacters: 22,
      ts: "4.000004",
      tsIso: "1970-01-01T00:00:04.000Z",
    });
  });

  it("refuses malformed visible content instead of silently shrinking the channel population", () => {
    const projected = projectChannelHistory({
      rawMessages: [{ blocks: null, text: "anchor", ts: "3.000003", user: "U3" }],
      target: TARGET,
    });

    expect(unwrapErr(projected).code).toBe("NON_ARRAY_FIELD");
  });
});

describe("selectNeighbourhood", () => {
  const MESSAGES = ["1.000001", "2.000002", "3.000003", "4.000004", "5.000005"].map((ts) => summary({ ts }));

  it("returns the chosen channel messages on each side and reconciles exact residue", () => {
    const selected = unwrap(selectNeighbourhood({ anchorTs: "3.000003", around: 1, messages: MESSAGES, pageCount: 2 }));

    expect(selected.before.map((item) => item.ts)).toEqual(["2.000002"]);
    expect(selected.after.map((item) => item.ts)).toEqual(["4.000004"]);
    expect(selected.withheldBefore).toBe(1);
    expect(selected.withheldAfter).toBe(1);
    expect(selected.before.length + selected.after.length + selected.withheldBefore + selected.withheldAfter + 1).toBe(
      MESSAGES.length,
    );
    expect(selected.pageCount).toBe(2);
    expect(selected.cursorExhausted).toBe(true);
  });

  it("supports a zero-width channel probe while still stating both sides", () => {
    const selected = unwrap(selectNeighbourhood({ anchorTs: "3.000003", around: 0, messages: MESSAGES, pageCount: 1 }));

    expect(selected.before).toEqual([]);
    expect(selected.after).toEqual([]);
    expect(selected.withheldBefore).toBe(2);
    expect(selected.withheldAfter).toBe(2);
  });

  it("refuses a parent absent from complete history", () => {
    const selected = selectNeighbourhood({
      anchorTs: "9.000009",
      around: 1,
      messages: MESSAGES,
      pageCount: 1,
    });

    expect(unwrapErr(selected).code).toBe("ANCHOR_NOT_FOUND");
  });
});
