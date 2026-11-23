/*
 * Mentions: a user, channel or usergroup renders by name or generically and never leaks its raw id, a mention with
 * no usable id adds nothing, and a duplicate differing only in how its mention rendered is still deduped.
 */
import { describe, expect, it } from "vitest";

import { flattenSlackVisibleProse } from "../../../../../corpus/slack/visibleProse.js";
import { flatten, maps } from "./fixtures.js";

describe("flattenSlackVisibleProse — a mention never leaks an id, however it renders", () => {
  const usergroupBlock = {
    blocks: [
      {
        elements: [
          {
            elements: [
              { text: "paging ", type: "text" },
              { type: "usergroup", usergroup_id: "S_EXAMPLE_GROUP" },
            ],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      },
    ],
  };

  it("renders a usergroup generically and never emits its raw id", () => {
    const kept = flatten({ raw: usergroupBlock });
    expect(kept).toStrictEqual(["paging @group"]);
    expect(kept.join(" ").includes("S_EXAMPLE_GROUP")).toBe(false);
    expect(kept.join(" ").includes("subteam")).toBe(false);
  });

  it("dedupes a duplicate block against a message text whose mention rendered differently", () => {
    // Slack sends `<#C1|releases>` in `text` — the resolver takes the label — while the structured leaf
    // carries only the id, which with no channel map renders `#channel`. Comparing rendered forms would call
    // Slack's own duplicate a new fragment and append a near-copy.
    const raw = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "join ", type: "text" },
                { channel_id: "C_UNMAPPED", type: "channel" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    };
    const noMaps = { channelNames: {}, userNames: {} };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["join #releases"], maps: noMaps, raw })).toStrictEqual([]);
  });

  it("still keeps a fragment that differs by more than how its mention rendered", () => {
    const raw = {
      blocks: [{ text: { text: "join #releases for the rollout notes", type: "mrkdwn" }, type: "section" }],
    };
    expect(flattenSlackVisibleProse({ dedupeAgainst: ["join #releases"], maps, raw })).toStrictEqual([
      "join #releases for the rollout notes",
    ]);
  });
});

describe("flattenSlackVisibleProse — an unrenderable mention contributes nothing", () => {
  const richBlock = ({ leaf }: { leaf: Record<string, unknown> }) => ({
    blocks: [{ elements: [{ elements: [leaf], type: "rich_text_section" }], type: "rich_text" }],
  });

  it("emits nothing for a usergroup leaf carrying no id", () => {
    expect(flatten({ raw: richBlock({ leaf: { type: "usergroup" } }) })).toStrictEqual([]);
  });

  it("emits nothing for a user leaf whose id is blank", () => {
    expect(flatten({ raw: richBlock({ leaf: { type: "user", user_id: "" } }) })).toStrictEqual([]);
  });

  it("emits nothing for a channel leaf whose id is blank", () => {
    expect(flatten({ raw: richBlock({ leaf: { channel_id: "", type: "channel" } }) })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — findings from the final review round", () => {
  it("never emits a usergroup id, even when the markup arrived in a Block Kit section", () => {
    const raw = { blocks: [{ text: { text: "paging <!subteam^S01234567>", type: "mrkdwn" }, type: "section" }] };
    const kept = flatten({ raw });
    expect(kept).toStrictEqual(["paging @group"]);
    expect(kept.join(" ").includes("S01234567")).toBe(false);
  });

  it("renders a labelled usergroup mention by its label, without doubling the sigil", () => {
    // The label Slack sends for a usergroup already carries its own `@`, so prefixing another produced
    // `@@platform` — a string no one wrote, and one that does not match the handle it names.
    const raw = {
      blocks: [{ text: { text: "paging <!subteam^S01234567|@platform>", type: "mrkdwn" }, type: "section" }],
    };
    expect(flatten({ raw })).toStrictEqual(["paging @platform"]);
  });
});
