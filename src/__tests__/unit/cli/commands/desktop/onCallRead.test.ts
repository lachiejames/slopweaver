import { describe, expect, it } from "vitest";

import { onCallHoldOf } from "../../../../../cli/commands/desktop/onCallRead.js";
import { type MicDevice, type OnCallHoldError, OnCallHoldErrors } from "../../../../../desktop/onCallHold.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const NOW_MS = 1_800_000_000_000;
const QUIET_MICS: readonly MicDevice[] = [{ inUse: false, name: "MacBook Pro Microphone" }];

/** A lease file's text, live until `untilMs`. */
const lease = ({ callId, untilMs }: { callId: string; untilMs: number }): string => JSON.stringify({ callId, untilMs });

/** Reads that answer from fixed values and record the order they were called in. */
const reads = ({
  mics,
  leases,
}: {
  mics: Result<readonly MicDevice[], OnCallHoldError>;
  leases: Result<readonly string[], { readonly message: string }>;
}): {
  readonly order: string[];
  readonly readMics: () => Result<readonly MicDevice[], OnCallHoldError>;
  readonly readLeaseTexts: () => Result<readonly string[], { readonly message: string }>;
  readonly nowMs: () => number;
} => {
  const order: string[] = [];
  return {
    nowMs: () => {
      order.push("clock");
      return NOW_MS;
    },
    order,
    readLeaseTexts: () => {
      order.push("leases");
      return leases;
    },
    readMics: () => {
      order.push("mics");
      return mics;
    },
  };
};

describe("onCallHoldOf", () => {
  it("does not hold with no live lease and no microphone in use, reading the clock first and the leases last", () => {
    const seams = reads({ leases: ok([lease({ callId: "old", untilMs: NOW_MS - 1 })]), mics: ok(QUIET_MICS) });
    expect(onCallHoldOf(seams)).toBe(undefined);
    expect(seams.order).toEqual(["clock", "leases", "mics", "leases"]);
  });

  // The regression (Codex rebase-hold-05): read only after the slow microphone read, a lease live when the read began
  // and removed during it was never seen.
  it("holds on a lease live when the read began that is removed during the microphone read", () => {
    let leases: readonly string[] = [lease({ callId: "owner-call", untilMs: NOW_MS + 60_000 })];
    const held = onCallHoldOf({
      nowMs: () => NOW_MS,
      readLeaseTexts: () => ok(leases),
      readMics: () => {
        leases = [];
        return ok(QUIET_MICS);
      },
    })!;
    expect([held.code, held.message]).toEqual(["ON_CALL", expect.stringContaining("1 voice call lease(s) live")]);
  });

  it("holds on a lease written during the microphone read", () => {
    let leases: readonly string[] = [];
    const held = onCallHoldOf({
      nowMs: () => NOW_MS,
      readLeaseTexts: () => ok(leases),
      readMics: () => {
        leases = [lease({ callId: "owner-call", untilMs: NOW_MS + 60_000 })];
        return ok(QUIET_MICS);
      },
    })!;
    expect([held.code, held.message]).toEqual(["ON_CALL", expect.stringContaining("1 voice call lease(s) live")]);
  });

  // The regression (Codex rebase-hold-02): judged by a clock read after the slow microphone read, a lease live when
  // the read began aged out unseen and the leg placed a call.
  it("holds on a lease live when the read began that expires during the microphone read", () => {
    let now = NOW_MS;
    const held = onCallHoldOf({
      nowMs: () => now,
      readLeaseTexts: () => ok([lease({ callId: "owner-call", untilMs: NOW_MS + 500 })]),
      readMics: () => {
        now = NOW_MS + 1_000;
        return ok(QUIET_MICS);
      },
    })!;
    expect([held.code, held.message]).toEqual(["ON_CALL", expect.stringContaining("1 voice call lease(s) live")]);
  });

  it("counts one call listed under both lease roots once", () => {
    const live = lease({ callId: "owner-call", untilMs: NOW_MS + 60_000 });
    const held = onCallHoldOf(reads({ leases: ok([live, live]), mics: ok(QUIET_MICS) }))!;
    expect([held.code, held.message]).toEqual(["ON_CALL", expect.stringContaining("1 voice call lease(s) live")]);
  });

  it("holds as an unknown call on a lease that does not parse beside an expired one, never reading it as none", () => {
    const seams = reads({
      leases: ok([lease({ callId: "old", untilMs: NOW_MS - 1 }), "{torn"]),
      mics: ok(QUIET_MICS),
    });
    const held = onCallHoldOf(seams)!;
    expect([held.code, held.message]).toEqual([
      "ON_CALL_UNKNOWN",
      expect.stringContaining("1 call lease file(s) did not parse as a lease"),
    ]);
  });

  it("holds as an unknown call when the leases cannot be read", () => {
    const held = onCallHoldOf(reads({ leases: err({ message: "EACCES docs-site" }), mics: ok(QUIET_MICS) }))!;
    expect([held.code, held.message]).toEqual(["ON_CALL_UNKNOWN", expect.stringContaining("(EACCES docs-site)")]);
  });

  it("holds on a microphone read that fails, and never reads the leases after it", () => {
    const failed = OnCallHoldErrors.onCallUnknown({ detail: "the microphone read failed: timed out" });
    const seams = reads({ leases: ok([]), mics: err(failed) });
    expect(onCallHoldOf(seams)).toEqual(failed);
    expect(seams.order).toEqual(["clock", "leases", "mics"]);
  });

  // Before a crash scenario's recovered successor call the test's own call holds one lease, so the
  // read allows exactly that one and holds on any second, or on a torn one.
  it("allows the test's own live lease and holds on a second one beside it", () => {
    const own = lease({ callId: "test-call", untilMs: NOW_MS + 60_000 });
    const theirs = lease({ callId: "owner-call", untilMs: NOW_MS + 60_000 });
    const alone = onCallHoldOf({ ...reads({ leases: ok([own]), mics: ok(QUIET_MICS) }), ownLiveCalls: 1 });
    const beside = onCallHoldOf({ ...reads({ leases: ok([own, theirs]), mics: ok(QUIET_MICS) }), ownLiveCalls: 1 })!;
    expect(alone).toBe(undefined);
    expect([beside.code, beside.message]).toEqual(["ON_CALL", expect.stringContaining("1 voice call lease(s) live")]);
  });

  it("holds on a torn lease beside the test's own, whatever it allows", () => {
    const own = lease({ callId: "test-call", untilMs: NOW_MS + 60_000 });
    const held = onCallHoldOf({ ...reads({ leases: ok([own, "{torn"]), mics: ok(QUIET_MICS) }), ownLiveCalls: 1 })!;
    expect(held.code).toBe("ON_CALL_UNKNOWN");
  });

  it("holds on a microphone another app holds, with no lease at all", () => {
    const held = onCallHoldOf(reads({ leases: ok([]), mics: ok([{ inUse: true, name: "Headset" }]) }))!;
    expect([held.code, held.message]).toEqual([
      "ON_CALL",
      expect.stringContaining("microphone(s) in use by another app: Headset"),
    ]);
  });
});
