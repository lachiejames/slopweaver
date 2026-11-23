/**
 * `draftSentBack.ts` — which earlier cut of a re-cut the owner sent back for its receipts. The chain: a re-cut of
 * a row the owner had rejected for no proof.
 */
import { describe, expect, it } from "vitest";

import type { ParkedSlackDraft, SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import { type SentBackReceipt, sentBackForReceipts } from "../../../../outbound/slack/draftSentBack.js";

/** A held row with the re-cuts it names. */
function item({ id, recuts }: { id: string; recuts?: readonly string[] }): SlackDraftItem {
  const draft: ParkedSlackDraft = {
    advisory: [],
    channel: "D0ISO",
    digest: "d",
    form: "{}",
    id,
    mentions: [],
    payload: { form: "plain", text: "yo, got the receipts on nudge", unfurl_links: false, unfurl_media: false },
    shape: "top-level",
    tsIso: "2026-10-13T02:00:00.000Z",
    why: "every claim on page:nudge-dm-proof",
    ...(recuts === undefined ? {} : { recuts }),
  };
  return { draft, id, state: "held" };
}

const NO_RECEIPTS: SentBackReceipt = {
  about: "post:sd-aca21d36",
  triageRuling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" },
};

describe("sentBackForReceipts", () => {
  it("finds the row a re-cut supersedes when the owner's relay on it carried no-receipts", () => {
    expect(
      sentBackForReceipts({
        items: [item({ id: "sd-aca21d36" })],
        receipts: [NO_RECEIPTS],
        supersedes: ["sd-aca21d36"],
      }),
    ).toBe("sd-aca21d36");
  });

  it("follows the chain back through a re-cut the superseded row itself re-cut", () => {
    const items = [item({ id: "sd-aca21d36" }), item({ id: "sd-b9230a1c", recuts: ["sd-aca21d36"] })];
    expect(sentBackForReceipts({ items, receipts: [NO_RECEIPTS], supersedes: ["sd-b9230a1c"] })).toBe("sd-aca21d36");
  });

  it("finds nothing for another class of feedback, a ruling with none, no ruling, a card not in the chain, or no re-cut", () => {
    const items = [item({ id: "sd-aca21d36" })];
    const glance: SentBackReceipt = {
      ...NO_RECEIPTS,
      triageRuling: { ...NO_RECEIPTS.triageRuling!, feedback: "not-at-a-glance" },
    };
    const bare: SentBackReceipt = { about: "post:sd-aca21d36", triageRuling: { label: undefined, verdict: "rewrite" } };
    const none: SentBackReceipt = { about: "post:sd-aca21d36", triageRuling: null };
    // Feedback beside a yes is a pairing the ledger read refuses; reaching here directly, it still sends nothing back.
    const yes: SentBackReceipt = { ...NO_RECEIPTS, triageRuling: { ...NO_RECEIPTS.triageRuling!, verdict: "send-it" } };
    const elsewhere: SentBackReceipt = { ...NO_RECEIPTS, about: "post:sd-4a11e00c" };
    expect([
      sentBackForReceipts({ items, receipts: [glance], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [bare], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [none], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [yes], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [elsewhere], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [NO_RECEIPTS], supersedes: [] }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("still counts a send-back off a relay not stated whole, because it only refuses a self-evident claim", () => {
    // A relay record as the ledger keeps one: voice, made while the owner was still speaking. Holding it would let a
    // "got the receipts" re-cut through on words that may stop short; kept, the worst it costs is declaring receipts.
    const cut = { ...NO_RECEIPTS, heardTailCut: true, typed: false };
    const unstated = { ...NO_RECEIPTS, typed: false };
    const items = [item({ id: "sd-aca21d36" })];
    expect([
      sentBackForReceipts({ items, receipts: [cut], supersedes: ["sd-aca21d36"] }),
      sentBackForReceipts({ items, receipts: [unstated], supersedes: ["sd-aca21d36"] }),
    ]).toEqual(["sd-aca21d36", "sd-aca21d36"]);
  });

  it("walks a chain that names itself without looping", () => {
    const items = [item({ id: "sd-11112222", recuts: ["sd-11112222"] })];
    expect(sentBackForReceipts({ items, receipts: [NO_RECEIPTS], supersedes: ["sd-11112222"] })).toBe(undefined);
  });
});
