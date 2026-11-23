import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { gaugeUnreadableEvent, rotationEvent } from "../../../claude/events.js";
import { parseSupervisorEvent, severityOf, supervisorEventLine } from "../../../events/event.js";

const NOW = "2026-09-04T00:00:00.000Z";

describe("rotationEvent", () => {
  it("says nothing at all when the fleet stays put", () => {
    const event = rotationEvent({ decision: { kind: "stay", on: "plan-one", reason: "headroom" }, nowIso: NOW });
    expect(event).toBe(undefined);
  });

  it("publishes a rotation as info, naming both plans and why the others were held", () => {
    const event = rotationEvent({
      decision: {
        excluded: [{ alias: "plan-one", kind: "provider-refused", reason: "five_hour refused" }],
        from: "plan-one",
        kind: "rotate",
        to: "plan-two",
      },
      nowIso: NOW,
    })!;
    expect(event.kind).toBe("rotated");
    expect(event.alias).toBe("plan-two");
    expect(event.fromAlias).toBe("plan-one");
    expect(event.why).toBe("the fleet moved off plan-one onto plan-two — held out: plan-one (five_hour refused)");
    expect(severityOf({ event })).toBe("info");
  });

  it("handles a first-ever selection with no plan to leave", () => {
    const event = rotationEvent({ decision: { excluded: [], kind: "rotate", to: "plan-one" }, nowIso: NOW })!;
    expect(event.why).toBe("the fleet moved onto plan-one");
    expect(event.fromAlias).toBe(undefined);
  });

  it("caps the named exclusions so one sentence stays one sentence", () => {
    const excluded = ["a", "b", "c", "d", "e"].map((alias) => ({
      alias,
      kind: "provider-refused" as const,
      reason: "five_hour refused",
    }));
    const event = rotationEvent({ decision: { excluded, kind: "rotate", to: "plan-nine" }, nowIso: NOW })!;
    expect(event.why).toContain("and 2 more");
    expect(event.why).not.toContain("d (");
  });

  it("raises all-exhausted as an alert carrying when the fleet comes back", () => {
    const event = rotationEvent({
      decision: {
        earliestResetIso: "2026-09-04T04:50:00.000Z",
        excluded: [{ alias: "plan-one", kind: "provider-refused", reason: "five_hour refused" }],
        kind: "all-exhausted",
      },
      nowIso: NOW,
    })!;
    expect(event.kind).toBe("all-exhausted");
    expect(event.earliestResetIso).toBe("2026-09-04T04:50:00.000Z");
    expect(event.why).toContain("earliest reset 2026-09-04T04:50:00.000Z");
    expect(severityOf({ event })).toBe("alert");
  });

  it("says so plainly when exhaustion carries no known reset", () => {
    const event = rotationEvent({ decision: { excluded: [], kind: "all-exhausted" }, nowIso: NOW })!;
    expect(event.why).toContain("no reset is known");
  });
});

describe("gaugeUnreadableEvent", () => {
  it("is an alert naming the field that stopped it", () => {
    const event = gaugeUnreadableEvent({
      error: ClaudeRotationErrors.usageShapeChanged({ field: "anthropic-ratelimit-unified-5h-status" }),
      nowIso: NOW,
    });
    expect(event.kind).toBe("gauge-unreadable");
    expect(severityOf({ event })).toBe("alert");
    expect(event.why).toContain("anthropic-ratelimit-unified-5h-status");
  });
});

describe("the stream round-trip", () => {
  it("survives being written and read back by the stream's own codec", () => {
    const event = rotationEvent({
      decision: { excluded: [], from: "plan-one", kind: "rotate", to: "plan-two" },
      nowIso: NOW,
    })!;
    const parsed = parseSupervisorEvent({ line: supervisorEventLine({ event }) })!;
    expect(parsed).toStrictEqual(event);
    expect(severityOf({ event: parsed })).toBe("info");
  });

  it("round-trips an exhaustion alert with its reset intact", () => {
    const event = rotationEvent({
      decision: { earliestResetIso: "2026-09-04T04:50:00.000Z", excluded: [], kind: "all-exhausted" },
      nowIso: NOW,
    })!;
    const parsed = parseSupervisorEvent({ line: supervisorEventLine({ event }) })!;
    expect(parsed).toStrictEqual(event);
  });

  it("refuses a claude-rotation line whose kind this build does not know", () => {
    const line = JSON.stringify({ atIso: NOW, kind: "invented", source: "claude-rotation", why: "x" });
    expect(parseSupervisorEvent({ line })).toBe(undefined);
  });
});
