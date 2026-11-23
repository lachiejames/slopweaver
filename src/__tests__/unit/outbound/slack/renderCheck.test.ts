import { describe, expect, it } from "vitest";

import {
  payloadRenderIssues,
  plainMarkupIssues,
  slackPermalink,
  storedRenderIssues,
} from "../../../../outbound/slack/renderCheck.js";
import type { SlackRichMessagePayload } from "../../../../outbound/slack/types.js";

/** One stored `rich_text` block holding one section of the given elements — the shape Slack returns. */
function stored({ elements }: { elements: readonly unknown[] }): readonly unknown[] {
  return [{ elements: [{ elements, type: "rich_text_section" }], type: "rich_text" }];
}

/** One plain text element, the common case. */
function text({ text: value }: { text: string }): unknown {
  return { text: value, type: "text" };
}

describe("storedRenderIssues — the mention that never resolved", () => {
  it("flags a handle Slack stored as plain text, which is the plain-text handle defect", () => {
    const issues = storedRenderIssues({ blocks: stored({ elements: [text({ text: "@jonah-example pls review" })] }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain('"@jonah-example"');
    expect(issues[0]!).toContain("nobody is notified by it");
  });

  it("is CLEAN when Slack resolved it, because a real mention is a user element and not text", () => {
    const issues = storedRenderIssues({
      blocks: stored({ elements: [{ type: "user", user_id: "U0ADA" }, text({ text: " pls review" })] }),
    });

    expect(issues).toEqual([]);
  });

  it("does not flag an email address, where the @ is part of something else", () => {
    expect(storedRenderIssues({ blocks: stored({ elements: [text({ text: "mail someone@example.test" })] }) })).toEqual(
      [],
    );
  });

  it("does not flag a bare @ used as punctuation in prose", () => {
    expect(storedRenderIssues({ blocks: stored({ elements: [text({ text: "meet me @ 3pm" })] }) })).toEqual([]);
  });

  it("does not flag a scoped npm package, which closes a review ask", () => {
    expect(
      storedRenderIssues({ blocks: stored({ elements: [text({ text: "#16330 bump @xmldom/xmldom" })] }) }),
    ).toEqual([]);
  });

  it("does not flag a scoped package followed by prose, which closes an approved text", () => {
    expect(
      storedRenderIssues({
        blocks: stored({ elements: [text({ text: "#17013 bump @clerk/clerk-react, drop stale clerk resolutions" })] }),
      }),
    ).toEqual([]);
  });

  it("reports the WHOLE handle, never a backtracked prefix of one", () => {
    const issues = storedRenderIssues({ blocks: stored({ elements: [text({ text: "ping @xmldom now" })] }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain('"@xmldom"');
  });
});

describe("storedRenderIssues — the styling that stayed literal", () => {
  it("flags asterisks Slack stored as characters, which is the literal-asterisk defect", () => {
    const issues = storedRenderIssues({
      blocks: stored({ elements: [text({ text: "*setTaskUrgency integration test:*" })] }),
    });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("shows its *bold* markers to a reader");
  });

  it("is CLEAN when the emphasis is a real style rather than characters", () => {
    const issues = storedRenderIssues({
      blocks: stored({ elements: [{ style: { bold: true }, text: "really", type: "text" }] }),
    });

    expect(issues).toEqual([]);
  });

  it("flags literal backticks and literal underscore emphasis too", () => {
    const backticks = storedRenderIssues({ blocks: stored({ elements: [text({ text: "run `yarn validate`" })] }) });
    const underscores = storedRenderIssues({ blocks: stored({ elements: [text({ text: "this is _really_ true" })] }) });

    expect(backticks.length).toBe(1);
    expect(underscores.length).toBe(1);
  });

  it("does not flag a snake_case identifier, which is not emphasis", () => {
    expect(storedRenderIssues({ blocks: stored({ elements: [text({ text: "read some_field_name here" })] }) })).toEqual(
      [],
    );
  });

  it("does not flag a lone asterisk with no closing marker", () => {
    expect(storedRenderIssues({ blocks: stored({ elements: [text({ text: "2 * 3 is six" })] }) })).toEqual([]);
  });

  it("leaves a `code`-styled span alone, where punctuation is literal BY REQUEST", () => {
    const issues = storedRenderIssues({
      blocks: stored({ elements: [{ style: { code: true }, text: "*not emphasis*", type: "text" }] }),
    });

    expect(issues).toEqual([]);
  });

  it("leaves a preformatted block alone for the same reason", () => {
    const issues = storedRenderIssues({
      blocks: [
        {
          elements: [{ elements: [text({ text: "*literal* @handle" })], type: "rich_text_preformatted" }],
          type: "rich_text",
        },
      ],
    });

    expect(issues).toEqual([]);
  });
});

describe("storedRenderIssues — the boundaries", () => {
  it("reports nothing for a message with no blocks at all", () => {
    expect(storedRenderIssues({ blocks: [] })).toEqual([]);
  });

  it("reports every defect across every line, not only the first", () => {
    const issues = storedRenderIssues({
      blocks: [
        {
          elements: [
            { elements: [text({ text: "@ada-example" })], type: "rich_text_section" },
            { elements: [text({ text: "*shipped*" })], type: "rich_text_section" },
          ],
          type: "rich_text",
        },
      ],
    });

    expect(issues.length).toBe(2);
  });
});

describe("slackPermalink", () => {
  it("builds the archives link Slack itself uses, with the dot stripped from the ts", () => {
    const link = slackPermalink({
      channel: "C123",
      threadTs: undefined,
      ts: "1788249317.505759",
      workspaceUrl: "https://example.slack.com/",
    });

    expect(link).toBe("https://example.slack.com/archives/C123/p1788249317505759");
  });

  it("tolerates a workspace url with no trailing slash", () => {
    const link = slackPermalink({
      channel: "C123",
      threadTs: undefined,
      ts: "1788249317.505759",
      workspaceUrl: "https://example.slack.com",
    });

    expect(link).toBe("https://example.slack.com/archives/C123/p1788249317505759");
  });

  it("carries the thread query on a REPLY, or the link opens the channel instead of the thread", () => {
    const link = slackPermalink({
      channel: "C123",
      threadTs: "1788232615.356839",
      ts: "1788249317.505759",
      workspaceUrl: "https://example.slack.com",
    });

    expect(link).toBe("https://example.slack.com/archives/C123/p1788249317505759?thread_ts=1788232615.356839&cid=C123");
  });
});

/** The `--body` the as-me lane posted once the linkifier had nested a link inside its label. */
const NESTED_BODY =
  "hey <@U0SYN000004>, bumping <https://github.com/acme/acme-admin/pull/16672|add the Agent CLI package " +
  "<https://github.com/acme/acme-admin/issues/16672|#16672>> in case it got buried";

/** The same message as the author wrote it — the `<url|title #N>` shape `slack voice-rules` prescribes. */
const WELL_FORMED_BODY =
  "hey <@U0SYN000004>, bumping <https://github.com/acme/acme-admin/pull/16672|add the Agent CLI package " +
  "#16672> in case it got buried";

describe("plainMarkupIssues — an angle-bracket link Slack cannot parse", () => {
  it("refuses a link nested inside another link's label", () => {
    const issues = plainMarkupIssues({ text: NESTED_BODY });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('"<https://github.com/acme/acme-admin/pull/16672|add the Agent CLI package <"');
    expect(issues[0]).toContain("never a link inside another link's label");
  });

  it("passes the well-formed <url|title #N> PR mention, mention and all", () => {
    expect(plainMarkupIssues({ text: WELL_FORMED_BODY })).toEqual([]);
  });

  it("refuses a link that never closes on its own line", () => {
    const issues = plainMarkupIssues({ text: "see <https://example.test/a|the thing\nand more" });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('never closes with ">"');
  });

  it("refuses a link that never closes before the end of the text", () => {
    expect(plainMarkupIssues({ text: "see <https://example.test/a|the thing" }).length).toBe(1);
  });

  it("reads prose angle brackets as prose", () => {
    expect(plainMarkupIssues({ text: "x < y and y > z, <3, <br> and a <b>tag</b>" })).toEqual([]);
  });

  it("refuses a nested link under an upper-case scheme too", () => {
    expect(plainMarkupIssues({ text: "<HTTPS://a.test|x <https://b.test|y>>" }).length).toBe(1);
  });

  it("reads a sigil that names no Slack id or keyword as prose", () => {
    expect(plainMarkupIssues({ text: "a<@b, we're at <#3 in the queue, x <!-- note" })).toEqual([]);
  });

  it("keeps reading the next line after an unclosed link", () => {
    expect(
      plainMarkupIssues({ text: "see <https://a.test|one\nand <https://b.test|two\nok <#C0SYN000002>" }).length,
    ).toBe(2);
  });

  it("refuses an unclosed mention, channel or broadcast", () => {
    expect(plainMarkupIssues({ text: "ping <@U0SYN000004 and <#C0SYN000002|eng and <!here" }).length).toBe(3);
  });

  it("refuses a nested link inside a code span too, because Slack parses markup there", () => {
    const body = "grant `<https://a.test/pull/42|add the package <https://a.test/issues/42|#42>>` access";
    expect(plainMarkupIssues({ text: body }).length).toBe(1);
  });

  it("passes a well-formed link whose label carries a backtick", () => {
    expect(plainMarkupIssues({ text: "<https://a.test|the ` key> and `code`" })).toEqual([]);
  });

  it("reports each broken link once, and keeps reading after a well-formed one", () => {
    const body = "<https://a.test|ok> then <https://b.test|bad <https://c.test|x>> then <#C0SYN000002|chan";
    expect(plainMarkupIssues({ text: body }).length).toBe(2);
  });
});

describe("payloadRenderIssues — one pre-wire entry point for both forms", () => {
  it("judges a plain payload by its string", () => {
    const payload = { form: "plain", text: NESTED_BODY, unfurl_links: false, unfurl_media: false } as const;
    expect(payloadRenderIssues({ payload }).length).toBe(1);
  });

  it("judges a rich payload by its blocks", () => {
    const payload: SlackRichMessagePayload = {
      blocks: [
        {
          elements: [{ elements: [{ text: "@ada-example ping", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "",
      unfurl_links: false,
      unfurl_media: false,
    };
    expect(payloadRenderIssues({ payload }).length).toBe(1);
  });
});
