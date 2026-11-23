/*
 * Slack's wire escaping undone, so a card reads what Slack draws (a card once read
 * `&amp;`).
 */

import { describe, expect, it } from "vitest";

import { slackPlainWords, slackUnescaped } from "../../lib/slackEscapes";

describe("slackUnescaped", () => {
  it("reads each of Slack's three escapes as the character it stands for, once", () => {
    expect(slackUnescaped({ text: "a &amp; b &lt;c&gt; &amp;amp;" })).toBe("a & b <c> &amp;");
  });

  it("leaves an ampersand that is no Slack escape alone", () => {
    expect(slackUnescaped({ text: "&quot; & &nbsp;" })).toBe("&quot; & &nbsp;");
  });
});

describe("slackPlainWords", () => {
  it("draws a labelled link by its label and a bare one by its address", () => {
    expect(slackPlainWords({ text: "<https://a.example|the page> and <mailto:x@y.example>" })).toBe(
      "the page and mailto:x@y.example",
    );
  });

  it("draws a link with an empty label by its address", () => {
    expect(slackPlainWords({ text: "<https://a.example| >" })).toBe("https://a.example");
  });

  it("unescapes AFTER reading links, so an escaped bracket is never a link", () => {
    expect(
      slackPlainWords({ text: "&lt;https://a.example|b&gt; &amp; <https://c.example?d=1&amp;e=2|f &amp; g>" }),
    ).toBe("<https://a.example|b> & f & g");
  });

  it("draws a channel by its name, and one Slack sent unnamed as a channel, never its C… id", () => {
    expect(slackPlainWords({ text: "see <#C0ENG|dev> and <#C0OPS|> or <#C0DEV>" })).toBe(
      "see #dev and a channel or a channel",
    );
  });

  it("draws a link of any scheme by its label, unescaping its label once", () => {
    expect(
      slackPlainWords({ text: "<tel:+61400000000|call me> or <slack://channel?team=T1&amp;amp;id=C1|open &amp; go>" }),
    ).toBe("call me or open & go");
  });

  it("draws a date by its fallback, else as a date", () => {
    expect(
      slackPlainWords({ text: "on <!date^1790566514^{date_short}|the fallback text> or <!date^1790566514^{date}>" }),
    ).toBe("on the fallback text or a date");
  });

  it("draws a link a truncation cut off before its > by its address", () => {
    expect(slackPlainWords({ text: "merged in <https://github.com/o/r/pull/1…" })).toBe(
      "merged in https://github.com/o/r/pull/1…",
    );
  });

  it("reads a cut token with no label that is no link as the cut, never its surviving half", () => {
    expect([
      slackPlainWords({ text: "look p<!subteam…" }),
      slackPlainWords({ text: "look p<!ch…" }),
      slackPlainWords({ text: "look p<#C0E…" }),
      slackPlainWords({ text: "look p<#C0ENG|en…" }),
    ]).toEqual(["look p…", "look p…", "look p…", "look p#en…"]);
  });

  it("drops an escape a cut split in two, and keeps a whole one before the cut", () => {
    expect([
      slackPlainWords({ text: "p&amp;am…" }),
      slackPlainWords({ text: "p&am…" }),
      slackPlainWords({ text: "p&l…" }),
      slackPlainWords({ text: "p&…" }),
      slackPlainWords({ text: "p&amp;…" }),
      slackPlainWords({ text: "<https://x.example|a &am…" }),
    ]).toEqual(["p&am…", "p…", "p…", "p…", "p&…", "a …"]);
  });

  it("is the text unchanged when it carries neither", () => {
    expect(slackPlainWords({ text: "" })).toBe("");
  });
});
