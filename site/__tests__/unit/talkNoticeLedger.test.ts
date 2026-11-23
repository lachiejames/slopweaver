/*
 * The process-wide record of window-notice lines the voice was told to say: a claim is seen by every later ask, from
 * any call of this server, so a rollover never says one twice, and a drift and an ISO nudge never share a claim.
 */
import { describe, expect, it } from "vitest";

import { ISO_STRAY_AGAIN_MS } from "../../lib/isoStrayWatch";
import { driftClaimId, isoNudgeClaimId, processTalkNoticeLedger, TalkNoticeLedger } from "../../lib/talkNoticeLedger";

describe("TalkNoticeLedger", () => {
  it("knows a line once it is claimed, and no other", () => {
    const ledger = new TalkNoticeLedger();
    expect(ledger.has({ claimId: "drift:drift-1" })).toBe(false);
    ledger.claim({ claimId: "drift:drift-1" });
    expect([ledger.has({ claimId: "drift:drift-1" }), ledger.has({ claimId: "drift:drift-2" })]).toEqual([true, false]);
  });

  it("holds a drift and an ISO nudge minted with the same page id apart", () => {
    const ledger = new TalkNoticeLedger();
    ledger.claim({ claimId: driftClaimId({ noticeId: "n-1" }) });
    expect([driftClaimId({ noticeId: "n-1" }), isoNudgeClaimId({ noticeId: "n-1" })]).toEqual([
      "drift:n-1",
      "iso-nudge:n-1",
    ]);
    expect(ledger.has({ claimId: isoNudgeClaimId({ noticeId: "n-1" }) })).toBe(false);
  });

  it("holds an hour after each ISO nudge claimed, whatever id comes next, and none before the first", () => {
    const ledger = new TalkNoticeLedger();
    const firstMs = 1_760_259_600_000;
    const unclaimed = ledger.isoNudgeTooSoon({ nowMs: firstMs });
    ledger.isoNudgeClaimedAt({ nowMs: firstMs });
    expect([
      unclaimed,
      ledger.isoNudgeTooSoon({ nowMs: firstMs + ISO_STRAY_AGAIN_MS - 1 }),
      ledger.isoNudgeTooSoon({ nowMs: firstMs + ISO_STRAY_AGAIN_MS }),
    ]).toEqual([false, true, false]);
  });

  it("is one ledger for the whole process, however often it is asked for", () => {
    expect(processTalkNoticeLedger()).toBe(processTalkNoticeLedger());
  });
});
