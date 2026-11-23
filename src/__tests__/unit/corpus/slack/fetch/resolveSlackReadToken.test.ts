/*
 * `resolveSlackReadToken` — which configured token the crawl reads with, and the warning a bot-only install
 * carries. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { resolveSlackReadToken } from "../../../../../corpus/slack/fetch.js";

describe("resolveSlackReadToken", () => {
  it("prefers the user token (full channel visibility), no warning", () => {
    const resolved = resolveSlackReadToken({ botToken: "xoxb-bot", userToken: "xoxp-user" });
    expect(resolved.token).toBe("xoxp-user");
    expect(resolved.warning).toBeUndefined();
  });

  it("falls back to the bot token with a limited-visibility warning", () => {
    const resolved = resolveSlackReadToken({ botToken: "xoxb-bot", userToken: undefined });
    expect(resolved.token).toBe("xoxb-bot");
    expect(resolved.warning).toContain("bot-invited channels");
    expect(resolved.warning).toContain("SLACK_USER_TOKEN");
  });

  it("resolves no token when neither is configured", () => {
    expect(resolveSlackReadToken({ botToken: undefined, userToken: undefined })).toEqual({});
  });
});
