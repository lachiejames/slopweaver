/*
 * The group-DM lane. MEASURED against the real workspace: `conversations.list` paged to
 * exhaustion with `types=public_channel,private_channel,mpim,im` returned 548 public, 57 private, 81 im and
 * ZERO mpim, while the same token asking `types=mpim` returned all 51 in one page. `public_channel` in the
 * list suppresses every group DM; `im` survives the same combination. So discovery asks TWICE, and the fake
 * below is the executable statement of that behaviour — it refuses a combined request the way Slack
 * silently does, which is what makes these tests fail against a one-walk implementation rather than pass
 * vacuously.
 */
import { describe, expect, it } from "vitest";

import { discoverSlackWorkspace } from "../../../../corpus/slack/discovery.js";
import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import {
  SLACK_CONVERSATION_LANES,
  SLACK_LANE_TYPES,
  SLACK_STRUCTURE_LANE_TYPES,
  SLACK_STRUCTURE_LANES,
  type SlackConversationLane,
  type SlackStructureLane,
  slackLaneLabel,
} from "../../../../corpus/slack/lanes.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { fetchCompleteSlackChannels } from "../../../../live/slack/channelPagination.js";

/** The raw `conversations.list` rows each lane serves in these tests, keyed by the lane that returns them. */
const LANE_ROWS: Readonly<Record<SlackConversationLane, readonly unknown[]>> = {
  "channels-and-dms": [
    { id: "C_PUBLIC", is_member: true, name: "alpha" },
    { id: "C_PRIVATE", is_member: true, is_private: true, name: "secrets" },
    { id: "D_DM", is_im: true },
  ],
  "group-dms": [
    { id: "C_MPIM", is_mpim: true, name: "mpdm-ada--grace--alan-1" },
    { id: "C_MPIM_TWO", is_mpim: true, name: "mpdm-ada--linus-1" },
  ],
};

/**
 * A `listChannels` fake that models the MEASURED Slack behaviour: it serves one lane's rows, and THROWS if
 * ever handed a `types` string naming both `public_channel` and `mpim`, because that is the request that
 * silently comes back with no group DMs at all.
 */
function laneListChannels(): SlackApi["listChannels"] {
  return async ({ lane }) => {
    const types = SLACK_LANE_TYPES[lane];
    if (types.includes("public_channel") && types.includes("mpim")) {
      throw new Error(`slack returns no mpim for types=${types}`);
    }
    return { channels: LANE_ROWS[lane] };
  };
}

