/**
 * `executeTier` — the one host-neutral contract every routing tier runs through. Pure lease arithmetic plus
 * an effectful dispatch tested against plain fakes, never a real subagent or a real cmux call.
 */
import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { ReadOnlySubagentAdapter } from "../../../../live/turn/subagent.js";
import {
  DEFAULT_LEASE_HOURS,
  executeTier,
  isLeaseExpired,
  leaseExpiryFromNow,
  type RespondDecision,
  type TierDeps,
  type TierRequest,
} from "../../../../live/turn/tier.js";

const ASK: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };

const RESPOND_DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "a plain conversational reply covers this",
  response: "respond",
  truthMode: "none",
  schemaVersion: 1,
  tier: "inline",
};

/** A `TierDeps` whose every member throws unless overridden — same landmine discipline as `poster/harness.ts`. */
function deps({
  launchVisibleSession = () => Promise.reject(new Error("not expected to launch")),
  nowIso = () => {
    throw new Error("not expected to read the clock");
  },
  subagent = () => Promise.reject(new Error("not expected to call the subagent")),
}: Partial<TierDeps> = {}): TierDeps {
  return { launchVisibleSession, nowIso, subagent };
}

describe("leaseExpiryFromNow / isLeaseExpired", () => {
  it("computes a lease DEFAULT_LEASE_HOURS after now", () => {
    const expiry = leaseExpiryFromNow({ nowIso: "2026-08-12T00:00:00.000Z" });
    expect(expiry).toBe(`2026-08-12T0${String(DEFAULT_LEASE_HOURS)}:00:00.000Z`);
  });

  it("is not expired strictly before its own expiry", () => {
    expect(isLeaseExpired({ leaseExpiresAt: "2026-08-12T02:00:00.000Z", nowIso: "2026-08-12T01:59:59.999Z" })).toBe(
      false,
    );
  });

  it("is expired exactly AT its own expiry, not just strictly after it", () => {
    expect(isLeaseExpired({ leaseExpiresAt: "2026-08-12T02:00:00.000Z", nowIso: "2026-08-12T02:00:00.000Z" })).toBe(
      true,
    );
  });

  it("is expired well after its own expiry", () => {
    expect(isLeaseExpired({ leaseExpiresAt: "2026-08-12T02:00:00.000Z", nowIso: "2026-08-13T00:00:00.000Z" })).toBe(
      true,
    );
  });

  /**
   * A found-and-fixed defect: `Date.parse` returns `NaN` for a string that LOOKS like ISO 8601 but
   * uses a form it does not support (a decimal comma instead of a period, a real ISO 8601 extended-format
   * variant). `NaN >= NaN` is `false`, so the old comparison read an unparseable `leaseExpiresAt` as "still
   * active" — dispatching a session with no real bound at all. Failing closed (treating anything unparseable
   * as already expired) is the fix.
   */
  it("fails CLOSED — treats an unparseable leaseExpiresAt as already expired, never as still active", () => {
    expect(isLeaseExpired({ leaseExpiresAt: "2026-08-12T02:00:00,000Z", nowIso: "2026-08-13T00:00:00.000Z" })).toBe(
      true,
    );
  });

  it("fails CLOSED — treats an unparseable nowIso as already expired too", () => {
    expect(isLeaseExpired({ leaseExpiresAt: "2026-08-12T02:00:00.000Z", nowIso: "not a real instant" })).toBe(true);
  });
});

describe("executeTier — inline", () => {
  it("returns immediately, carrying the decision's own rationale as system-authored evidence", async () => {
    const request: TierRequest = { ask: ASK, decision: RESPOND_DECISION, kind: "inline" };
    const result = await executeTier({ deps: deps(), request });

    expect(result).toEqual({
      evidence: {
        observations: [
          { author: "system", source: "routing-decision", text: "a plain conversational reply covers this" },
        ],
      },
      kind: "returned",
      tier: "inline",
    });
  });
});

