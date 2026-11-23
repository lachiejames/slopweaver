import { describe, expect, it } from "vitest";

import { botNotInChannelLines } from "../../../../../cli/commands/slack/draftRecordBotRun.js";

describe("botNotInChannelLines — the invite a bot recording refuses with", () => {
  it("names the handle the install's profile declares, as a command the owner can paste", () => {
    const [refusal] = botNotInChannelLines({ botHandles: ["@acme-bot"], channel: "C0PRIV" });
    expect(refusal!.startsWith("acme-bot is not in C0PRIV,")).toBe(true);
    expect(refusal).toContain("`/invite @acme-bot` in that channel");
  });

  it("says the profile declares no handle rather than printing a placeholder command", () => {
    const [refusal] = botNotInChannelLines({ botHandles: [], channel: "C0PRIV" });
    expect(refusal!.startsWith("the bot is not in C0PRIV,")).toBe(true);
    expect(refusal).toContain("profile.json declares no slackBot.selfHandles");
    expect(refusal).not.toContain("/invite");
  });
});
