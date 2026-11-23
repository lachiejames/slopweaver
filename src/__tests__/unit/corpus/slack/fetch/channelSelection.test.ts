/*
 * Which discovered channels the crawl reads and in what order — the allowlist filter, the activity ranking and
 * the id-to-name map. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { rankChannelsByActivity } from "../../../../../corpus/slack/curatedFetch.js";
import { channelNameMap, selectChannels } from "../../../../../corpus/slack/fetch.js";

describe("selectChannels", () => {
  const discovered = [
    { id: "C_A", name: "alpha" },
    { id: "C_B", name: "beta" },
  ];

  it("returns every discovered channel when there is no filter", () => {
    expect(selectChannels({ channelFilter: undefined, discovered })).toEqual(discovered);
  });

  it("keeps only the allowlisted ids when a filter is given", () => {
    expect(selectChannels({ channelFilter: ["C_B"], discovered }).map((c) => c.id)).toEqual(["C_B"]);
    expect(selectChannels({ channelFilter: ["C_MISSING"], discovered })).toEqual([]);
  });
});

describe("rankChannelsByActivity", () => {
  // The ranking reads a summary's `itemCount` and nothing else — the messages themselves are released the
  // moment a conversation is committed, which is what bounds a 603-conversation crawl's memory.
  const ch = ({ id, name, items }: { id: string; name: string | undefined; items: number }) => ({
    channelId: id,
    itemCount: items,
    maxTsIso: "",
    ...(name !== undefined ? { channelName: name } : {}),
  });

  it("orders channels by total activity (messages + replies), most active first", () => {
    const ranked = rankChannelsByActivity({
      channels: [
        ch({ id: "C_low", items: 1, name: "low" }),
        ch({ id: "C_high", items: 9, name: "high" }),
        ch({ id: "C_mid", items: 3, name: "mid" }),
      ],
    });
    expect(ranked.map((c) => c.id)).toEqual(["C_high", "C_mid", "C_low"]);
  });

  it("preserves a channel name and omits it when absent", () => {
    const ranked = rankChannelsByActivity({
      channels: [ch({ id: "C_named", items: 2, name: "named" }), ch({ id: "C_dm", items: 1, name: undefined })],
    });
    expect(ranked[0]).toEqual({ id: "C_named", name: "named" });
    expect(ranked[1]).toEqual({ id: "C_dm" });
  });
});

describe("channelNameMap", () => {
  it("maps ids to names, omitting nameless channels", () => {
    expect(channelNameMap({ discovered: [{ id: "C_A", name: "alpha" }, { id: "C_B" }] })).toEqual({ C_A: "alpha" });
  });

  it("returns an empty map for no channels", () => {
    expect(channelNameMap({ discovered: [] })).toEqual({});
  });
});
