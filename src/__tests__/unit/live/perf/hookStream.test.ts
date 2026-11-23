import { describe, expect, it } from "vitest";
import { type CmuxEvent, parseEventFrame } from "../../../../cmux/events.js";
import { bareSessionId, hookStreamReading } from "../../../../live/perf/hookStream.js";

const BASE_MS = Date.parse("2026-09-19T10:00:00.000Z");

/** One decoded frame, with every field a fold reads spelled out. */
function frame({
  seq,
  name,
  offsetSeconds,
  workspaceId = "workspace-1",
  sessionId = "claude-aaaabbbb-0000-0000-0000-000000000001",
  cwd = "/w/one",
  toolName,
  phase = "received",
}: {
  seq: number;
  name: string;
  offsetSeconds: number;
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  cwd?: string | undefined;
  toolName?: string | undefined;
  phase?: string | undefined;
}): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd,
    id: `id-${String(seq)}`,
    name,
    occurredAtIso: new Date(BASE_MS + offsetSeconds * 1000).toISOString(),
    phase,
    seq,
    sessionId,
    surfaceId: undefined,
    toolName,
    workspaceId,
  };
}

function preToolUse({ seq, offsetSeconds }: { seq: number; offsetSeconds: number }): CmuxEvent {
  return frame({ name: "agent.hook.PreToolUse", offsetSeconds, seq, toolName: "Bash" });
}

const WINDOW_MS = 60 * 60 * 1000;

describe("bareSessionId", () => {
  it("strips cmux's agent prefix so a stream row joins a ps row", () => {
    expect(bareSessionId({ sessionId: "claude-a0000104-541a" })).toBe("a0000104-541a");
    expect(bareSessionId({ sessionId: "codex-a0000104-541a" })).toBe("a0000104-541a");
  });

  it("leaves an already-bare id alone", () => {
    expect(bareSessionId({ sessionId: "a0000104-541a" })).toBe("a0000104-541a");
  });

  it("answers undefined for an absent or empty id", () => {
    expect(bareSessionId({ sessionId: undefined })).toBeUndefined();
    expect(bareSessionId({ sessionId: "" })).toBeUndefined();
  });
});

