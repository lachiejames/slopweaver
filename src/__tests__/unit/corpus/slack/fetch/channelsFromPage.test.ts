/*
 * `channelsFromPage` — what a `conversations.list` row keeps: its privacy, membership and archive flags, and when,
 * by whom and under what topic it was opened. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { channelsFromPage } from "../../../../../corpus/slack/fetch.js";

describe("channelsFromPage", () => {
  it("preserves the is_private / is_im / is_mpim privacy signal (previously discarded)", () => {
    const page = [
      { id: "C_PUB", name: "general" },
      { id: "C_PRIV", is_private: true, name: "secret" },
      { id: "D_DM", is_im: true },
      { id: "G_MPIM", is_mpim: true },
    ];
    expect(channelsFromPage({ channels: page })).toEqual([
      { id: "C_PUB", name: "general" },
      { id: "C_PRIV", isPrivate: true, name: "secret" },
      { id: "D_DM", isIm: true },
      { id: "G_MPIM", isMpim: true },
    ]);
  });

  it("omits a false/absent privacy flag rather than carrying it as false", () => {
    expect(channelsFromPage({ channels: [{ id: "C_PUB", is_private: false, name: "general" }] })).toEqual([
      { id: "C_PUB", name: "general" },
    ]);
  });

  it("preserves is_member — a bot token's own conversations.list lists a public channel it has never joined", () => {
    const page = [
      { id: "C_JOINED", is_member: true, name: "dev" },
      { id: "C_NOT_JOINED", is_member: false, name: "random" },
    ];
    expect(channelsFromPage({ channels: page })).toEqual([
      { id: "C_JOINED", isMember: true, name: "dev" },
      { id: "C_NOT_JOINED", name: "random" },
    ]);
  });

  it("preserves is_archived, which discovery now asks for rather than excluding", () => {
    const page = [
      { id: "C_LIVE", is_archived: false, name: "dev" },
      { id: "C_DONE", is_archived: true, name: "proj-shipped" },
    ];
    expect(channelsFromPage({ channels: page })).toEqual([
      { id: "C_LIVE", name: "dev" },
      { id: "C_DONE", isArchived: true, name: "proj-shipped" },
    ]);
  });

  it("carries when, by whom and under what topic the channel was opened, off the same row", () => {
    const page = [
      {
        created: 1790126244,
        creator: "U0SYN000027",
        id: "C0SYN000004",
        name: "inc-2026-09-23-payment-checkout-regression",
        topic: { creator: "U0SYN000027", last_set: 1790126246, value: "INC-98" },
      },
    ];
    expect(channelsFromPage({ channels: page })).toEqual([
      {
        createdEpochSeconds: 1790126244,
        creator: "U0SYN000027",
        id: "C0SYN000004",
        name: "inc-2026-09-23-payment-checkout-regression",
        topic: "INC-98",
      },
    ]);
  });

  it("leaves each origin part absent when the row carries none, a zero created time or an empty topic", () => {
    const page = [
      { created: 0, id: "D_DM", is_im: true },
      { created: "1790126244", creator: "", id: "C_ODD", name: "odd", topic: { value: "" } },
      { created: 1.5, id: "C_FRACTION", topic: "INC-1" },
    ];
    expect(channelsFromPage({ channels: page })).toEqual([
      { id: "D_DM", isIm: true },
      { id: "C_ODD", name: "odd" },
      { id: "C_FRACTION" },
    ]);
  });
});
