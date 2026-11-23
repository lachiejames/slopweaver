/*
 * `pollEventTypeFromProfile`: a poll's metadata event type falls back to the stock one with no profile, and is the
 * operator's configured event type when the profile declares one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pollEventTypeFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("pollEventTypeFromProfile", () => {
  it("falls back to the stock event type when no profile exists", () => {
    const home = freshHome({ prefix: "pr-poll-event-" });

    expect(pollEventTypeFromProfile({ home })).toBe("slopweaver_poll_v1");
  });

  it("uses the operator's configured event type when the profile declares it", () => {
    const home = freshHome({ prefix: "pr-poll-event-set-" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { pollChrome: { metadataEventType: "acme_poll_v2" } },
        sources: [],
      }),
      "utf8",
    );

    expect(pollEventTypeFromProfile({ home })).toBe("acme_poll_v2");
  });
});
