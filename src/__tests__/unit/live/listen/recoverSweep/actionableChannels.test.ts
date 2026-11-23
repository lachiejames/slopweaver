/**
 * Which listed conversations the sweep reads at all: a joined channel, every DM and private conversation, and
 * never a public channel the token can merely list.
 */
import { describe, expect, it } from "vitest";

import type { SlackChannelRef } from "../../../../../corpus/slack/fetch.js";
import { actionableChannels } from "../../../../../live/listen/recoverSweep.js";

describe("actionableChannels", () => {
  it("keeps a channel the token has actually joined", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "C1", isMember: true }];
    expect(actionableChannels({ channels }).map((c) => c.id)).toEqual(["C1"]);
  });

  it("drops a public channel merely listable via channels:read but never joined", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "C1" }, { id: "C2", isMember: false }];
    expect(actionableChannels({ channels })).toEqual([]);
  });

  it("keeps every DM regardless of isMember — the bot is inherently a participant", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "D1", isIm: true }];
    expect(actionableChannels({ channels }).map((c) => c.id)).toEqual(["D1"]);
  });

  it("keeps a joined private channel", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "G1", isMember: true, isPrivate: true }];
    expect(actionableChannels({ channels }).map((c) => c.id)).toEqual(["G1"]);
  });

  it("keeps a PRIVATE channel whose row omits isMember, beside a public one it would have kept anyway", () => {
    // A private row is only ever listed to a token that is IN it, so an absent flag is an anomaly rather
    // than a non-member — and dropping it would delete the one conversation class a widened pass exists to
    // reach, silently, while another survivor kept the pass looking complete.
    const channels: readonly SlackChannelRef[] = [
      { id: "C_PUBLIC", isMember: true },
      { id: "C0SYN000011", isPrivate: true },
    ];
    expect(actionableChannels({ channels }).map((c) => c.id)).toEqual(["C_PUBLIC", "C0SYN000011"]);
  });

  it("keeps a group DM whose row omits isMember, for the same reason", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "C_MPIM", isMpim: true }];
    expect(actionableChannels({ channels }).map((c) => c.id)).toEqual(["C_MPIM"]);
  });

  it("still drops a public channel with isMember false, which is the 461-row saving", () => {
    const channels: readonly SlackChannelRef[] = [{ id: "C_SEEN", isMember: false, isPrivate: false }];
    expect(actionableChannels({ channels })).toEqual([]);
  });
});