describe("executeTier — read-only-subagent", () => {
  const request: TierRequest = {
    ask: ASK,
    kind: "read-only-subagent",
    leaseExpiresAt: "2026-08-12T02:00:00.000Z",
    task: { ask: ASK, instructions: "read the linked GitHub issue and report what it says" },
  };

  it("returns the adapter's own evidence, untouched", async () => {
    const subagent: ReadOnlySubagentAdapter = () =>
      Promise.resolve({
        evidence: { observations: [{ author: "owner", source: "thread", text: "the issue says X" }] },
        kind: "returned",
      });

    const result = await executeTier({
      deps: deps({ nowIso: () => "2026-08-12T00:00:00.000Z", subagent }),
      request,
    });

    expect(result).toEqual({
      evidence: { observations: [{ author: "owner", source: "thread", text: "the issue says X" }] },
      kind: "returned",
      tier: "read-only-subagent",
    });
  });

  it("carries the adapter's own failure reason through as a tier failure", async () => {
    const subagent: ReadOnlySubagentAdapter = () => Promise.resolve({ kind: "failed", reason: "the issue 404'd" });

    const result = await executeTier({
      deps: deps({ nowIso: () => "2026-08-12T00:00:00.000Z", subagent }),
      request,
    });

    expect(result).toEqual({ kind: "failed", reason: "the issue 404'd", tier: "read-only-subagent" });
  });

  /** Mirrors the fresh-visible-session lease test below — the same primitive, now also guarding this tier. */
  it("reaches lease-expired WITHOUT calling the subagent, for a request whose lease has already expired", async () => {
    let called = false;
    const subagent: ReadOnlySubagentAdapter = () => {
      called = true;
      return Promise.resolve({
        evidence: { observations: [] },
        kind: "returned",
      });
    };

    const result = await executeTier({
      deps: deps({ nowIso: () => "2026-08-13T00:00:00.000Z", subagent }),
      request,
    });

    expect(result).toEqual({ ask: ASK, kind: "lease-expired" });
    expect(called).toBe(false);
  });
});

describe("executeTier — fresh-visible-session", () => {
  const request: TierRequest = {
    ask: ASK,
    briefPath: "/tmp/brief.json",
    kind: "fresh-visible-session",
    leaseExpiresAt: "2026-08-12T02:00:00.000Z",
  };

  it("dispatches through the launcher and returns its session, when the lease is still active", async () => {
    const launchVisibleSession: TierDeps["launchVisibleSession"] = () =>
      Promise.resolve({
        session: {
          host: "claude-code",
          surfaceId: "id-surface-1",
          surfaceRef: "surface:1",
          workspaceId: "id-workspace-1",
          workspaceRef: "workspace:1",
        },
      });

    const result = await executeTier({
      deps: deps({ launchVisibleSession, nowIso: () => "2026-08-12T00:00:00.000Z" }),
      request,
    });

    expect(result).toEqual({
      kind: "dispatched",
      session: {
        host: "claude-code",
        surfaceId: "id-surface-1",
        surfaceRef: "surface:1",
        workspaceId: "id-workspace-1",
        workspaceRef: "workspace:1",
      },
      tier: "fresh-visible-session",
    });
  });

  /**
   * The whole point of the lease (P3 finding #6): a request whose lease has ALREADY expired must reach
   * `lease-expired` rather than dispatching a session nobody will ever check on again.
   */
  it("reaches lease-expired WITHOUT dispatching, for a request whose lease has already expired", async () => {
    let launched = false;
    const launchVisibleSession: TierDeps["launchVisibleSession"] = () => {
      launched = true;
      return Promise.resolve({
        session: {
          host: "claude-code",
          surfaceId: "id-surface-1",
          surfaceRef: "surface:1",
          workspaceId: "id-workspace-1",
          workspaceRef: "workspace:1",
        },
      });
    };

    const result = await executeTier({
      deps: deps({ launchVisibleSession, nowIso: () => "2026-08-13T00:00:00.000Z" }),
      request,
    });

    expect(result).toEqual({ ask: ASK, kind: "lease-expired" });
    expect(launched).toBe(false);
  });

  it("carries the launcher's own failure reason through as a tier failure", async () => {
    const launchVisibleSession: TierDeps["launchVisibleSession"] = () =>
      Promise.resolve({ reason: "the workspace never booted" });

    const result = await executeTier({
      deps: deps({ launchVisibleSession, nowIso: () => "2026-08-12T00:00:00.000Z" }),
      request,
    });

    expect(result).toEqual({ kind: "failed", reason: "the workspace never booted", tier: "fresh-visible-session" });
  });
});
