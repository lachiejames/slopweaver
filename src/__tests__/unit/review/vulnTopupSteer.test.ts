/**
 * The merge-release gate's one hatch, judged purely: a row's standing explicit steer with a deliver-by still ahead
 * releases it, and nothing else does.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TopupSteerErrors, topupSteerRelease } from "../../../review/vulnTopupSteer.js";

const NOW = "2026-10-26T15:00:00.000Z";
const ANCHOR = "transcript:a#b";

/** A ruling on the row, carrying an explicit steer only when one is passed. */
function ruling({ atIso, explicitSteer }: { atIso: string; explicitSteer?: { deliverByIso?: string } }): RunEvent {
  return {
    anchor: ANCHOR,
    atIso,
    kind: "ruling",
    ruling: "expecting to see that vulnfix top up in #dev-alerts when i wake up",
    ...(explicitSteer === undefined ? {} : { explicitSteer }),
  };
}

describe("topupSteerRelease", () => {
  it("releases on a standing steer whose deliver-by is still ahead, naming the instant and the anchor", () => {
    const events = [
      ruling({ atIso: "2026-10-26T14:36:14.486Z", explicitSteer: { deliverByIso: "2026-10-26T20:00:00.000Z" } }),
    ];

    expect(unwrap(topupSteerRelease({ events, nowIso: NOW, unreadable: [] }))).toEqual({
      anchor: ANCHOR,
      deliverByIso: "2026-10-26T20:00:00.000Z",
    });
  });

  it("refuses a row with no ruling at all", () => {
    expect(unwrapErr(topupSteerRelease({ events: [], nowIso: NOW, unreadable: [] }))).toEqual(
      TopupSteerErrors.notASteer(),
    );
  });

  it("refuses an ordinary ruling", () => {
    const events = [ruling({ atIso: "2026-10-26T14:36:14.486Z" })];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: NOW, unreadable: [] })).code).toBe("NOT_A_STEER");
  });

  it("refuses a steer a later ordinary ruling superseded", () => {
    const events = [
      ruling({ atIso: "2026-10-26T14:00:00.000Z", explicitSteer: { deliverByIso: "2026-10-26T20:00:00.000Z" } }),
      ruling({ atIso: "2026-10-26T14:30:00.000Z" }),
    ];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: NOW, unreadable: [] })).message).toBe(
      "its standing ruling is not an explicit steer",
    );
  });

  it("refuses a steer that names no deliver-by, which could hold the gate open for good", () => {
    const events = [ruling({ atIso: "2026-10-26T14:36:14.486Z", explicitSteer: {} })];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: NOW, unreadable: [] })).message).toBe(
      "its explicit steer names no deliver-by instant, so it cannot bound how long the gate stays open",
    );
  });

  it("refuses a steer whose deliver-by has passed, at the instant itself", () => {
    const events = [ruling({ atIso: "2026-10-26T14:36:14.486Z", explicitSteer: { deliverByIso: NOW } })];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: NOW, unreadable: [] }))).toEqual(
      TopupSteerErrors.passed({ deliverByIso: NOW }),
    );
  });

  it("refuses an instant that does not parse rather than releasing on a comparison with NaN", () => {
    const events = [
      ruling({ atIso: "2026-10-26T14:36:14.486Z", explicitSteer: { deliverByIso: "2026-10-26T20:00:00.000Z" } }),
    ];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: "not an instant", unreadable: [] })).message).toBe(
      "the instant to judge at (not an instant) or the steer's deliver-by (2026-10-26T20:00:00.000Z) does not parse",
    );
  });

  it("refuses a journal with an unreadable line, which may be the ruling that ended the steer", () => {
    const events = [
      ruling({ atIso: "2026-10-26T14:36:14.486Z", explicitSteer: { deliverByIso: "2026-10-26T20:00:00.000Z" } }),
    ];

    expect(unwrapErr(topupSteerRelease({ events, nowIso: NOW, unreadable: [2] }))).toEqual(
      TopupSteerErrors.journalUnreadable({ unreadable: [2] }),
    );
  });
});
