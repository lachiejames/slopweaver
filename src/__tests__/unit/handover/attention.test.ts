/**
 * The two lifecycle facts a run journal answers about its own dispatch and sign-off.
 *
 * Each case is written as the journal shape a real incident produced rather than as an abstract
 * branch — a dispatch nobody picked up, and the sign-off that distinguishes a vouched-for closure from a self-close.
 */

import { describe, expect, it } from "vitest";
import { hasUnansweredDispatch, lastSignOff } from "../../../handover/attention.js";
import type { RunEvent } from "../../../handover/ledger.js";

/** A dispatch event. */
function dispatched({ atIso = "2026-08-21T10:00:00.000Z", by = "supervisor-one", target = "ws-1" } = {}): RunEvent {
  return { atIso, by, kind: "dispatched", target };
}

/** A start event — what a dispatched session runs, and the thing whose absence is a no-show. */
function started({ atIso = "2026-08-21T10:05:00.000Z" } = {}): RunEvent {
  return { atIso, branch: "b", docHash: "h", kind: "started" };
}

describe("lastSignOff", () => {
  it("names the most recent signer, because a later sign-off supersedes an earlier one", () => {
    const first: RunEvent = { atIso: "2026-08-21T10:00:00.000Z", by: "first", kind: "signed-off", note: "a" };
    const second: RunEvent = { atIso: "2026-08-21T11:00:00.000Z", by: "second", kind: "signed-off", note: "b" };

    expect(lastSignOff({ events: [first, second] })).toEqual({ atIso: "2026-08-21T11:00:00.000Z", by: "second" });
  });

  it("returns undefined when nobody ever signed", () => {
    expect(lastSignOff({ events: [started()] })).toBeUndefined();
  });
});

describe("hasUnansweredDispatch — window-free, because giving up should not wait for a grace period", () => {
  it("is true for a dispatch with nothing after it, however recent", () => {
    const justNow = dispatched({ atIso: "2026-08-21T11:59:00.000Z" });

    expect(hasUnansweredDispatch({ events: [justNow] })).toBe(true);
  });

  it("is false once the session started", () => {
    expect(hasUnansweredDispatch({ events: [dispatched(), started()] })).toBe(false);
  });

  it("is false once somebody abandoned it", () => {
    const abandoned: RunEvent = { atIso: "2026-08-21T10:30:00.000Z", kind: "abandoned", why: "not happening" };

    expect(hasUnansweredDispatch({ events: [dispatched(), abandoned] })).toBe(false);
  });

  it("is false for a journal that was never dispatched at all", () => {
    expect(hasUnansweredDispatch({ events: [started()] })).toBe(false);
  });
});
