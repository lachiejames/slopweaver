import { describe, expect, it } from "vitest";

import { wallRunFromRawMessages } from "../../../../../cli/commands/slack/wallRunRead.js";

const THREAD_TS = "1786600397.866979";
const CHANNEL = "C1";
const WORKSPACE = "https://example.slack.com";
const SELF = "U0SELF";

/** One raw `conversations.replies` message, as Slack returns it. */
function raw({ ts, user }: { ts: string; user: string }): Record<string, unknown> {
  return { text: "irrelevant", ts, user };
}

describe("wallRunFromRawMessages — the pure half of liveWallRun", () => {
  const tomThread: readonly unknown[] = [
    raw({ ts: THREAD_TS, user: "U0TOM" }),
    raw({ ts: "1786600400.000100", user: "U0TOM" }),
    raw({ ts: "1786600500.000200", user: SELF }),
    raw({ ts: "1786600600.000300", user: SELF }),
  ];

  it("counts our two tail messages under the bot actor", () => {
    expect(
      wallRunFromRawMessages({
        actor: "bot",
        channel: CHANNEL,
        rawMessages: tomThread,
        selfUserId: SELF,
        threadTs: THREAD_TS,
        workspaceUrl: WORKSPACE,
      }),
    ).toEqual({
      firstOursPermalink: "https://example.slack.com/archives/C1/p1786600500000200",
      lastOtherTs: "1786600400.000100",
      length: 2,
    });
  });

  it("counts NONE of them under the me actor — the actor reaches existingWallRun from here", () => {
    expect(
      wallRunFromRawMessages({
        actor: "me",
        channel: CHANNEL,
        rawMessages: tomThread,
        selfUserId: SELF,
        threadTs: THREAD_TS,
        workspaceUrl: WORKSPACE,
      }),
    ).toEqual({ lastOtherTs: "1786600400.000100", length: 0 });
  });

  it("DROPS a message that is not an object and one carrying no ts, rather than breaking the run on it", () => {
    const withJunk: readonly unknown[] = [
      raw({ ts: THREAD_TS, user: "U0TOM" }),
      "not an object",
      { text: "no ts at all", user: "U0TOM" },
      raw({ ts: "1786600500.000200", user: SELF }),
    ];

    expect(
      wallRunFromRawMessages({
        actor: "bot",
        channel: CHANNEL,
        rawMessages: withJunk,
        selfUserId: SELF,
        threadTs: THREAD_TS,
        workspaceUrl: WORKSPACE,
      }),
    ).toEqual({
      firstOursPermalink: "https://example.slack.com/archives/C1/p1786600500000200",
      length: 1,
    });
  });

  it("treats every reply as someone else's when auth.test named no user", () => {
    expect(
      wallRunFromRawMessages({
        actor: "bot",
        channel: CHANNEL,
        rawMessages: tomThread,
        selfUserId: undefined,
        threadTs: THREAD_TS,
        workspaceUrl: WORKSPACE,
      }),
    ).toEqual({ lastOtherTs: "1786600600.000300", length: 0 });
  });
});
