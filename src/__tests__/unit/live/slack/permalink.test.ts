import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseSlackThreadPermalink, slackAskPermalink } from "../../../../live/slack/permalink.js";

const WS = "https://example.slack.com";

describe("parseSlackThreadPermalink", () => {
  it("resolves a parent link, reinserting the dot before the last six digits", () => {
    const target = unwrap(parseSlackThreadPermalink({ permalink: `${WS}/archives/C123/p1785114398557099` }));

    expect(target.workspace).toBe(WS);
    expect(target.channel).toBe("C123");
    expect(target.threadTs).toBe("1785114398.557099");
    expect(target.addressedTs).toBe("1785114398.557099");
    expect(target.addressedReply).toBe(false);
  });

  it("resolves a REPLY link to the parent thread, keeping the addressed reply", () => {
    const link = `${WS}/archives/C123/p1785119999123456?thread_ts=1785114398.557099&cid=C123`;
    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));

    // The path names the REPLY; only thread_ts names the root that conversations.replies needs.
    expect(target.threadTs).toBe("1785114398.557099");
    expect(target.addressedTs).toBe("1785119999.123456");
    expect(target.addressedReply).toBe(true);
  });

  it("treats a thread_ts equal to the path timestamp as a parent link", () => {
    const link = `${WS}/archives/C123/p1785114398557099?thread_ts=1785114398.557099`;
    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));

    expect(target.addressedReply).toBe(false);
    expect(target.threadTs).toBe("1785114398.557099");
  });

  it("accepts DM and group-DM conversation ids, not just channels", () => {
    const dm = unwrap(parseSlackThreadPermalink({ permalink: `${WS}/archives/D123/p1785114398557099` }));
    const group = unwrap(parseSlackThreadPermalink({ permalink: `${WS}/archives/G123/p1785114398557099` }));

    expect(dm.channel).toBe("D123");
    expect(group.channel).toBe("G123");
  });

  it("ignores unrelated tracking query parameters", () => {
    const link = `${WS}/archives/C123/p1785114398557099?utm_source=email&cid=C123`;
    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));

    expect(target.threadTs).toBe("1785114398.557099");
  });

  it("refuses a link whose cid disagrees with its path channel", () => {
    const link = `${WS}/archives/C123/p1785114398557099?cid=C999`;
    const result = parseSlackThreadPermalink({ permalink: link });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("disagrees with itself");
  });

  it("refuses a non-Slack host", () => {
    const result = parseSlackThreadPermalink({ permalink: "https://evil.example.com/archives/C1/p1785114398557099" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not a Slack host");
  });

  it("refuses a lookalike host that merely contains slack.com", () => {
    const result = parseSlackThreadPermalink({
      permalink: "https://example.slack.com.evil.test/archives/C1/p1785114398557099",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not a Slack host");
  });

  it("refuses http", () => {
    const result = parseSlackThreadPermalink({ permalink: `http://example.slack.com/archives/C1/p1785114398557099` });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("https");
  });

  it("refuses a malformed timestamp segment", () => {
    const result = parseSlackThreadPermalink({ permalink: `${WS}/archives/C123/p12345` });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not a Slack permalink timestamp");
  });

  it("refuses a channel-only link with no message", () => {
    const result = parseSlackThreadPermalink({ permalink: `${WS}/archives/C123` });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not a Slack message permalink");
  });

  it("refuses a malformed thread_ts rather than guessing", () => {
    const link = `${WS}/archives/C123/p1785114398557099?thread_ts=1785114398`;
    const result = parseSlackThreadPermalink({ permalink: link });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("thread_ts is not a Slack timestamp");
  });

  it("refuses text that is not a URL", () => {
    const result = parseSlackThreadPermalink({ permalink: "what is this thread about" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("not a URL");
  });
});

describe("slackAskPermalink", () => {
  it("builds a top-level ask's permalink with no query string, and round-trips through the parser", () => {
    const askIdentity = { channel: "C123", messageTs: "1785114398.557099", threadTs: "1785114398.557099" };
    const link = slackAskPermalink({ askIdentity, workspaceUrl: WS });

    expect(link).toBe(`${WS}/archives/C123/p1785114398557099`);
    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));
    expect(target.channel).toBe(askIdentity.channel);
    expect(target.addressedTs).toBe(askIdentity.messageTs);
    expect(target.threadTs).toBe(askIdentity.threadTs);
  });

  it("builds a reply ask's permalink with thread_ts and cid, and round-trips its addressed ts and thread root", () => {
    const askIdentity = { channel: "C123", messageTs: "1785119999.123456", threadTs: "1785114398.557099" };
    const link = slackAskPermalink({ askIdentity, workspaceUrl: WS });

    expect(link).toBe(`${WS}/archives/C123/p1785119999123456?thread_ts=1785114398.557099&cid=C123`);
    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));
    expect(target.addressedTs).toBe(askIdentity.messageTs);
    expect(target.threadTs).toBe(askIdentity.threadTs);
    expect(target.addressedReply).toBe(true);
  });

  it("never emits a double slash when the workspace URL already carries a trailing slash, as auth.test returns it", () => {
    const askIdentity = { channel: "C123", messageTs: "1785114398.557099", threadTs: "1785114398.557099" };
    const link = slackAskPermalink({ askIdentity, workspaceUrl: `${WS}/` });

    expect(link).toBe(`${WS}/archives/C123/p1785114398557099`);
  });

  it("accepts a DM ask identity, matching the parser's own D-conversation grammar", () => {
    const askIdentity = { channel: "D123", messageTs: "1785114398.557099", threadTs: "1785114398.557099" };
    const link = slackAskPermalink({ askIdentity, workspaceUrl: WS });

    const target = unwrap(parseSlackThreadPermalink({ permalink: link }));
    expect(target.channel).toBe("D123");
  });
});
