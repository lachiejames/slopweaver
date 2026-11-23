/** `draftMemberIds`: every member id a held draft would show a reader, gathered once each, groups and channels left out. */
import { describe, expect, it } from "vitest";

import { draftMemberIds } from "../../../../../outbound/slack/draftMemberIds.js";
import type { ParkedSlackDraft } from "../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { draft } from "./fixtures.js";

describe("draftMemberIds — every member id a draft would show a reader", () => {
  const held = ({ over }: { over: Partial<ParkedSlackDraft> }) => ({
    draft: draft({ over }),
    id: "sd-1",
    state: "held" as const,
  });

  it("gathers the author, each tagged person and each user element, once each, leaving groups out", () => {
    const rich: SlackDripMessagePayload = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { type: "user", user_id: "U2" },
                { text: " and U9 in words", type: "text" },
                { type: "usergroup", usergroup_id: "S1" },
              ],
              type: "rich_text_section",
            },
            {
              elements: [{ elements: [{ type: "user", user_id: "U1" }], type: "rich_text_section" }],
              style: "bullet",
              type: "rich_text_list",
            },
          ],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "",
      unfurl_links: false,
      unfurl_media: false,
    };
    const items = [
      held({
        over: {
          mentions: [
            { key: "@ada-example", kind: "person", target: "U1" },
            { key: "@security", kind: "group", target: "S1" },
          ],
          payload: rich,
        },
      }),
    ];
    expect(draftMemberIds({ items })).toEqual(["U0SYNADAOWN", "U1", "U2"]);
  });

  it("reads a user mention out of a plain payload's text", () => {
    const plain: SlackDripMessagePayload = {
      form: "plain",
      text: "<@W0GRID> and <@U3|someone>, not <#C1> nor <!subteam^S2>",
      unfurl_links: false,
      unfurl_media: false,
    };
    const items = [held({ over: { authorId: undefined, mentions: [], payload: plain } })];
    expect(draftMemberIds({ items })).toEqual(["W0GRID", "U3"]);
  });

  it("names the person a DM is addressed to by member id, and never a channel or a D… conversation id", () => {
    const plain: SlackDripMessagePayload = {
      form: "plain",
      text: "no mentions at all",
      unfurl_links: false,
      unfurl_media: false,
    };
    const items = [
      held({ over: { authorId: undefined, channel: "U0KYLE", mentions: [], payload: plain } }),
      held({ over: { authorId: undefined, channel: "W0GRID", mentions: [], payload: plain } }),
      held({ over: { authorId: undefined, channel: "D0SYN000004", mentions: [], payload: plain } }),
      held({ over: { authorId: undefined, channel: "C0ISO", mentions: [], payload: plain } }),
    ];
    expect(draftMemberIds({ items })).toEqual(["U0KYLE", "W0GRID"]);
  });

  it("gathers the thread root's author and every person its text and the why name, so the card shows names", () => {
    const plain: SlackDripMessagePayload = {
      form: "plain",
      text: "no mentions at all",
      unfurl_links: false,
      unfurl_media: false,
    };
    const items = [
      held({
        over: {
          authorId: undefined,
          mentions: [],
          payload: plain,
          shape: "thread",
          threadParent: { text: "<@U0QUINN> can you look, cc <@U0SADIE|sadie>", userId: "U0ROSA" },
          threadTs: "1789407961.767649",
          why: "reply to <@U0ROSA>'s ask in the thread",
        },
      }),
    ];
    expect(draftMemberIds({ items })).toEqual(["U0ROSA", "U0QUINN", "U0SADIE"]);
  });

  it("answers nothing for no drafts", () => {
    expect(draftMemberIds({ items: [] })).toEqual([]);
  });
});
