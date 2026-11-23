/**
 * `outbound/slack/scheduledPostChannel.ts` — the DOOR-side rail: a send carrying a recipe
 * slot's delivery key came from a clock, so it lands in the owner's private conversation unless the owner has
 * approved the channel.
 *
 * Pure: every case is four values and the lines they produce.
 */
import { describe, expect, it } from "vitest";

import { slotDeliveryKey } from "../../../../live/automation/slotLedger.js";
import { isScheduledDelivery, scheduledPostChannelRefusal } from "../../../../outbound/slack/scheduledPostChannel.js";

/** The owner's configured private conversation. */
const DM = "D0SYNOWNERDM";

/**
 * A REAL delivery key, minted by the function the tick actually calls.
 *
 * Not a hand-written `"recipe-slot:…"` literal, deliberately: the whole gate rests on the door recognising
 * the key `slotLedger.ts` mints, so a test that spells its own would keep passing the day that prefix moved.
 */
const SLOT_KEY = slotDeliveryKey({
  recipeId: "iso-policy-acceptance-daily",
  slotIso: "2026-09-20T23:00:00.000Z",
});

describe("isScheduledDelivery", () => {
  it("recognises the key the tick actually mints", () => {
    expect(isScheduledDelivery({ idempotencyKey: SLOT_KEY })).toBe(true);
  });

  it("does not claim an ordinary hand-typed send, which carries no key", () => {
    expect(isScheduledDelivery({ idempotencyKey: undefined })).toBe(false);
  });

  it("does not claim another mechanism's key", () => {
    expect(isScheduledDelivery({ idempotencyKey: "handover-ask:abc123" })).toBe(false);
  });
});

describe("scheduledPostChannelRefusal", () => {
  it("says nothing about a send that carries no slot key — a person's direct ask is untouched", () => {
    expect(
      scheduledPostChannelRefusal({
        approvedChannels: [],
        channel: "C0TEAM",
        idempotencyKey: undefined,
        promptChannel: DM,
      }),
    ).toEqual([]);
  });

  it("admits a scheduled card aimed at the owner's private conversation", () => {
    expect(
      scheduledPostChannelRefusal({
        approvedChannels: [],
        channel: DM,
        idempotencyKey: SLOT_KEY,
        promptChannel: DM,
      }),
    ).toEqual([]);
  });

  it("REFUSES a scheduled card aimed at a channel nobody has approved, naming both conversations", () => {
    const refusal = scheduledPostChannelRefusal({
      approvedChannels: [],
      channel: "C0TEAM",
      idempotencyKey: SLOT_KEY,
      promptChannel: DM,
    });
    expect(refusal.length).toBe(3);
    expect(refusal[0]).toContain("aimed at C0TEAM");
    expect(refusal[0]).toContain(`neither the private conversation ${DM}`);
  });

  it("says out loud that there is no hatch, and names the approval as the fix instead", () => {
    const refusal = scheduledPostChannelRefusal({
      approvedChannels: [],
      channel: "C0TEAM",
      idempotencyKey: SLOT_KEY,
      promptChannel: DM,
    });
    expect(refusal[1]).toContain("channelApprovals");
    expect(refusal[2]).toContain("deliberately NO escape hatch");
  });

  it("admits the channel once some row records the owner's approval for it", () => {
    expect(
      scheduledPostChannelRefusal({
        approvedChannels: ["C0TEAM"],
        channel: "C0TEAM",
        idempotencyKey: SLOT_KEY,
        promptChannel: DM,
      }),
    ).toEqual([]);
  });

  it("does not let an approval for one channel admit a send to another", () => {
    expect(
      scheduledPostChannelRefusal({
        approvedChannels: ["C0OTHER"],
        channel: "C0TEAM",
        idempotencyKey: SLOT_KEY,
        promptChannel: DM,
      }).length,
    ).toBe(3);
  });

  it("REFUSES an install with no configured conversation rather than admitting the send somewhere public", () => {
    const refusal = scheduledPostChannelRefusal({
      approvedChannels: ["C0TEAM"],
      channel: "C0TEAM",
      idempotencyKey: SLOT_KEY,
      promptChannel: undefined,
    });
    expect(refusal.length).toBe(1);
    expect(refusal[0]).toContain("no `slackBot.promptChannel` is set");
  });
});
