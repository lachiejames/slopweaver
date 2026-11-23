/**
 * The held-holder judgement on its own: which record is stale, and which refusal is contention a rerun waits
 * out rather than one no rerun clears. The holder is THIS process, which the liveness check answers for
 * without a signal to anyone else.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_STALE_AFTER_MS, heldReason } from "../../../admit/operationLockHeld.js";

const LIVE = { acquiredAtIso: "2026-08-11T00:00:00Z", pid: process.pid, start: undefined };

describe("heldReason", () => {
  it("answers stale for a record aged past its threshold, whoever holds it", () => {
    expect(heldReason({ existing: LIVE, nowIso: "2026-08-11T00:20:00Z", staleAfterMs: DEFAULT_STALE_AFTER_MS })).toBe(
      undefined,
    );
  });

  it("types a live holder within its threshold as contention", () => {
    const reason = heldReason({ existing: LIVE, nowIso: "2026-08-11T00:00:05Z", staleAfterMs: DEFAULT_STALE_AFTER_MS });
    expect(reason!.code).toBe("LOCK_CONTENDED");
    expect(reason!.message).toContain("it was ALIVE when checked at 2026-08-11T00:00:05Z");
  });

  it("types an age it could not compare as a refusal, naming the unreadable instant", () => {
    const reason = heldReason({ existing: LIVE, nowIso: "not-an-instant", staleAfterMs: DEFAULT_STALE_AFTER_MS });
    expect(reason!.code).toBe("LOCK_REFUSED");
    expect(reason!.message).toContain("the instant of this attempt, not-an-instant, is not a readable instant");
  });
});
