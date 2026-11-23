import { describe, expect, it } from "vitest";

import { slackChannelOf } from "../../../workstreams/slackChannel.js";

describe("slackChannelOf", () => {
  it("reads the conversation id out of a message archive link", () => {
    expect(slackChannelOf({ href: "https://acme.slack.com/archives/C0SYNINCIDENTS/p1782000000000100" })).toBe(
      "C0SYNINCIDENTS",
    );
  });

  it("reads the id out of a bare channel archive link and a direct-message one", () => {
    expect(slackChannelOf({ href: "https://acme.slack.com/archives/C0SYNGENERAL" })).toBe("C0SYNGENERAL");
    expect(slackChannelOf({ href: "https://acme.slack.com/archives/D0SYNDIRECT/p1" })).toBe("D0SYNDIRECT");
  });

  it("is undefined for a link that is not a Slack archive address", () => {
    expect(slackChannelOf({ href: "https://example.test/archives/C0SYNINCIDENTS" })).toBeUndefined();
    expect(slackChannelOf({ href: "/queue?row=abc" })).toBeUndefined();
    expect(slackChannelOf({ href: "https://acme.slack.com/messages/C0SYNINCIDENTS" })).toBeUndefined();
  });

  it("refuses a lowercase id, which no Slack conversation carries", () => {
    expect(slackChannelOf({ href: "https://acme.slack.com/archives/c0synincidents" })).toBeUndefined();
  });
});
