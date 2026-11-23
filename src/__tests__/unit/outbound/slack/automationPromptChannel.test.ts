/**
 * The DOOR half of the automation-prompt rule — an automation's prompt admitted only into the private
 * conversation, and refused with no hatch everywhere else.
 *
 * Every case feeds the refusal something it calls absent, so a `not.toContain` here is evidence rather than
 * silence: the no-hatch assertion is made against a message that CARRIES an override key when there is one
 * to carry, which the voice-rule refusal in the same tree does.
 */
import { describe, expect, it } from "vitest";

import { AUTOMATION_PROMPT_KIND } from "../../../../outbound/artifact/automationPrompt.js";
import {
  automationPromptChannelRefusal,
  isAutomationPrompt,
  noFoldRecurrenceOf,
} from "../../../../outbound/slack/automationPromptChannel.js";

/** The install's configured private prompt conversation. */
const PROMPT_CHANNEL = "D0PROMPT";

/** A team channel — the shape that produced the incident. */
const TEAM_CHANNEL = "Cteamroom";

describe("noFoldRecurrenceOf", () => {
  it("marks only the prompt payload as recurring by design", () => {
    expect(noFoldRecurrenceOf({ formKind: AUTOMATION_PROMPT_KIND })).toBe("automation-prompt");
    expect(noFoldRecurrenceOf({ formKind: "no-fold" })).toBe("once");
  });
});

describe("isAutomationPrompt", () => {
  it("recognises the declared prompt payload", () => {
    expect(isAutomationPrompt({ formKind: AUTOMATION_PROMPT_KIND })).toBe(true);
  });

  it("does not recognise the bare no-fold form the prompt derives into", () => {
    expect(isAutomationPrompt({ formKind: "no-fold" })).toBe(false);
  });
});

describe("automationPromptChannelRefusal", () => {
  it("admits a prompt aimed at the configured private conversation", () => {
    expect(
      automationPromptChannelRefusal({
        channel: PROMPT_CHANNEL,
        formKind: AUTOMATION_PROMPT_KIND,
        promptChannel: PROMPT_CHANNEL,
      }),
    ).toEqual([]);
  });

  it("refuses a prompt aimed at a team channel, naming both conversations", () => {
    const refusal = automationPromptChannelRefusal({
      channel: TEAM_CHANNEL,
      formKind: AUTOMATION_PROMPT_KIND,
      promptChannel: PROMPT_CHANNEL,
    });
    expect(refusal.length).toBe(3);
    expect(refusal[0]).toContain(TEAM_CHANNEL);
    expect(refusal[0]).toContain(PROMPT_CHANNEL);
    expect(refusal[0]).toContain("the bot's own instructions");
  });

  it("names the fix that keeps the card reaching the team, rather than only saying no", () => {
    const refusal = automationPromptChannelRefusal({
      channel: TEAM_CHANNEL,
      formKind: AUTOMATION_PROMPT_KIND,
      promptChannel: PROMPT_CHANNEL,
    });
    expect(refusal[1]).toContain("params.postTo");
    expect(refusal[1]).toContain("the finished card still lands there");
  });

  it("says the absence of a hatch OUT LOUD, because silence reads as a forgotten one", () => {
    const refusal = automationPromptChannelRefusal({
      channel: TEAM_CHANNEL,
      formKind: AUTOMATION_PROMPT_KIND,
      promptChannel: PROMPT_CHANNEL,
    });
    expect(refusal[2]).toContain("deliberately NO escape hatch");
    // The witness the `hold` shape asks for: the refusal that CAN carry an override key does not.
    expect(refusal.join("\n")).not.toContain("SLOPWEAVER_ALLOW_");
  });

  it("refuses fail-closed when the install has configured no private conversation at all", () => {
    const refusal = automationPromptChannelRefusal({
      channel: PROMPT_CHANNEL,
      formKind: AUTOMATION_PROMPT_KIND,
      promptChannel: undefined,
    });
    expect(refusal.length).toBe(1);
    expect(refusal[0]).toContain("slackBot.promptChannel");
    expect(refusal[0]).toContain("NO override");
  });

  it("admits every other form unchanged, so a caller may ask about a card without a branch", () => {
    expect(
      automationPromptChannelRefusal({
        channel: TEAM_CHANNEL,
        formKind: "update",
        promptChannel: PROMPT_CHANNEL,
      }),
    ).toEqual([]);
  });

  it("admits a card into a team channel even when NOTHING is configured, because it is not a prompt", () => {
    expect(
      automationPromptChannelRefusal({
        channel: TEAM_CHANNEL,
        formKind: "alert-summary",
        promptChannel: undefined,
      }),
    ).toEqual([]);
  });
});
