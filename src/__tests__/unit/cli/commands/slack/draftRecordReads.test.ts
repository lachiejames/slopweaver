import { describe, expect, it } from "vitest";

import { conversationInfoOnce, whoAmIOnce } from "../../../../../cli/commands/slack/draftRecordReads.js";

describe("conversationInfoOnce", () => {
  it("reads conversations.info once however many times it is asked, and answers the same response", async () => {
    const calls: string[] = [];
    const readInfo = conversationInfoOnce({
      channel: "C0ISO",
      deps: {
        conversationInfo: async ({ channel, token }) => {
          calls.push(`${channel}:${token}`);
          return { name: "iso-27001", surface: "private-channel" };
        },
      },
      token: "xoxp-test",
    });
    expect(calls).toEqual([]);
    const first = await readInfo();
    const second = await readInfo();
    expect(first).toEqual({ name: "iso-27001", surface: "private-channel" });
    expect(second).toBe(first);
    expect(calls).toEqual(["C0ISO:xoxp-test"]);
  });
});

describe("whoAmIOnce", () => {
  it("reads auth.test once however many times it is asked, and answers the same identity", async () => {
    const calls: string[] = [];
    const readSelf = whoAmIOnce({
      deps: {
        whoAmI: async ({ token }) => {
          calls.push(token);
          return { userId: "U0SYNADAOWN", workspaceUrl: "https://example.slack.com/" };
        },
      },
      token: "xoxp-test",
    });
    expect(calls).toEqual([]);
    const first = await readSelf();
    expect(first.userId).toBe("U0SYNADAOWN");
    expect(await readSelf()).toBe(first);
    expect(calls).toEqual(["xoxp-test"]);
  });
});
