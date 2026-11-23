/**
 * `slackLink` — Slack permalinks in a row's own prose, and the thread each one names.
 */
import { describe, expect, it } from "vitest";

import { slackLinksIn, threadKeyOf } from "../../lib/slackLink";

describe("slackLinksIn", () => {
  it("finds each permalink once, in order, without the prose punctuation around it", () => {
    const text =
      "Reply in https://acme.slack.com/archives/C1/p1234567890123456? or " +
      "(https://acme.slack.com/archives/C2/p1234567890654321), then https://acme.slack.com/archives/C1/p1234567890123456.";
    expect(slackLinksIn({ text })).toEqual([
      "https://acme.slack.com/archives/C1/p1234567890123456",
      "https://acme.slack.com/archives/C2/p1234567890654321",
    ]);
  });
});

describe("threadKeyOf", () => {
  it("puts the dot back in a top-level message's own ts", () => {
    expect(threadKeyOf({ link: "https://acme.slack.com/archives/C1/p1234567890123456" })).toEqual({
      channel: "C1",
      threadTs: "1234567890.123456",
    });
  });

  it("takes the thread root from thread_ts when the link is a reply", () => {
    const link = "https://acme.slack.com/archives/C1/p1234567899000001?thread_ts=1234567890.123456&cid=C1";
    expect(threadKeyOf({ link })).toEqual({ channel: "C1", threadTs: "1234567890.123456" });
  });

  it("falls back to the message's own ts when the query names no thread_ts", () => {
    const link = "https://acme.slack.com/archives/C1/p1234567890123456?cid=C1";
    expect(threadKeyOf({ link })).toEqual({ channel: "C1", threadTs: "1234567890.123456" });
  });

  it("answers undefined for a string that is not a permalink", () => {
    expect(threadKeyOf({ link: "https://example.com/archives/C1/p1" })).toBe(undefined);
  });
});
