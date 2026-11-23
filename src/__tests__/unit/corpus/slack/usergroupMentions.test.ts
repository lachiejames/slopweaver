import { describe, expect, it } from "vitest";

import {
  flattenSlackVisibleProse,
  resolveSlackMarkup,
  type SlackNameMaps,
} from "../../../../corpus/slack/visibleProse.js";

/**
 * The map the Slack atlas supplies. Its ABSENCE is what left every usergroup unresolvable — see
 * `atlas/slackWorkspace/names.ts` for the measurement.
 */
const WITH_ATLAS: SlackNameMaps = {
  channelNames: {},
  userNames: {},
  usergroupHandles: { S0SYN000001: "pioneers-all" },
};

/** The maps as they were before the atlas existed: users and channels, and no third map. */
const WITHOUT_ATLAS: SlackNameMaps = { channelNames: {}, userNames: {} };

describe("resolveSlackMarkup, usergroup references", () => {
  it("names a bare <!subteam^S…> when the atlas holds that group", () => {
    expect(resolveSlackMarkup({ maps: WITH_ATLAS, text: "ping <!subteam^S0SYN000001> please" })).toBe(
      "ping @pioneers-all please",
    );
  });

  it("falls back to the generic @group for a group the atlas has never seen", () => {
    expect(resolveSlackMarkup({ maps: WITH_ATLAS, text: "<!subteam^SUNKNOWN1>" })).toBe("@group");
  });

  it("falls back to @group when no atlas map was supplied at all — the pre-atlas behaviour, unchanged", () => {
    expect(resolveSlackMarkup({ maps: WITHOUT_ATLAS, text: "<!subteam^S0SYN000001>" })).toBe("@group");
  });

  it("prefers the label Slack itself sent over the map, because that label is what the sender saw", () => {
    expect(resolveSlackMarkup({ maps: WITH_ATLAS, text: "<!subteam^S0SYN000001|@pioneers>" })).toBe("@pioneers");
  });

  it("leaves the other specials exactly as they were", () => {
    expect(resolveSlackMarkup({ maps: WITH_ATLAS, text: "<!here> and <!channel>" })).toBe("@here and @channel");
  });

  it("never leaves an opaque S… id in the text, whichever way it goes", () => {
    expect(resolveSlackMarkup({ maps: WITH_ATLAS, text: "<!subteam^SUNKNOWN1>" })).not.toContain("SUNKNOWN1");
  });
});

describe("flattenSlackVisibleProse, usergroup ids that arrive already spelled out", () => {
  it("names one the atlas holds, rather than genericising it", () => {
    expect(
      flattenSlackVisibleProse({
        dedupeAgainst: [],
        maps: WITH_ATLAS,
        raw: { attachments: [{ text: "cc @subteam^S0SYN000001" }] },
      }),
    ).toEqual(["cc @pioneers-all"]);
  });

  it("genericises one the atlas has never seen, so no opaque id reaches the index", () => {
    expect(
      flattenSlackVisibleProse({
        dedupeAgainst: [],
        maps: WITH_ATLAS,
        raw: { attachments: [{ text: "cc @subteam^SUNKNOWN1" }] },
      }),
    ).toEqual(["cc @group"]);
  });

  it("genericises with no atlas map at all — the pre-atlas behaviour, unchanged", () => {
    expect(
      flattenSlackVisibleProse({
        dedupeAgainst: [],
        maps: WITHOUT_ATLAS,
        raw: { attachments: [{ text: "cc @subteam^S0SYN000001" }] },
      }),
    ).toEqual(["cc @group"]);
  });
});
