/**
 * `postJudgement.ts` — the line a post card leads with once a session judged the owner's words on it: a hold says why the owner's yes is not sent, a change of meaning
 * says it waits on the owner's word again.
 */
import { describe, expect, it } from "vitest";

import type { DraftJudgement } from "../../components/live/draftJudgement";
import { postJudgementLine, postLandingFloor, postLandingMarks, saysWhyNotSent } from "../../lib/postJudgement";

const APPROVAL = { anchor: "approval-anchor", heard: " Knock yourself out " };

describe("postJudgementLine", () => {
  it("leads with a hold's reason over the approval it keeps", () => {
    const judgement: DraftJudgement = {
      approval: APPROVAL,
      hold: { atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot", why: "every slot is busy" },
      meaningChanged: undefined,
    };
    expect(postJudgementLine({ judgement })).toBe("NOT SENT (no-fleet-slot): every slot is busy");
  });

  it("says a changed meaning waits on the owner's word, and an approved row carries the owner's yes", () => {
    expect([
      postJudgementLine({ judgement: { approval: undefined, hold: undefined, meaningChanged: "the date moved" } }),
      postJudgementLine({ judgement: { approval: APPROVAL, hold: undefined, meaningChanged: undefined } }),
    ]).toEqual([
      "Its meaning changed since your yes, so it waits on your word again: the date moved",
      'You approved it: "Knock yourself out". A session owes the send.',
    ]);
  });

  it("keeps why the owner's yes stopped standing under a later blocking hold", () => {
    const blocking = { atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot", why: "every seat is busy" } as const;
    const changed: DraftJudgement = { approval: undefined, hold: blocking, meaningChanged: "the date changed" };
    const setDown: DraftJudgement = {
      approval: undefined,
      hold: { ...blocking, setDown: { change: "the date changed", heard: APPROVAL.heard, why: "the other was meant" } },
      meaningChanged: undefined,
    };

    expect([postJudgementLine({ judgement: changed }), postJudgementLine({ judgement: setDown })]).toEqual([
      "NOT SENT (no-fleet-slot): every seat is busy Its meaning changed since your yes, so it waits on your word again: the date changed",
      'NOT SENT (no-fleet-slot): every seat is busy Your yes "Knock yourself out" was set down earlier: the other was meant A change of meaning waiting on your word was set down earlier (the date changed): the other was meant',
    ]);
  });

  it("draws nothing for a row nobody judged", () => {
    expect([
      postJudgementLine({ judgement: undefined }),
      postJudgementLine({ judgement: { approval: undefined, hold: undefined, meaningChanged: undefined } }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("saysWhyNotSent", () => {
  it("keeps a card carrying a hold or a change of meaning on the owner's Queue, and no other", () => {
    const hold = { atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot" as const, why: "every slot is busy" };
    expect([
      saysWhyNotSent({ judgement: { approval: APPROVAL, hold, meaningChanged: undefined } }),
      saysWhyNotSent({ judgement: { approval: undefined, hold: undefined, meaningChanged: "the offer changed" } }),
      saysWhyNotSent({ judgement: { approval: APPROVAL, hold: undefined, meaningChanged: undefined } }),
      saysWhyNotSent({ judgement: undefined }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("postLandingFloor — which of the owner's words a hold is news against", () => {
  const at = "2026-10-14T00:02:52.412Z";

  it("dates a blocking hold and a dated change of meaning, so words older than either no longer hide the card", () => {
    const slot = { atIso: at, reason: "no-fleet-slot" as const, why: "the owning seat has closed" };
    expect([
      postLandingFloor({ judgement: { approval: APPROVAL, hold: slot, meaningChanged: undefined } }),
      postLandingFloor({
        judgement: { approval: undefined, hold: undefined, judgedIso: at, meaningChanged: "the date moved" },
      }),
    ]).toEqual([{ landingFloorIso: at }, { landingFloorIso: at }]);
  });

  it("dates a change of meaning beside a hold that is not the owner's yes, and takes the newer of a hold and a change", () => {
    const later = "2026-10-14T12:00:00.000Z";
    const notYet = { atIso: at, reason: "not-owner-yes" as const, why: "recut pending" };
    const slot = { atIso: later, reason: "no-fleet-slot" as const, why: "the owning seat has closed" };
    expect([
      postLandingFloor({ judgement: { approval: undefined, hold: notYet, judgedIso: later, meaningChanged: "moved" } }),
      postLandingFloor({ judgement: { approval: undefined, hold: slot, judgedIso: at, meaningChanged: "moved" } }),
    ]).toEqual([{ landingFloorIso: later }, { landingFloorIso: later }]);
  });

  it("dates a change a hold that is not the owner's yes set down: by the judgement, else by the hold", () => {
    const later = "2026-10-14T12:00:00.000Z";
    const setDown = { change: "the date moved", heard: undefined, why: "recut pending" };
    const notYet = { atIso: at, reason: "not-owner-yes" as const, setDown, why: "recut pending" };
    expect([
      postLandingFloor({
        judgement: { approval: undefined, hold: notYet, judgedIso: later, meaningChanged: undefined },
      }),
      postLandingFloor({ judgement: { approval: undefined, hold: notYet, meaningChanged: undefined } }),
    ]).toEqual([{ landingFloorIso: later }, { landingFloorIso: at }]);
  });

  it("dates nothing for a hold that is not the owner's yes — the owner's steer is what it read — nor an undated change, nor no judgement", () => {
    const notYet = { atIso: at, reason: "not-owner-yes" as const, why: "a recut was asked for" };
    expect([
      postLandingFloor({ judgement: { approval: undefined, hold: notYet, meaningChanged: undefined } }),
      postLandingFloor({ judgement: { approval: undefined, hold: undefined, meaningChanged: "the date moved" } }),
      postLandingFloor({ judgement: undefined }),
    ]).toEqual([{}, {}, {}]);
  });
});

describe("postLandingMarks", () => {
  it("carries the never-fold mark and the floor apart: a hold that is not the owner's yes says why, and dates nothing", () => {
    const at = "2026-10-14T00:02:52.412Z";
    const slot = { atIso: at, reason: "no-fleet-slot" as const, why: "the owning seat has closed" };
    const notYet = { atIso: at, reason: "not-owner-yes" as const, why: "a recut was asked for" };
    expect([
      postLandingMarks({ judgement: { approval: APPROVAL, hold: slot, meaningChanged: undefined } }),
      postLandingMarks({ judgement: { approval: undefined, hold: notYet, meaningChanged: undefined } }),
      postLandingMarks({ judgement: undefined }),
    ]).toEqual([{ landingFloorIso: at, saysWhyNotSent: true }, { saysWhyNotSent: true }, {}]);
  });
});
