/**
 * The `slack unread` thread row for a reply under a DM message, built from raw Slack rows by the real projection.
 */
import { describe, expect, it } from "vitest";

import { threadRowOf } from "../../../../../live/slack/unreadRows.js";
import { MAPS, OWNER, person, ROSA, thread } from "./harness.js";

describe("threadRowOf", () => {
  it("rows a reply under a DM message as a DM thread, news from its root when the owner never spoke there", () => {
    const dmThread = thread({
      channel: "D0SYNDM12345",
      rows: [
        { text: "can you check the evidence?", thread_ts: "1791000000.000100", ts: "1791000000.000100", user: ROSA },
        { text: "A or B?", thread_ts: "1791000000.000100", ts: "1791000100.000100", user: ROSA },
      ],
    });
    const row = threadRowOf({
      maps: MAPS,
      ownerId: OWNER,
      person,
      read: {
        channelId: "D0SYNDM12345",
        channelName: undefined,
        direct: true,
        messages: dmThread,
        taggedFromTs: "1791000000.000100",
      },
    });
    expect(row!.where).toBe("a DM thread");
    // The root counts: nothing says the owner has seen it, and the row never claims the owner has.
    expect(row!.newReplies).toBe(2);
    expect(row!.line).toBe("A or B?");
    expect(row!.url).toBe("https://acme.slack.com/archives/D0SYNDM12345/p1791000000000100");
  });
});
