/**
 * The `slack unread` thread row for a thread the owner was tagged in, built from raw Slack rows by the real
 * projection. The reply-row cases are `./threadRowOf.test.ts`; the DM case is `./threadRowOfDirect.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { VisibleSlackMessage } from "../../../../../live/slack/types.js";
import { threadRowOf } from "../../../../../live/slack/unreadRows.js";
import { JASPER, MAPS, OWNER, person, ROSA, thread } from "./harness.js";

describe("threadRowOf", () => {
  it("counts a tagged thread the owner never spoke in from the tag, and says it asks the owner", () => {
    const tagged = thread({
      channel: "C0SYNENG12345",
      rows: [
        { text: "deploy freeze this week", thread_ts: "1791000000.000100", ts: "1791000000.000100", user: JASPER },
        { text: "fine by me", thread_ts: "1791000000.000100", ts: "1791000050.000100", user: ROSA },
        {
          text: `<@${OWNER}> can you sign off?`,
          thread_ts: "1791000000.000100",
          ts: "1791000100.000100",
          user: JASPER,
        },
      ],
    });
    const row = threadRowOf({
      maps: MAPS,
      ownerId: OWNER,
      person,
      read: {
        channelId: "C0SYNENG12345",
        channelName: undefined,
        direct: false,
        messages: tagged,
        taggedFromTs: "1791000100.000100",
      },
    });
    expect(row!.kind).toBe("tag");
    expect(row!.forYou).toBe("asks you");
    expect(row!.newReplies).toBe(1);
    expect(row!.where).toBe("a channel");
    expect(row!.line).toBe("@Ada Owner can you sign off?");
  });

  it("says an untagged question from the person the owner's latest word tagged asks the owner — the sign-off case", () => {
    const rows = ({ ownerWord }: { ownerWord: string }): readonly VisibleSlackMessage[] =>
      thread({
        channel: "C0SYNENG12345",
        rows: [
          { text: "local e2es are red", thread_ts: "1791000000.000100", ts: "1791000000.000100", user: JASPER },
          { text: ownerWord, thread_ts: "1791000000.000100", ts: "1791000050.000100", user: OWNER },
          {
            text: "Is it fixed cost or variable cost? happy to approve",
            thread_ts: "1791000000.000100",
            ts: "1791000100.000100",
            user: ROSA,
          },
        ],
      });
    const forYou = ({ ownerWord }: { ownerWord: string }): string =>
      threadRowOf({
        maps: MAPS,
        ownerId: OWNER,
        person,
        read: {
          channelId: "C0SYNENG12345",
          channelName: "dev",
          direct: false,
          messages: rows({ ownerWord }),
          taggedFromTs: undefined,
        },
      })!.forYou;
    expect(forYou({ ownerWord: `<@${ROSA}> can we have that sign off?` })).toBe("asks you");
    expect(forYou({ ownerWord: `<@${JASPER}> can we have that sign off?` })).toBe("fyi");
  });
});
