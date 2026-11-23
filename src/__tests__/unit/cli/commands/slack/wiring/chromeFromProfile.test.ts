/*
 * `chromeFromProfile`: a card's chrome falls back to neutral defaults with no profile, and carries the operator's
 * configured chrome when the profile declares it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chromeFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("chromeFromProfile", () => {
  it("falls back to neutral defaults when no profile exists", () => {
    const home = freshHome({ prefix: "pr5-chrome-" });

    const chrome = chromeFromProfile({ home });

    expect(chrome.bannerColor).toBe("#8B5CF6");
    expect(chrome.detailLabel).toBe("*Details*");
    expect(chrome.metadataEventType).toBe("slopweaver_card_v1");
  });

  it("uses the operator's configured chrome when the profile declares it", () => {
    const home = freshHome({ prefix: "pr5-chrome-set-" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: {
          cardChrome: {
            authorEmoji: ":sparkles:",
            authorLabel: "some-bot",
            bannerColor: "#ABCDEF",
            detailLabel: "*More*",
            metadataEventType: "custom_v9",
          },
          ownerUserId: "U_fake_owner",
        },
        sources: [],
      }),
      "utf8",
    );

    const chrome = chromeFromProfile({ home });

    expect(chrome).toEqual({
      authorEmoji: ":sparkles:",
      authorLabel: "some-bot",
      bannerColor: "#ABCDEF",
      detailLabel: "*More*",
      metadataEventType: "custom_v9",
    });
  });
});
