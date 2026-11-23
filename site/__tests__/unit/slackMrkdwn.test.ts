/*
 * Slack's mrkdwn as the preview tokenizes it. The property this file exists for is that a draft is only
 * ever TEXT and typed spans — the preview never builds markup out of a message — so every case below
 * asserts the exact span list, and a construct the tokenizer does not know stays a `text` span.
 */

import { describe, expect, it } from "vitest";

import { type MentionLabels, mrkdwnSpans, readableSpan, segmentSpans } from "../../lib/slackMrkdwn";

/** What the card knows about the people a draft names. */
const LABELS: MentionLabels = {
  labelFor: ({ userId }) => (userId === "U01ARI" ? "Ari" : undefined),
};

/** The spans of one draft, with the labels every case shares. */
const spans = ({ text }: { text: string }) => mrkdwnSpans({ labels: LABELS, text });

describe("segmentSpans", () => {
  it("reads a fenced stretch as one text span exactly as written, no bold or mention inside it", () => {
    expect(segmentSpans({ labels: LABELS, segment: { fenced: true, text: "*:tada:* <@U01ARI>" } })).toEqual([
      { kind: "text", text: "*:tada:* <@U01ARI>" },
    ]);
  });

  it("tokenizes a stretch outside a fence as mrkdwn", () => {
    expect(segmentSpans({ labels: LABELS, segment: { fenced: false, text: "*hi*" } })).toEqual([
      { kind: "bold", text: "hi" },
    ]);
  });

  it("has no spans for an empty fenced stretch", () => {
    expect(segmentSpans({ labels: LABELS, segment: { fenced: true, text: "" } })).toEqual([]);
  });
});

