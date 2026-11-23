/** Folding cmux events into per-session state, and classifying the result against a clock. */
import { describe, expect, it } from "vitest";

import type { CmuxEvent } from "../../../cmux/events.js";
import { classifySession, foldSessionActivity } from "../../../cmux/sessionActivity.js";

/** One event, with everything but the fields under test defaulted. */
function event({
  name,
  seq,
  atIso,
  workspaceId = "W1",
  phase = "received",
}: {
  name: string;
  seq: number;
  atIso: string;
  workspaceId?: string | undefined;
  phase?: string;
}): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: "/repo/a",
    id: `e${String(seq)}`,
    name,
    occurredAtIso: atIso,
    phase,
    seq,
    sessionId: "claude-abc",
    surfaceId: undefined,
    toolName: undefined,
    workspaceId,
  };
}

describe("foldSessionActivity", () => {
  it("records when a turn started and ended", () => {
    const folded = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.UserPromptSubmit", seq: 1 }),
        event({ atIso: "2026-08-23T00:01:00.000Z", name: "agent.hook.Stop", seq: 2 }),
      ],
    });

    expect(folded["W1"]!.lastTurnStartedAtIso).toBe("2026-08-23T00:00:00.000Z");
    expect(folded["W1"]!.lastTurnEndedAtIso).toBe("2026-08-23T00:01:00.000Z");
    expect(folded["W1"]!.lastSeq).toBe(2);
  });

  it("keeps the agent CLI a hook named as the seat's host through a later frame that names none", () => {
    const folded = foldSessionActivity({
      events: [
        {
          ...event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 1 }),
          agentSource: "codex",
        },
        event({ atIso: "2026-08-23T00:01:00.000Z", name: "agent.hook.Stop", seq: 2 }),
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Stop", seq: 3, workspaceId: "W2" }),
      ],
    });

    expect([folded["W1"]!.agentSource, folded["W2"]!.agentSource]).toEqual(["codex", undefined]);
  });

  it("keeps a session id through a frame naming none, but never across a SessionStart that names none", () => {
    const folded = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 1 }),
        { ...event({ atIso: "2026-08-23T00:01:00.000Z", name: "agent.hook.Stop", seq: 2 }), sessionId: undefined },
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 3, workspaceId: "W2" }),
        {
          ...event({ atIso: "2026-08-23T00:02:00.000Z", name: "agent.hook.SessionStart", seq: 4, workspaceId: "W2" }),
          sessionId: undefined,
        },
      ],
    });

    expect([folded["W1"]!.agentSessionId, folded["W2"]!.agentSessionId]).toEqual(["claude-abc", undefined]);
  });

  it("reads an empty session id as none: a start naming one clears the id, any other frame keeps it", () => {
    const folded = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 1 }),
        { ...event({ atIso: "2026-08-23T00:01:00.000Z", name: "agent.hook.Stop", seq: 2 }), sessionId: "" },
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 3, workspaceId: "W2" }),
        {
          ...event({ atIso: "2026-08-23T00:02:00.000Z", name: "agent.hook.SessionStart", seq: 4, workspaceId: "W2" }),
          sessionId: "",
        },
      ],
    });

    expect([folded["W1"]!.agentSessionId, folded["W2"]!.agentSessionId]).toEqual(["claude-abc", undefined]);
  });

  it("drops an empty id a fold persisted before it was read as none, on the next frame naming no session", () => {
    const persisted = {
      ...foldSessionActivity({
        events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 1 })],
      })["W1"]!,
      agentSessionId: "",
    };
    const folded = foldSessionActivity({
      events: [
        { ...event({ atIso: "2026-08-23T00:01:00.000Z", name: "agent.hook.Stop", seq: 2 }), sessionId: undefined },
      ],
      prior: { W1: persisted },
    });

    expect(folded["W1"]!.agentSessionId).toBe(undefined);
  });

  it("never moves a session id on a completed half, so a late one from an older start cannot replace the newer id", () => {
    const folded = foldSessionActivity({
      events: [
        { ...event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.SessionStart", seq: 1 }), sessionId: "B" },
        {
          ...event({ atIso: "2026-08-23T00:00:01.000Z", name: "agent.hook.SessionStart", phase: "completed", seq: 2 }),
          sessionId: "A",
        },
        {
          ...event({ atIso: "2026-08-23T00:00:02.000Z", name: "agent.hook.SessionStart", phase: "completed", seq: 3 }),
          sessionId: undefined,
        },
      ],
    });

    expect(folded["W1"]!.agentSessionId).toBe("B");
  });

  it("counts a tool call once, not twice, despite cmux emitting both phases", () => {
    const folded = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.PreToolUse", seq: 1 }),
        event({ atIso: "2026-08-23T00:00:00.100Z", name: "agent.hook.PreToolUse", phase: "completed", seq: 2 }),
      ],
    });

    expect(folded["W1"]!.toolCalls).toBe(1);
  });

  it("raises attention on a notification and clears it the moment the session moves again", () => {
    const withNotification = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Notification", seq: 1 })],
    });
    const resumed = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:05:00.000Z", name: "agent.hook.PreToolUse", seq: 2 })],
      prior: withNotification,
    });

    expect(withNotification["W1"]!.attentionKind).toBe("notification");
    expect(withNotification["W1"]!.attentionSinceIso).toBe("2026-08-23T00:00:00.000Z");
    expect(resumed["W1"]!.attentionSinceIso).toBe(undefined);
    expect(resumed["W1"]!.attentionKind).toBe(undefined);
  });

  it("keeps an unanswered attention across a later batch that never mentions that workspace", () => {
    const withNotification = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Notification", seq: 1 })],
    });
    const nextBatch = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:05:00.000Z", name: "agent.hook.Stop", seq: 2, workspaceId: "W2" })],
      prior: withNotification,
    });

    expect(nextBatch["W1"]!.attentionKind).toBe("notification");
    expect(nextBatch["W1"]!.attentionSinceIso).toBe("2026-08-23T00:00:00.000Z");
  });

  it("distinguishes a question from a plain notification", () => {
    const folded = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.AskUserQuestion", seq: 1 })],
    });

    expect(folded["W1"]!.attentionKind).toBe("question");
  });

  it("keeps sessions apart, and skips an event that names no workspace at all", () => {
    const folded = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Stop", seq: 1 }),
        event({ atIso: "2026-08-23T00:00:01.000Z", name: "agent.hook.Stop", seq: 2, workspaceId: "W2" }),
        event({ atIso: "2026-08-23T00:00:02.000Z", name: "sidebar.metadata.updated", seq: 3, workspaceId: undefined }),
      ],
    });

    expect(Object.keys(folded).toSorted()).toEqual(["W1", "W2"]);
  });
});

describe("classifySession", () => {
  const base = foldSessionActivity({
    events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Stop", seq: 1 })],
  })["W1"]!;

  it("reports needs-input whenever attention is outstanding, however recent the activity", () => {
    const waiting = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Notification", seq: 1 })],
    })["W1"]!;

    expect(classifySession({ activity: waiting, idleAfterMs: 600_000, nowIso: "2026-08-23T00:00:01.000Z" })).toBe(
      "needs-input",
    );
  });

  it("reports working while the session is still inside the quiet window", () => {
    expect(classifySession({ activity: base, idleAfterMs: 600_000, nowIso: "2026-08-23T00:01:00.000Z" })).toBe(
      "working",
    );
  });

  it("reports idle for a session that finished its turn and went quiet", () => {
    expect(classifySession({ activity: base, idleAfterMs: 600_000, nowIso: "2026-08-23T01:00:00.000Z" })).toBe("idle");
  });

  it("reports silent for a session that went quiet WITHOUT ever finishing a turn", () => {
    const wedged = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.PreToolUse", seq: 1 })],
    })["W1"]!;

    expect(classifySession({ activity: wedged, idleAfterMs: 600_000, nowIso: "2026-08-23T01:00:00.000Z" })).toBe(
      "silent",
    );
  });
});