/** A whole `SlackApi` whose only interesting method is `listChannels` — discovery touches nothing else. */
function laneApi({ listChannels }: { listChannels: SlackApi["listChannels"] }): SlackApi {
  return {
    filesInfo: async () => ({ file: undefined }),
    grantedScopes: async () => [],
    history: async () => ({ messages: [] }),
    listChannels,
    listUsers: async () => ({ members: [] }),
    replies: async () => ({ messages: [] }),
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

describe("the conversation lane registries", () => {
  it("names every read lane, and no lane asks for public channels and group DMs in one request", () => {
    expect(SLACK_CONVERSATION_LANES.length).toBeGreaterThan(0);
    const combined = SLACK_CONVERSATION_LANES.filter((lane) => {
      const types = SLACK_LANE_TYPES[lane];
      return types.includes("public_channel") && types.includes("mpim");
    });
    expect(combined).toEqual([]);
  });

  it("asks for exactly the two read type sets", () => {
    expect(SLACK_LANE_TYPES["channels-and-dms"]).toBe("public_channel,private_channel,im");
    expect(SLACK_LANE_TYPES["group-dms"]).toBe("mpim");
    expect([...SLACK_CONVERSATION_LANES]).toEqual(["channels-and-dms", "group-dms"]);
  });

  it("names every structure lane, and no structure lane combines them either", () => {
    expect(SLACK_STRUCTURE_LANES.length).toBeGreaterThan(0);
    const combined = SLACK_STRUCTURE_LANES.filter((lane: SlackStructureLane) => {
      const types = SLACK_STRUCTURE_LANE_TYPES[lane];
      return types.includes("public_channel") && types.includes("mpim");
    });
    expect(combined).toEqual([]);
  });

  it("keeps DMs out of the STRUCTURE lanes — a two-person membership is already in the messages", () => {
    expect(SLACK_STRUCTURE_LANE_TYPES.channels).toBe("public_channel,private_channel");
    expect(SLACK_STRUCTURE_LANE_TYPES["group-dms"]).toBe("mpim");
    expect(SLACK_STRUCTURE_LANE_TYPES["group-dms"].includes("im,")).toBe(false);
  });

  it("labels a short walk by the conversation class that truncated", () => {
    expect(slackLaneLabel({ lane: "channels-and-dms" })).toBe("slack channel discovery");
    expect(slackLaneLabel({ lane: "group-dms" })).toBe("slack group-DM discovery");
  });
});

describe("discoverSlackWorkspace across both lanes", () => {
  it("discovers group DMs alongside channels and DMs, carrying isMpim through", async () => {
    const discovery = unwrap(await discoverSlackWorkspace({ api: laneApi({ listChannels: laneListChannels() }) }));

    expect(discovery.discovered.map((ref) => ref.id)).toEqual([
      "C_PUBLIC",
      "C_PRIVATE",
      "D_DM",
      "C_MPIM",
      "C_MPIM_TWO",
    ]);
    expect(discovery.discovered.find((ref) => ref.id === "C_MPIM")!.isMpim).toBe(true);
    expect(discovery.discovered.find((ref) => ref.id === "C_PUBLIC")!.isMpim).toBe(undefined);
    expect(discovery.warnings).toEqual([]);
  });

  it("still reaches the group-DM lane under a fetch cap — the cap is PER LANE", async () => {
    // A cap shared across both lanes would be spent entirely by the channel lane (three rows against a cap
    // of two) and return no group DM at all, which is the original defect wearing a flag.
    const discovery = unwrap(
      await discoverSlackWorkspace({ api: laneApi({ listChannels: laneListChannels() }), maxItems: 2 }),
    );

    expect(discovery.discovered.map((ref) => ref.id)).toEqual(["C_PUBLIC", "C_PRIVATE", "C_MPIM", "C_MPIM_TWO"]);
  });

  it("de-duplicates a conversation served by both lanes rather than crawling it twice", async () => {
    const listChannels: SlackApi["listChannels"] = async ({ lane }) => ({
      channels: [{ id: "C_MPIM", is_mpim: true, name: "mpdm-ada--grace--alan-1" }, ...LANE_ROWS[lane]],
    });
    const discovery = unwrap(await discoverSlackWorkspace({ api: laneApi({ listChannels }) }));

    expect(discovery.discovered.filter((ref) => ref.id === "C_MPIM").length).toBe(1);
  });

  it("names the group-DM lane in the warning when only that lane's cursor repeats", async () => {
    const listChannels: SlackApi["listChannels"] = async ({ lane }) => {
      if (lane === "group-dms") {
        return { channels: LANE_ROWS[lane], nextCursor: "stuck-cursor" };
      }
      return { channels: LANE_ROWS[lane] };
    };
    const discovery = unwrap(await discoverSlackWorkspace({ api: laneApi({ listChannels }) }));

    expect(discovery.warnings.length).toBe(1);
    expect(discovery.warnings[0]).toContain("slack group-DM discovery may be incomplete");
  });
});

describe("fetchCompleteSlackChannels across both lanes", () => {
  it("returns both conversation classes and sums the page count", async () => {
    const fetched = unwrap(await fetchCompleteSlackChannels({ api: { listChannels: laneListChannels() } }));

    expect(fetched.channels.map((ref) => ref.id)).toEqual(["C_PUBLIC", "C_PRIVATE", "D_DM", "C_MPIM", "C_MPIM_TWO"]);
    expect(fetched.pageCount).toBe(2);
    expect(fetched.cursorExhausted).toBe(true);
  });

  it("refuses the whole fetch when the group-DM lane alone repeats a cursor, naming that lane", async () => {
    const listChannels: SlackApi["listChannels"] = async ({ lane, cursor }) => {
      if (lane === "group-dms") {
        return { channels: LANE_ROWS[lane], nextCursor: cursor === undefined ? "c1" : "c1" };
      }
      return { channels: LANE_ROWS[lane] };
    };
    const result = await fetchCompleteSlackChannels({ api: { listChannels } });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CURSOR_REPEATED");
    expect(unwrapErr(result).message).toContain("slack group-DM discovery");
  });
});