describe("hookStreamReading", () => {
  it("joins a seat whose frame carried cmux's feed-form id by its bare uuid", () => {
    const uuid = "aaaabbbb-0000-0000-0000-000000000001";
    const line = JSON.stringify({
      id: "e1",
      name: "agent.hook.PreToolUse",
      occurred_at: new Date(BASE_MS).toISOString(),
      payload: { session_id: `cmux-feed-v1:Y2xhdWRl:${Buffer.from(uuid).toString("base64url")}`, tool_name: "Bash" },
      seq: 1,
      type: "event",
      workspace_id: "workspace-1",
    });

    const reading = hookStreamReading({ events: [parseEventFrame({ line })!], nowMs: BASE_MS, windowMs: WINDOW_MS });

    expect(reading.seats[0]!.sessionId).toBe(uuid);
  });

  it("measures the gap between consecutive tool calls, in seconds", () => {
    const reading = hookStreamReading({
      events: [
        preToolUse({ offsetSeconds: 0, seq: 1 }),
        preToolUse({ offsetSeconds: 8, seq: 2 }),
        preToolUse({ offsetSeconds: 20, seq: 3 }),
      ],
      nowMs: BASE_MS + 20_000,
      windowMs: WINDOW_MS,
    });
    const seat = reading.seats[0]!;
    expect(seat.firings).toBe(3);
    expect(seat.turnaround!.count).toBe(2);
    expect(seat.turnaround!.p50).toBe(8);
    expect(seat.turnaround!.max).toBe(12);
  });

  it("drops the gap that spans a turn boundary, so an idle night never lands in p95", () => {
    const reading = hookStreamReading({
      events: [
        preToolUse({ offsetSeconds: 0, seq: 1 }),
        frame({ name: "agent.hook.Stop", offsetSeconds: 10, seq: 2 }),
        preToolUse({ offsetSeconds: 36_000, seq: 3 }),
        preToolUse({ offsetSeconds: 36_005, seq: 4 }),
      ],
      nowMs: BASE_MS + 36_005_000,
      windowMs: WINDOW_MS,
    });
    const seat = reading.seats[0]!;
    expect(seat.firings).toBe(3);
    expect(seat.turnaround!.count).toBe(1);
    expect(seat.turnaround!.max).toBe(5);
  });

  it("ages an in-flight call against the caller's clock, and names the tool", () => {
    const reading = hookStreamReading({
      events: [preToolUse({ offsetSeconds: 0, seq: 1 })],
      nowMs: BASE_MS + 47_000,
      windowMs: WINDOW_MS,
    });
    const seat = reading.seats[0]!;
    expect(seat.inFlightSeconds).toBe(47);
    expect(seat.inFlightTool).toBe("Bash");
    expect(seat.turnaround).toBeUndefined();
  });

  it("closes an in-flight call out once a turn boundary followed it", () => {
    const reading = hookStreamReading({
      events: [preToolUse({ offsetSeconds: 0, seq: 1 }), frame({ name: "agent.hook.Stop", offsetSeconds: 5, seq: 2 })],
      nowMs: BASE_MS + 900_000,
      windowMs: WINDOW_MS,
    });
    expect(reading.seats[0]!.inFlightSeconds).toBeUndefined();
  });

  it("counts a frame once, from its received phase only", () => {
    const reading = hookStreamReading({
      events: [
        preToolUse({ offsetSeconds: 0, seq: 1 }),
        frame({ name: "agent.hook.PreToolUse", offsetSeconds: 0, phase: "completed", seq: 2, toolName: "Bash" }),
      ],
      nowMs: BASE_MS,
      windowMs: WINDOW_MS,
    });
    expect(reading.frames).toBe(1);
    expect(reading.seats[0]!.firings).toBe(1);
    expect(reading.byName).toEqual([{ count: 1, name: "agent.hook.PreToolUse" }]);
  });

  it("ignores a frame that is not a hook frame at all", () => {
    const reading = hookStreamReading({
      events: [
        frame({ name: "workspace.updated", offsetSeconds: 0, seq: 1 }),
        preToolUse({ offsetSeconds: 1, seq: 2 }),
      ],
      nowMs: BASE_MS + 1000,
      windowMs: WINDOW_MS,
    });
    expect(reading.frames).toBe(1);
    expect(reading.byName.map((row) => row.name)).toEqual(["agent.hook.PreToolUse"]);
  });

  it("separates seats by workspace and orders them busiest first", () => {
    const quiet = frame({
      name: "agent.hook.PreToolUse",
      offsetSeconds: 0,
      seq: 1,
      sessionId: "claude-quiet",
      toolName: "Read",
      workspaceId: "workspace-2",
    });
    const reading = hookStreamReading({
      events: [quiet, preToolUse({ offsetSeconds: 1, seq: 2 }), preToolUse({ offsetSeconds: 3, seq: 3 })],
      nowMs: BASE_MS + 3000,
      windowMs: WINDOW_MS,
    });
    expect(reading.seats.length).toBe(2);
    expect(reading.seats[0]!.workspaceId).toBe("workspace-1");
    expect(reading.seats[0]!.firings).toBe(2);
    expect(reading.seats[1]!.workspaceId).toBe("workspace-2");
    expect(reading.seats[0]!.sessionId).toBe("aaaabbbb-0000-0000-0000-000000000001");
  });

  it("counts an unattributable frame in byName and gives it no seat row", () => {
    // Built literally rather than through `frame`: a destructured default fires on an explicit
    // `undefined`, so the helper would hand back an attributable frame and the case would prove nothing.
    const orphan: CmuxEvent = {
      agentSource: undefined,
      category: "agent",
      cwd: undefined,
      id: "id-1",
      name: "agent.hook.PreToolUse",
      occurredAtIso: new Date(BASE_MS).toISOString(),
      phase: "received",
      seq: 1,
      sessionId: undefined,
      surfaceId: undefined,
      toolName: "Bash",
      workspaceId: undefined,
    };
    const reading = hookStreamReading({ events: [orphan], nowMs: BASE_MS, windowMs: WINDOW_MS });
    expect(reading.frames).toBe(1);
    expect(reading.seats).toEqual([]);
  });

  it("reports an empty window as zero frames and no seats, never as a quiet fleet", () => {
    const reading = hookStreamReading({ events: [], nowMs: BASE_MS, windowMs: WINDOW_MS });
    expect(reading.frames).toBe(0);
    expect(reading.seats).toEqual([]);
    expect(reading.byName).toEqual([]);
    expect(reading.windowMs).toBe(WINDOW_MS);
  });

  it("sorts each seat's own frames by seq, so a concatenated rotation cannot produce a negative gap", () => {
    const reading = hookStreamReading({
      events: [preToolUse({ offsetSeconds: 30, seq: 9 }), preToolUse({ offsetSeconds: 10, seq: 2 })],
      nowMs: BASE_MS + 30_000,
      windowMs: WINDOW_MS,
    });
    expect(reading.seats[0]!.turnaround!.max).toBe(20);
  });
});
