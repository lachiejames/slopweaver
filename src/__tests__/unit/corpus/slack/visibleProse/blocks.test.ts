/*
 * How a message's Block Kit blocks become prose: the empty and malformed boundaries, emission order, each block
 * type's readable slots, rich-text paragraphs and table rows.
 */
import { describe, expect, it } from "vitest";

import { flattenSlackVisibleProse } from "../../../../../corpus/slack/visibleProse.js";
import { flatten, maps } from "./fixtures.js";

describe("flattenSlackVisibleProse — boundaries", () => {
  it("returns nothing when raw is absent", () => {
    expect(flattenSlackVisibleProse({ dedupeAgainst: [], maps, raw: undefined })).toStrictEqual([]);
  });

  it("returns nothing when both containers are empty", () => {
    expect(flatten({ raw: { attachments: [], blocks: [] } })).toStrictEqual([]);
  });

  it("returns nothing for a payload whose containers are the wrong shape", () => {
    expect(flatten({ raw: { attachments: "nope", blocks: 7 } })).toStrictEqual([]);
  });

  it("ignores a malformed node without throwing", () => {
    expect(flatten({ raw: { blocks: [null, 3, "text", { type: "section" }] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — ordering", () => {
  it("emits blocks in array order, then attachments in array order", () => {
    const raw = {
      attachments: [{ text: "third from an attachment" }, { text: "fourth from an attachment" }],
      blocks: [
        { text: { text: "first from a block", type: "mrkdwn" }, type: "section" },
        { text: { text: "second from a block", type: "mrkdwn" }, type: "section" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual([
      "first from a block",
      "second from a block",
      "third from an attachment",
      "fourth from an attachment",
    ]);
  });

  it("is independent of key insertion order in the payload", () => {
    // Built by insertion rather than as two literals: the formatter sorts object keys, so a literal pair
    // would be normalised into the same order and the test would assert nothing.
    const sorted: Record<string, unknown> = {};
    sorted["text"] = { text: "the same body either way", type: "mrkdwn" };
    sorted["type"] = "section";
    const reversed: Record<string, unknown> = {};
    reversed["type"] = "section";
    reversed["text"] = { text: "the same body either way", type: "mrkdwn" };
    expect(Object.keys(sorted)).toStrictEqual(["text", "type"]);
    expect(Object.keys(reversed)).toStrictEqual(["type", "text"]);
    // Both sides assert the EXACT value: comparing one invocation against another would pass even if the
    // function returned [] for both, which is the failure mode this test exists to catch.
    expect(flatten({ raw: { blocks: [sorted] } })).toStrictEqual(["the same body either way"]);
    expect(flatten({ raw: { blocks: [reversed] } })).toStrictEqual(["the same body either way"]);
  });
});

describe("flattenSlackVisibleProse — the block grammar", () => {
  it("reads a section's text then its fields", () => {
    const raw = {
      blocks: [
        {
          fields: [
            { text: "field one", type: "mrkdwn" },
            { text: "field two", type: "mrkdwn" },
          ],
          text: { text: "the section body", type: "mrkdwn" },
          type: "section",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["the section body", "field one", "field two"]);
  });

  it("reads a header", () => {
    expect(
      flatten({ raw: { blocks: [{ text: { text: "Release 4.2", type: "plain_text" }, type: "header" }] } }),
    ).toStrictEqual(["Release 4.2"]);
  });

  it("reads context elements in order", () => {
    const raw = {
      blocks: [
        {
          elements: [
            { text: "posted by Ada", type: "mrkdwn" },
            { text: "2 minutes ago", type: "mrkdwn" },
          ],
          type: "context",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["posted by Ada", "2 minutes ago"]);
  });

  it("emits nothing for a divider — it carries no language", () => {
    expect(flatten({ raw: { blocks: [{ type: "divider" }] } })).toStrictEqual([]);
  });

  it("reads an image's title then its alt text", () => {
    const raw = {
      blocks: [
        {
          alt_text: "a burndown chart trending down",
          image_url: "https://x/y.png",
          title: { text: "Sprint burndown", type: "plain_text" },
          type: "image",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["Sprint burndown", "a burndown chart trending down"]);
  });

  it("reads a video's title then its alt text", () => {
    const raw = {
      blocks: [
        { alt_text: "a recorded walkthrough", title: { text: "Demo recording", type: "plain_text" }, type: "video" },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["Demo recording", "a recorded walkthrough"]);
  });

  it("reads an input block's label", () => {
    expect(
      flatten({
        raw: { blocks: [{ label: { text: "How likely are you to recommend us", type: "plain_text" }, type: "input" }] },
      }),
    ).toStrictEqual(["How likely are you to recommend us"]);
  });

  it("keeps a button's label and drops its action id, url and value", () => {
    const raw = {
      blocks: [
        {
          elements: [
            {
              action_id: "approve_deploy_action",
              text: { text: "Approve deploy", type: "plain_text" },
              type: "button",
              url: "https://example.invalid/approve",
              value: "deploy_payload_token",
            },
          ],
          type: "actions",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["Approve deploy"]);
  });

  it("reads a section's accessory button label", () => {
    const raw = {
      blocks: [
        {
          accessory: {
            text: { text: "Open the runbook", type: "plain_text" },
            type: "button",
            url: "https://example.invalid/rb",
          },
          text: { text: "the incident summary", type: "mrkdwn" },
          type: "section",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["the incident summary", "Open the runbook"]);
  });
});

describe("flattenSlackVisibleProse — rich text", () => {
  it("joins one paragraph's inline leaves into a single fragment", () => {
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "deploying ", type: "text" },
                { text: "the release branch", type: "link", url: "https://example.invalid/pr" },
                { text: " now ", type: "text" },
                { name: "rocket", type: "emoji" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["deploying the release branch now :rocket:"]);
  });

  it("uses a bare link's url when it carries no label", () => {
    const raw = {
      blocks: [
        {
          elements: [
            { elements: [{ type: "link", url: "https://example.invalid/runbook" }], type: "rich_text_section" },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["https://example.invalid/runbook"]);
  });

  it("resolves a structured user mention through the same resolver as the message text", () => {
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "hello ", type: "text" },
                { type: "user", user_id: "U1" },
                { text: " world", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["hello @Ada world"]);
  });

  it("dedupes a rich_text block that merely duplicates a message text containing a mention", () => {
    // The regression this guards: nearly every human message also arrives as a rich_text copy of itself. A
    // mention rendered differently here than in the message text would append a mangled duplicate to every
    // such record and double its term frequencies.
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "hello ", type: "text" },
                { type: "user", user_id: "U1" },
                { text: " world", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["hello @Ada world"], maps, raw })).toStrictEqual([]);
  });

  it("resolves a structured channel mention and a broadcast", () => {
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { channel_id: "C1", type: "channel" },
                { text: " ", type: "text" },
                { range: "here", type: "broadcast" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["#releases @here"]);
  });

  it("emits one fragment per paragraph-like child, in order", () => {
    const raw = {
      blocks: [
        {
          elements: [
            { elements: [{ text: "first paragraph", type: "text" }], type: "rich_text_section" },
            {
              elements: [{ elements: [{ text: "a quoted line", type: "text" }], type: "rich_text_section" }],
              type: "rich_text_quote",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["first paragraph", "a quoted line"]);
  });
});

describe("flattenSlackVisibleProse — tables", () => {
  it("emits one fragment per row with cells joined, recursing into each cell's rich text", () => {
    const cell = ({ text }: { text: string }) => ({
      elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    });
    const raw = {
      blocks: [
        {
          rows: [
            [cell({ text: "Service" }), cell({ text: "Owner" })],
            [cell({ text: "billing-api" }), cell({ text: "Grace" })],
          ],
          type: "table",
        },
      ],
    };
    expect(flatten({ raw })).toStrictEqual(["Service | Owner", "billing-api | Grace"]);
  });
});
