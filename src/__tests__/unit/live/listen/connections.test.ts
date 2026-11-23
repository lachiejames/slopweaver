import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  MULTIPLE_CONNECTIONS_GRACE_MS,
  multipleConnectionsGraceDecision,
  socketConnectionPermit,
} from "../../../../live/listen/connections.js";

describe("socketConnectionPermit", () => {
  it("proceeds when the connection count is undefined", () => {
    const result = socketConnectionPermit({ allowMultipleConnections: false, connections: undefined });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).line).toBe("connected to Slack over Socket Mode");
  });

  it("proceeds when there is exactly one connection", () => {
    const result = socketConnectionPermit({ allowMultipleConnections: false, connections: 1 });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).line).toBe("connected to Slack over Socket Mode");
  });

  it("proceeds when the count is zero", () => {
    const result = socketConnectionPermit({ allowMultipleConnections: false, connections: 0 });
    expect(result.isOk()).toBe(true);
  });

  it("refuses two connections with no override", () => {
    const result = socketConnectionPermit({ allowMultipleConnections: false, connections: 2 });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      connections: 2,
      kind: "multiple-connections",
      message:
        "Slack reports 2 connections for this app — a tag can be delivered to either one, and only one of " +
        "them will answer. Stop the other listener and retry.",
    });
  });

  it("proceeds loudly with the override, naming the exact environment variable", () => {
    const result = socketConnectionPermit({ allowMultipleConnections: true, connections: 2 });
    expect(result.isOk()).toBe(true);
    const { line } = unwrap(result);
    expect(line).toContain("Slack reports 2 connections for this app");
    expect(line).toContain("OVERRIDDEN by SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS=1");
  });
});

describe("multipleConnectionsGraceDecision", () => {
  it("opens a streak at the first refusal and retries it", () => {
    expect(
      multipleConnectionsGraceDecision({
        backedOffMs: 0,
        firstRefusalAtMs: undefined,
        nowMs: 5_000,
        windowMs: 120_000,
      }),
    ).toEqual({ firstRefusalAtMs: 5_000, kind: "retry", waitedMs: 0 });
  });

  it("keeps the streak's start and retries while it is younger than the window", () => {
    expect(
      multipleConnectionsGraceDecision({
        backedOffMs: 63_000,
        firstRefusalAtMs: 5_000,
        nowMs: 124_999,
        windowMs: 120_000,
      }),
    ).toEqual({ firstRefusalAtMs: 5_000, kind: "retry", waitedMs: 119_999 });
  });

  it("refuses once the streak has run the whole window", () => {
    expect(
      multipleConnectionsGraceDecision({
        backedOffMs: 63_000,
        firstRefusalAtMs: 5_000,
        nowMs: 125_000,
        windowMs: 120_000,
      }),
    ).toEqual({ firstRefusalAtMs: 5_000, kind: "refuse", waitedMs: 120_000 });
  });

  it("refuses on the backoff already waited when the wall clock moved backward mid-streak", () => {
    // The counterexample: the streak opened at 1,000,000, over 120s of backoff passed, and a clock rollback
    // made the next refusal read 1,061,000 — only 61s on the wall clock.
    expect(
      multipleConnectionsGraceDecision({
        backedOffMs: 121_000,
        firstRefusalAtMs: 1_000_000,
        nowMs: 1_061_000,
        windowMs: 120_000,
      }),
    ).toEqual({ firstRefusalAtMs: 1_000_000, kind: "refuse", waitedMs: 121_000 });
  });

  it("allows two minutes by default — several times the 25s a lost socket took to drain", () => {
    expect(MULTIPLE_CONNECTIONS_GRACE_MS).toBe(120_000);
  });
});
