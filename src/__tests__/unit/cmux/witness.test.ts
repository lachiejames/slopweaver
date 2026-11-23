/** The three independent witnesses a spawn consults, and the order they are consulted in. */
import { describe, expect, it } from "vitest";

import type { CmuxEvent } from "../../../cmux/events.js";
import {
  firstWitness,
  witnessFromEvents,
  witnessFromRunningTurn,
  witnessFromScreen,
  witnessFromSubmitted,
} from "../../../cmux/witness.js";
import { CODEX_IDLE_AFTER_TURNS, CODEX_RUNNING } from "../../fixtures/codexTui.js";

/** One event for workspace `W1`, with everything irrelevant defaulted. */
function event({
  name,
  phase = "received",
  workspaceId = "W1",
}: {
  name: string;
  phase?: string;
  workspaceId?: string;
}): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: undefined,
    id: name,
    name,
    occurredAtIso: "2026-08-23T00:00:00.000Z",
    phase,
    seq: 1,
    sessionId: undefined,
    surfaceId: undefined,
    toolName: undefined,
    workspaceId,
  };
}

describe("witnessFromEvents", () => {
  it("confirms on a matching hook for the right workspace", () => {
    expect(
      witnessFromEvents({
        events: [event({ name: "agent.hook.SessionStart" })],
        names: ["agent.hook.SessionStart"],
        workspaceId: "W1",
      }),
    ).toEqual({ by: "event", confirmed: true });
  });

  it("ignores the same hook fired for a different workspace", () => {
    expect(
      witnessFromEvents({
        events: [event({ name: "agent.hook.SessionStart", workspaceId: "W2" })],
        names: ["agent.hook.SessionStart"],
        workspaceId: "W1",
      }),
    ).toBe(undefined);
  });

  it("ignores the completed phase, which is the same firing reported twice", () => {
    expect(
      witnessFromEvents({
        events: [event({ name: "agent.hook.SessionStart", phase: "completed" })],
        names: ["agent.hook.SessionStart"],
        workspaceId: "W1",
      }),
    ).toBe(undefined);
  });
});

/**
 * The comparison itself lives in `sendEvidence.ts` and is covered there; these cover the WRAPPING — that this
 * chain reports the right witness source for a verdict, and reports nothing for a decline.
 */
describe("witnessFromSubmitted", () => {
  const LONG = "/slopweaver:pickup a-very-long-slug that easily clears the forty-character corroboration floor";

  it("matches cmux's ellipsis-truncated record as a prefix of what was sent", () => {
    expect(witnessFromSubmitted({ expected: LONG, submitted: `${LONG.slice(0, 60)}…` })).toEqual({
      by: "submitted-message",
      confirmed: true,
    });
  });

  it("matches an untruncated record exactly, however short", () => {
    expect(witnessFromSubmitted({ expected: "run it", submitted: "run it" })).toEqual({
      by: "submitted-message",
      confirmed: true,
    });
  });

  it("does not confirm when cmux last delivered something else", () => {
    expect(witnessFromSubmitted({ expected: LONG, submitted: "a previous command entirely" })).toBe(undefined);
  });

  it("does not confirm when cmux has no record at all", () => {
    expect(witnessFromSubmitted({ expected: LONG, submitted: undefined })).toBe(undefined);
  });

  it("does not confirm on a short prefix, which would otherwise corroborate almost anything", () => {
    expect(witnessFromSubmitted({ expected: LONG, submitted: "/slop…" })).toBe(undefined);
  });
});

describe("witnessFromScreen", () => {
  it("confirms when the surface visibly shows the text, across a wrap", () => {
    expect(witnessFromScreen({ expected: "run it now", screen: "> run it\n  now\n" })).toEqual({
      by: "screen",
      confirmed: true,
    });
  });

  it("does not confirm on an unreadable screen", () => {
    expect(witnessFromScreen({ expected: "run it", screen: undefined })).toBe(undefined);
  });
});

describe("firstWitness", () => {
  const common = {
    eventNames: ["agent.hook.UserPromptSubmit"],
    expected: "run it",
    host: "claude-code" as const,
    workspaceId: "W1",
  };

  it("prefers the event over both the delivery record and the screen", () => {
    expect(
      firstWitness({
        ...common,
        events: [event({ name: "agent.hook.UserPromptSubmit" })],
        screen: "run it",
        submitted: "run it",
      }),
    ).toEqual({ by: "event", confirmed: true });
  });

  it("prefers the delivery record over the screen when no event has arrived", () => {
    expect(firstWitness({ ...common, events: [], screen: "run it", submitted: "run it" })).toEqual({
      by: "submitted-message",
      confirmed: true,
    });
  });

  it("falls through to the screen when neither of the other two answers", () => {
    expect(firstWitness({ ...common, events: [], screen: "> run it", submitted: undefined })).toEqual({
      by: "screen",
      confirmed: true,
    });
  });

  it("confirms nothing when no source does", () => {
    expect(firstWitness({ ...common, events: [], screen: "$ ", submitted: undefined })).toBe(undefined);
  });

  // Measured on cmux 0.65.2: the footer read `esc to interrupt` on the first read after the Enter that took,
  // 3.7 s before the `UserPromptSubmit` event arrived.
  it("confirms from a running turn when no event or delivery record has answered yet", () => {
    const screen = "❯ \n⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt";
    expect(firstWitness({ ...common, events: [], screen, submitted: undefined })).toEqual({
      by: "running-turn",
      confirmed: true,
    });
  });

  it("asks the running turn before the line on the screen, and after cmux's delivery record", () => {
    const screen = "> run it · esc to interrupt";
    expect(firstWitness({ ...common, events: [], screen, submitted: undefined })!.by).toBe("running-turn");
    expect(firstWitness({ ...common, events: [], screen, submitted: "run it" })!.by).toBe("submitted-message");
  });
});

describe("witnessFromRunningTurn", () => {
  it("says nothing of an idle prompt or an unreadable screen", () => {
    const idle = "❯ \n⏵⏵ bypass permissions on (shift+tab to cycle)";
    expect(witnessFromRunningTurn({ host: "claude-code", screen: idle })).toBe(undefined);
    expect(witnessFromRunningTurn({ host: "claude-code", screen: undefined })).toBe(undefined);
  });

  // Codex's status line, measured live: a fresh codex seat working its pickup is witnessed by it.
  it("witnesses a fresh codex seat by its measured running status line", () => {
    expect(witnessFromRunningTurn({ host: "codex", screen: CODEX_RUNNING })).toEqual({
      by: "running-turn",
      confirmed: true,
    });
  });

  it("does not witness a codex seat at rest", () => {
    expect(witnessFromRunningTurn({ host: "codex", screen: CODEX_IDLE_AFTER_TURNS })).toBe(undefined);
  });
});
