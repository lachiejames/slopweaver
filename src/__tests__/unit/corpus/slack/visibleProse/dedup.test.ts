/*
 * Markup resolution and dedup: a fragment the message text already carries is dropped, compared on its resolved
 * key rather than how its markup, whitespace, styling or quote and bullet markers happened to be spelled.
 */
import { describe, expect, it } from "vitest";

import { flattenSlackVisibleProse } from "../../../../../corpus/slack/visibleProse.js";
import { flatten, maps } from "./fixtures.js";

describe("flattenSlackVisibleProse — markup resolution and dedup", () => {
  it("resolves markup in an emitted fragment", () => {
    const raw = { blocks: [{ text: { text: "ping <@U1> about <#C1>", type: "mrkdwn" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual(["ping @Ada about #releases"]);
  });

  it("treats raw markup as a duplicate of the already-resolved text it matches", () => {
    const raw = { blocks: [{ text: { text: "ping <@U1> about the release", type: "mrkdwn" }, type: "section" }] };
    const kept = flattenSlackVisibleProse({ dedupeAgainst: ["ping @Ada about the release"], maps, raw });
    expect(kept).toStrictEqual([]);
  });

  it("suppresses a fragment already contained inside a longer assembled part", () => {
    const raw = { blocks: [{ text: { text: "the build finished", type: "mrkdwn" }, type: "section" }] };
    const kept = flattenSlackVisibleProse({
      dedupeAgainst: ["all good — the build finished and the deploy went out"],
      maps,
      raw,
    });
    expect(kept).toStrictEqual([]);
  });

  it("keeps a fragment once when the same prose arrives via a block and an attachment", () => {
    const raw = {
      attachments: [{ text: "the same body twice" }],
      blocks: [{ text: { text: "the same body twice", type: "mrkdwn" }, type: "section" }],
    };
    expect(flatten({ raw })).toStrictEqual(["the same body twice"]);
  });

  it("ignores differing whitespace when comparing, and returns the un-collapsed source text", () => {
    const raw = { blocks: [{ text: { text: "spaced   out    body", type: "mrkdwn" }, type: "section" }] };
    expect(flatten({ raw })).toStrictEqual(["spaced   out    body"]);
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["spaced out body"], maps, raw })).toStrictEqual([]);
  });

  it("is idempotent — re-flattening against its own output recovers nothing new", () => {
    const raw = {
      attachments: [{ text: "the attachment body" }],
      blocks: [{ text: { text: "the block body", type: "mrkdwn" }, type: "section" }],
    };
    const first = flatten({ raw });
    expect(first).toStrictEqual(["the block body", "the attachment body"]);
    expect(flattenSlackVisibleProse({ dedupeAgainst: [...first], maps, raw })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — findings from the adversarial review", () => {
  it("suppresses a nested-markup fragment on re-projection instead of appending it again", () => {
    // The resolver's body excludes `<`, so the INNERMOST reference is the one resolved: `<<@U1>>` becomes
    // `<@Ada>` and no opaque `U1` survives. A second pass would yield the same string, but this test does not
    // rest on that — `key()` normalises any `@…` run to `@`, so both spellings key identically and the
    // fragment cannot escape dedup either way.
    const raw = { blocks: [{ text: { text: "<<@U1>>", type: "mrkdwn" }, type: "section" }] };
    const first = flatten({ raw });
    expect(first).toStrictEqual(["<@Ada>"]);
    expect(flattenSlackVisibleProse({ dedupeAgainst: [...first], maps, raw })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — dedup compares against each seen part separately", () => {
  it("keeps a fragment that only straddles the boundary between two unrelated seen parts", () => {
    // A joined haystack would contain "beta gamma" across the two parts and wrongly drop this fragment.
    const raw = { blocks: [{ text: { text: "beta gamma", type: "mrkdwn" }, type: "section" }] };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["alpha beta", "gamma delta"], maps, raw })).toStrictEqual([
      "beta gamma",
    ]);
  });

  it("stays linear enough that a payload far larger than Slack permits still completes promptly", () => {
    // Slack caps a message at 50 blocks, so this is orders of magnitude beyond any real payload; it exists to
    // pin that dedup does not rebuild a cumulative haystack per fragment.
    const blocks = Array.from({ length: 4000 }, (_, i) => ({
      text: { text: `fragment-${String(i)}-end`, type: "plain_text" },
      type: "section",
    }));
    const kept = flatten({ raw: { blocks } });
    expect(kept).toHaveLength(4000);
    expect(kept[0]).toBe("fragment-0-end");
    expect(kept[3999]).toBe("fragment-3999-end");
  });
});

describe("flattenSlackVisibleProse — dedup ignores how formatting is represented", () => {
  it("dedupes a duplicate block whose message text carried mrkdwn styling markers", () => {
    // Top-level mrkdwn spells bold with asterisks; the structured leaf carries `style: { bold: true }`
    // instead. Comparing the rendered forms would treat Slack's own duplicate as new prose.
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "ping ", type: "text" },
                { style: { bold: true }, type: "user", user_id: "U1" },
                { text: " about the rollout", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["ping *@Ada* about the rollout"], maps, raw })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — mrkdwn structural markers do not defeat dedup", () => {
  it("dedupes a rich_text_quote against a message text using > quote markers", () => {
    const raw = {
      blocks: [
        {
          elements: [{ elements: [{ text: "first\nsecond", type: "text" }], type: "rich_text_quote" }],
          type: "rich_text",
        },
      ],
    };
    expect(flattenSlackVisibleProse({ dedupeAgainst: [">first\n>second"], maps, raw })).toStrictEqual([]);
  });

  it("dedupes a rich_text_list against a message text using bullet markers", () => {
    const raw = {
      blocks: [
        {
          elements: [{ elements: [{ text: "alpha", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
    };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["• alpha"], maps, raw })).toStrictEqual([]);
  });
});
