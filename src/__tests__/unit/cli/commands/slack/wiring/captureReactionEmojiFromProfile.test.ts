/*
 * `captureReactionEmojiFromProfile`: the capture reaction falls back to eyes with no profile, and is the operator's
 * configured emoji when the profile declares one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureReactionEmojiFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("captureReactionEmojiFromProfile", () => {
  it("falls back to eyes when no profile exists", () => {
    const home = freshHome({ prefix: "pr-capture-reaction-" });

    expect(captureReactionEmojiFromProfile({ home })).toBe("eyes");
  });

  it("uses the operator's configured emoji when the profile declares it", () => {
    const home = freshHome({ prefix: "pr-capture-reaction-set-" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { captureReaction: { emoji: "raised_hands" } },
        sources: [],
      }),
      "utf8",
    );

    expect(captureReactionEmojiFromProfile({ home })).toBe("raised_hands");
  });
});