describe("mrkdwnSpans", () => {
  it("leaves a plain message as one text span", () => {
    expect(spans({ text: "the switch-over is ready" })).toEqual([{ kind: "text", text: "the switch-over is ready" }]);
  });

  it("reads the wire's escapes as the characters they stand for, in text, a span, a link and a channel", () => {
    const drawn = spans({
      text: "&gt; a &amp; b *&lt;x&gt;* <https://example.test/?a=1&amp;b=2|A &amp; B> <#C01|ops &amp; infra>",
    }).map((span) => readableSpan({ span }));
    expect(drawn).toEqual([
      { kind: "text", text: "> a & b " },
      { kind: "bold", text: "<x>" },
      { kind: "text", text: " " },
      { href: "https://example.test/?a=1&b=2", kind: "link", label: "A & B" },
      { kind: "text", text: " " },
      { channelId: "C01", kind: "channel", label: "#ops & infra" },
    ]);
  });

  it("reads the escapes in a channel's id, which is also its fallback label", () => {
    expect(spans({ text: "<#C01&amp;X>" }).map((span) => readableSpan({ span }))).toEqual([
      { channelId: "C01&X", kind: "channel", label: "#C01&X" },
    ]);
  });

  it("reads the escapes in a mention's fallback label and id but leaves a roster name as it is", () => {
    const drawn = spans({ text: "<@U01&amp;X> <@U01ARI>" }).map((span) => readableSpan({ span }));
    expect(drawn).toEqual([
      { idLabel: true, kind: "mention", label: "@U01&X", userId: "U01&X" },
      { kind: "text", text: " " },
      { kind: "mention", label: "@Ari", userId: "U01ARI" },
    ]);
  });

  it("leaves a roster name that happens to equal the escaped id exactly as the roster wrote it", () => {
    const named = mrkdwnSpans({ labels: { labelFor: () => "U01&amp;X" }, text: "<@U01&amp;X>" });
    expect(named.map((span) => readableSpan({ span }))).toEqual([
      { kind: "mention", label: "@U01&amp;X", userId: "U01&X" },
    ]);
  });

  it("tokenizes before it unescapes, so an escaped `&lt;` is never read back as a mention", () => {
    expect(spans({ text: "&lt;@U01ARI&gt;" }).map((span) => readableSpan({ span }))).toEqual([
      { kind: "text", text: "<@U01ARI>" },
    ]);
  });

  it("gives an empty draft no spans at all", () => {
    expect(spans({ text: "" })).toEqual([]);
  });

  it("resolves a mention to the label the action recorded", () => {
    expect(spans({ text: "<@U01ARI> ready?" })).toEqual([
      { kind: "mention", label: "@Ari", userId: "U01ARI" },
      { kind: "text", text: " ready?" },
    ]);
  });

  it("falls back to the id when the action named nobody for it, rather than dropping the chip", () => {
    expect(spans({ text: "<@U0SYN1NOBODY>" })).toEqual([
      { idLabel: true, kind: "mention", label: "@U0SYN1NOBODY", userId: "U0SYN1NOBODY" },
    ]);
  });

  it("names the id by the label the action recorded, never by another name the draft wrote beside it", () => {
    expect(spans({ text: "<@U01ARI|Bob>" })).toEqual([{ kind: "mention", label: "@Ari", userId: "U01ARI" }]);
  });

  it("never draws a written label, since Slack names the id and ignores it", () => {
    expect(spans({ text: "<@U0SYN1NOBODY|Bob>" })).toEqual([
      { idLabel: true, kind: "mention", label: "@U0SYN1NOBODY", userId: "U0SYN1NOBODY" },
    ]);
  });

  it("renders a broadcast as the mention of everyone it is", () => {
    expect(spans({ text: "<!here> heads up" })).toEqual([
      { idLabel: true, kind: "mention", label: "@here", userId: "here" },
      { kind: "text", text: " heads up" },
    ]);
  });

  it("draws a bare user-group ping as a group, never its subteam id, the id kept for the hover", () => {
    expect(spans({ text: "<!subteam^S0SYN000012> can you look" })).toEqual([
      { kind: "mention", label: "@a group", userId: "subteam^S0SYN000012" },
      { kind: "text", text: " can you look" },
    ]);
  });

  it("draws a labelled user-group ping by the handle the wire carried, as Slack does", () => {
    expect(spans({ text: "<!subteam^S0SYN000012|@platform>" })).toEqual([
      { handle: "@platform", kind: "mention", label: "@platform", userId: "subteam^S0SYN000012" },
    ]);
  });

  it("reads a group handle's wire escapes exactly once, at the tokenizer, so the render leaves it as it is", () => {
    const drawn = spans({ text: "<!subteam^S0OPS|@ops&amp;amp;infra>" }).map((span) => readableSpan({ span }));
    expect(drawn).toEqual([
      { handle: "@ops&amp;infra", kind: "mention", label: "@ops&amp;infra", userId: "subteam^S0OPS" },
    ]);
  });

  it("renders a channel link by its written name", () => {
    expect(spans({ text: "see <#C01SDLC|delivery>" })).toEqual([
      { kind: "text", text: "see " },
      { channelId: "C01SDLC", kind: "channel", label: "#delivery" },
    ]);
  });

  it("renders a channel link with no written name by its id", () => {
    expect(spans({ text: "<#C01SDLC>" })).toEqual([{ channelId: "C01SDLC", kind: "channel", label: "#C01SDLC" }]);
  });

  it("renders a labelled link, keeping the href separate from the label", () => {
    expect(spans({ text: "<https://github.com/e/p/pull/new|the change>" })).toEqual([
      { href: "https://github.com/e/p/pull/new", kind: "link", label: "the change" },
    ]);
  });

  it("shows a bare link as its URL, the way Slack does", () => {
    expect(spans({ text: "<https://example.test/a>" })).toEqual([
      { href: "https://example.test/a", kind: "link", label: "https://example.test/a" },
    ]);
  });

  it("tokenizes code, bold and italic runs", () => {
    expect(spans({ text: "`yarn lint` is *red* and _slow_" })).toEqual([
      { kind: "code", text: "yarn lint" },
      { kind: "text", text: " is " },
      { kind: "bold", text: "red" },
      { kind: "text", text: " and " },
      { kind: "italic", text: "slow" },
    ]);
  });

  it("leaves an unclosed run as the literal text it is, never guessing at the construct", () => {
    expect(spans({ text: "*not bold" })).toEqual([{ kind: "text", text: "*not bold" }]);
  });

  it("leaves a construct it does not know as text", () => {
    expect(spans({ text: "~struck~" })).toEqual([{ kind: "text", text: "~struck~" }]);
  });

  it("does not let a run cross a line break", () => {
    expect(spans({ text: "*a\nb*" })).toEqual([{ kind: "text", text: "*a\nb*" }]);
  });

  it("leaves an empty entity as the literal angle brackets", () => {
    expect(spans({ text: "<@>" })).toEqual([{ kind: "text", text: "<@>" }]);
  });

  it("leaves a scheme no browser should follow as literal text, never as an href", () => {
    expect(spans({ text: "<javascript:alert(1)|click me>" })).toEqual([
      { kind: "text", text: "<javascript:alert(1)|click me>" },
    ]);
  });

  it("links a mailto, which is a scheme a reader would really follow", () => {
    expect(spans({ text: "<mailto:ops@acme.test|ops>" })).toEqual([
      { href: "mailto:ops@acme.test", kind: "link", label: "ops" },
    ]);
  });

  it("terminates on a run of angle brackets, consuming every character exactly once", () => {
    expect(spans({ text: "<<<<>>>>" })).toEqual([{ kind: "text", text: "<<<<>>>>" }]);
  });
});
