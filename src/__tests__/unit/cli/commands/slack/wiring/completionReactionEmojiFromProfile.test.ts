/*
 * `completionReactionEmojiFromProfile`: the completion reaction falls back to white_check_mark with no profile, and
 * is the operator's configured emoji when the profile declares one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { completionReactionEmojiFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("completionReactionEmojiFromProfile", () => {
  it("falls back to white_check_mark when no profile exists", () => {
    const home = freshHome({ prefix: "pr-completion-reaction-" });

    expect(completionReactionEmojiFromProfile({ home })).toBe("white_check_mark");
  });

  it("uses the operator's configured emoji when the profile declares it", () => {
    const home = freshHome({ prefix: "pr-completion-reaction-set-" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { completionReaction: { emoji: "tada" } },
        sources: [],
      }),
      "utf8",
    );

    expect(completionReactionEmojiFromProfile({ home })).toBe("tada");
  });
});
