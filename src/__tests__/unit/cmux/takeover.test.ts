/**
 * The successor-takeover sequence's pure checks — cmux itself enforces none of them.
 *
 * deleted-with-code: resolvePredecessor
 */
import { describe, expect, it } from "vitest";

import type { CmuxEvent } from "../../../cmux/events.js";
import {
  type HookLeg,
  hookLegOfDrain,
  predecessorRunNotFinishedRefusal,
  retainedWindowCursor,
  SWEEP_ARM_TOOL_NAME,
  sweepArmedInEvents,
  sweepArmedInTranscript,
  sweepGateOutcome,
  type TranscriptLeg,
} from "../../../cmux/takeover.js";
import type { ToolUseBlock, TranscriptRecord, TranscriptRole } from "../../../transcripts/record.js";

/** One event, with everything but the fields under test defaulted. */
function event(over: Partial<CmuxEvent> & { name: string; seq: number }): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: "/repo",
    id: `e${String(over.seq)}`,
    occurredAtIso: "2026-08-28T19:30:00.000Z",
    phase: "received",
    sessionId: "claude-abc",
    surfaceId: undefined,
    toolName: undefined,
    workspaceId: "own",
    ...over,
  };
}

describe("sweepArmedInEvents", () => {
  it("is armed by a PreToolUse naming ScheduleWakeup for this workspace", () => {
    const events = [event({ name: "agent.hook.PreToolUse", seq: 1, toolName: SWEEP_ARM_TOOL_NAME })];

    expect(sweepArmedInEvents({ events, workspaceId: "own" })).toBe(true);
  });

  it("is not armed by a ScheduleWakeup call on a DIFFERENT workspace", () => {
    const events = [
      event({ name: "agent.hook.PreToolUse", seq: 1, toolName: SWEEP_ARM_TOOL_NAME, workspaceId: "other" }),
    ];

    expect(sweepArmedInEvents({ events, workspaceId: "own" })).toBe(false);
  });

  it("is not armed by a PreToolUse naming a different tool", () => {
    const events = [event({ name: "agent.hook.PreToolUse", seq: 1, toolName: "Bash" })];

    expect(sweepArmedInEvents({ events, workspaceId: "own" })).toBe(false);
  });

  it("ignores the completed phase of the same firing", () => {
    const events = [
      event({ name: "agent.hook.PreToolUse", phase: "completed", seq: 1, toolName: SWEEP_ARM_TOOL_NAME }),
    ];

    expect(sweepArmedInEvents({ events, workspaceId: "own" })).toBe(false);
  });

  it("is not armed with no qualifying event at all", () => {
    expect(sweepArmedInEvents({ events: [], workspaceId: "own" })).toBe(false);
  });
});

describe("retainedWindowCursor", () => {
  it("starts just before the oldest retained frame, never at seq 0", () => {
    expect(retainedWindowCursor({ oldestSeq: 1_131_782 })).toEqual({ afterSeq: 1_131_781 });
  });

  it("starts at 0 only when cmux still holds seq 1", () => {
    expect(retainedWindowCursor({ oldestSeq: 1 })).toEqual({ afterSeq: 0 });
  });

  it("refuses an ack with no oldest_seq rather than substituting 0", () => {
    expect(retainedWindowCursor({ oldestSeq: undefined })).toEqual({
      unusable: "cmux's ack carried no usable oldest_seq (undefined)",
    });
  });

  it("refuses an oldest_seq of 0, which leaves no cursor below it", () => {
    expect(retainedWindowCursor({ oldestSeq: 0 })).toEqual({ unusable: "cmux's ack carried no usable oldest_seq (0)" });
  });

  it("refuses an oldest_seq too large to subtract one from exactly", () => {
    expect(retainedWindowCursor({ oldestSeq: 1e308 })).toEqual({
      unusable: "cmux's ack carried no usable oldest_seq (1e+308)",
    });
  });

  it("refuses a fractional oldest_seq", () => {
    expect(retainedWindowCursor({ oldestSeq: 1.5 })).toEqual({
      unusable: "cmux's ack carried no usable oldest_seq (1.5)",
    });
  });
});

describe("hookLegOfDrain", () => {
  it("is a witness on a match", () => {
    expect(hookLegOfDrain({ matched: true, oldestSeq: 9, windowStartIso: undefined })).toEqual({ kind: "witnessed" });
  });

  it("is a negative over the window the drain saw, naming its oldest seq and earliest instant", () => {
    expect(
      hookLegOfDrain({ matched: false, oldestSeq: 1_131_782, windowStartIso: "2026-10-15T08:09:15.865Z" }),
    ).toEqual({ kind: "window-no", oldestSeq: 1_131_782, windowStartIso: "2026-10-15T08:09:15.865Z" });
  });

  it("is unreadable when the drain's ack never said where the window starts", () => {
    expect(hookLegOfDrain({ matched: false, oldestSeq: undefined, windowStartIso: undefined })).toEqual({
      kind: "unreadable",
      why: "cmux's ack carried no usable oldest_seq (undefined) on the drain, so the window it searched is unknown",
    });
  });

  it("is unreadable when the drain's ack carries an oldest_seq no window can start at", () => {
    expect(hookLegOfDrain({ matched: false, oldestSeq: 0, windowStartIso: undefined })).toEqual({
      kind: "unreadable",
      why: "cmux's ack carried no usable oldest_seq (0) on the drain, so the window it searched is unknown",
    });
  });
});

/** One `tool_use` block naming a tool. */
function use({ name }: { name: string }): ToolUseBlock {
  return { command: "", name, skill: "", toolUseId: `call-${name}` };
}

/** One decoded record, with everything but the fields under test defaulted to an ordinary assistant turn. */
function record({
  at,
  line,
  role = "assistant",
  sidechain = false,
  uses = [],
}: {
  at: string;
  line: number;
  role?: TranscriptRole;
  sidechain?: boolean;
  uses?: readonly ToolUseBlock[];
}): TranscriptRecord {
  return {
    blockKinds: uses.map(() => "tool_use"),
    cwd: "",
    hasToolUseResult: false,
    isCompactSummary: false,
    isMeta: false,
    isSidechain: sidechain,
    lineNumber: line,
    model: "claude-fable-5-1",
    originKind: "",
    promptSource: "",
    role,
    text: "",
    timestamp: at,
    toolResults: [],
    toolUses: uses,
    uuid: "",
  };
}

const ARM = use({ name: SWEEP_ARM_TOOL_NAME });
const T0 = "2026-10-09T19:53:45.000Z";
const T1 = "2026-10-09T19:59:01.000Z";

describe("sweepArmedInTranscript", () => {
  it("witnesses a non-sidechain assistant record calling ScheduleWakeup at the session's first instant", () => {
    const records = [record({ at: T0, line: 1, uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toEqual({ lineNumber: 1 });
  });

  it("uses the first parseable timestamp as the floor after untimed leading records", () => {
    const records = [
      record({ at: "", line: 1 }),
      record({ at: "yesterday", line: 2 }),
      record({ at: T0, line: 3, uses: [ARM] }),
    ];

    expect(sweepArmedInTranscript({ records })).toEqual({ lineNumber: 3 });
  });

  it("returns the exact line of the first qualifying record after the start", () => {
    const records = [
      record({ at: T0, line: 1, role: "user" }),
      record({ at: T0, line: 2, uses: [use({ name: "Bash" })] }),
      record({ at: T1, line: 9, uses: [use({ name: "Bash" }), ARM] }),
      record({ at: T1, line: 12, uses: [ARM] }),
    ];

    expect(sweepArmedInTranscript({ records })).toEqual({ lineNumber: 9 });
  });

  it("does not count a user record, whatever blocks it carries", () => {
    const records = [record({ at: T0, line: 1, role: "user", uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("does not count a subagent's own turn", () => {
    const records = [record({ at: T0, line: 1 }), record({ at: T1, line: 2, sidechain: true, uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("does not count a call to a different tool", () => {
    const records = [record({ at: T0, line: 1, uses: [use({ name: "Bash" }), use({ name: "Skill" })] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("does not count a call whose instant is before the session's first parseable timestamp", () => {
    const records = [record({ at: T1, line: 1 }), record({ at: T0, line: 2, uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("finds nothing in an empty transcript", () => {
    expect(sweepArmedInTranscript({ records: [] })).toBeUndefined();
  });

  it("finds nothing when no record carries a parseable timestamp, so there is no floor", () => {
    const records = [record({ at: "", line: 1, uses: [ARM] }), record({ at: "yesterday", line: 2, uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("does not count a candidate with no parseable timestamp after a valid floor", () => {
    const records = [record({ at: T0, line: 1 }), record({ at: "", line: 2, uses: [ARM] })];

    expect(sweepArmedInTranscript({ records })).toBeUndefined();
  });

  it("stops reading at the first witness", () => {
    let yielded = 0;
    /** Three records, counting how many the predicate pulled before it stopped. */
    function* records(): Generator<TranscriptRecord> {
      const all = [record({ at: T0, line: 1 }), record({ at: T1, line: 2, uses: [ARM] }), record({ at: T1, line: 3 })];
      for (const one of all) {
        yielded += 1;
        yield one;
      }
    }

    const witness = sweepArmedInTranscript({ records: records() });

    expect(witness).toEqual({ lineNumber: 2 });
    expect(yielded).toBe(2);
  });
});

const WITNESSED_HOOK: HookLeg = { kind: "witnessed" };
const WINDOW_NO: HookLeg = { kind: "window-no", oldestSeq: 1_131_782, windowStartIso: "2026-10-15T08:09:15.865Z" };
const WINDOW_NO_TEXT =
  "no ScheduleWakeup event in cmux's retained window (oldest seq 1131782, earliest replayed 2026-10-15T08:09:15.865Z)";
const WITNESSED_TRANSCRIPT: TranscriptLeg = { kind: "witnessed", lineNumber: 7 };
const NOT_ARMED =
  "neither this session's own hook events nor its transcript show a ScheduleWakeup call yet — arm the § 7 sweep " +
  "before taking over the pin, so a predecessor that might still be the only one actually watching the fleet is " +
  "never displaced";

describe("sweepGateOutcome", () => {
  it("passes on the hook event alone, saying the transcript was not read", () => {
    expect(sweepGateOutcome({ evidence: { hook: WITNESSED_HOOK } })).toEqual({
      armed: true,
      witness: "ScheduleWakeup PreToolUse event; transcript: not read, the hook event decided",
    });
  });

  it("keeps hook-event precedence when both witnesses exist, naming both", () => {
    expect(sweepGateOutcome({ evidence: { hook: WITNESSED_HOOK, transcript: WITNESSED_TRANSCRIPT } })).toEqual({
      armed: true,
      witness: "ScheduleWakeup PreToolUse event; transcript: ScheduleWakeup tool_use at line 7",
    });
  });

  it("passes on the transcript after a hook miss, naming the line and the window the drain searched", () => {
    expect(sweepGateOutcome({ evidence: { hook: WINDOW_NO, transcript: WITNESSED_TRANSCRIPT } })).toEqual({
      armed: true,
      witness: `ScheduleWakeup tool_use at line 7; hook events: ${WINDOW_NO_TEXT}`,
    });
  });

  it("passes on the transcript when the hook drain itself failed, naming the failure", () => {
    const hook: HookLeg = { kind: "unreadable", why: "socket closed" };

    expect(sweepGateOutcome({ evidence: { hook, transcript: WITNESSED_TRANSCRIPT } })).toEqual({
      armed: true,
      witness: "ScheduleWakeup tool_use at line 7; hook events: unreadable: socket closed",
    });
  });

  it("refuses a negative on both legs, naming the window and the full read", () => {
    expect(sweepGateOutcome({ evidence: { hook: WINDOW_NO, transcript: { kind: "no-tool-use" } } })).toEqual({
      armed: false,
      refusal: `${NOT_ARMED} — hook events: no ScheduleWakeup event in cmux's retained window (oldest seq 1131782, earliest replayed 2026-10-15T08:09:15.865Z); transcript: no ScheduleWakeup tool_use, fully read`,
    });
  });

  it("names only the oldest seq when the drain replayed no frame at all", () => {
    const hook: HookLeg = { kind: "window-no", oldestSeq: 1_131_782, windowStartIso: undefined };

    expect(sweepGateOutcome({ evidence: { hook, transcript: { kind: "no-tool-use" } } })).toEqual({
      armed: false,
      refusal: `${NOT_ARMED} — hook events: no ScheduleWakeup event in cmux's retained window (oldest seq 1131782); transcript: no ScheduleWakeup tool_use, fully read`,
    });
  });

  it("refuses a hook miss beside an unreadable transcript, naming why it was not read", () => {
    const transcript: TranscriptLeg = { kind: "unread", why: "this process carries no CLAUDE_CODE_SESSION_ID" };

    expect(sweepGateOutcome({ evidence: { hook: WINDOW_NO, transcript } })).toEqual({
      armed: false,
      refusal: `${NOT_ARMED} — hook events: ${WINDOW_NO_TEXT}; transcript: not read: this process carries no CLAUDE_CODE_SESSION_ID`,
    });
  });

  it("refuses a failed hook drain beside a negative transcript", () => {
    const hook: HookLeg = { kind: "unreadable", why: "socket closed" };

    expect(sweepGateOutcome({ evidence: { hook, transcript: { kind: "no-tool-use" } } })).toEqual({
      armed: false,
      refusal: `${NOT_ARMED} — hook events: unreadable: socket closed; transcript: no ScheduleWakeup tool_use, fully read`,
    });
  });

  it("refuses an incomplete negative read, listing the problems", () => {
    const transcript: TranscriptLeg = { kind: "incomplete", problems: ["short read at 4096", "invalid UTF-8 at 8192"] };

    expect(sweepGateOutcome({ evidence: { hook: WINDOW_NO, transcript } })).toEqual({
      armed: false,
      refusal: `${NOT_ARMED} — hook events: ${WINDOW_NO_TEXT}; transcript: no ScheduleWakeup tool_use, read incomplete: short read at 4096; invalid UTF-8 at 8192`,
    });
  });
});

describe("predecessorRunNotFinishedRefusal", () => {
  it("refuses when the predecessor has no slug on record", () => {
    const refusal = predecessorRunNotFinishedRefusal({
      predecessorRef: "workspace:2",
      runPhase: undefined,
      slug: undefined,
    });

    expect(refusal).toContain("not registered against a handover slug");
  });

  it("refuses when the slug's run has not reached closed", () => {
    const refusal = predecessorRunNotFinishedRefusal({
      predecessorRef: "workspace:2",
      runPhase: "open",
      slug: "fresh-supervisor-handoff-9004",
    });

    expect(refusal).toContain('"fresh-supervisor-handoff-9004"');
  });

  it("names the phase the slug's run stands at", () => {
    const refusal = predecessorRunNotFinishedRefusal({
      predecessorRef: "workspace:2",
      runPhase: "open",
      slug: "fresh-supervisor-handoff-9004",
    });

    expect(refusal).toBe(
      'workspace:2\'s run "fresh-supervisor-handoff-9004" has not reached a terminal phase — finished, abandoned, closed or orphaned (phase: open) — ' +
        "refusing to close a session whose own run is still open",
    );
  });

  it("says the slug has no run at all when it has no run journal", () => {
    const refusal = predecessorRunNotFinishedRefusal({
      predecessorRef: "workspace:2",
      runPhase: undefined,
      slug: "fresh-supervisor-handoff-9004",
    });

    expect(refusal).toBe(
      'workspace:2\'s run "fresh-supervisor-handoff-9004" has not reached a terminal phase — finished, abandoned, closed or orphaned (phase: no run) — ' +
        "refusing to close a session whose own run is still open",
    );
  });

  it("proceeds once the slug's run has reached closed", () => {
    const refusal = predecessorRunNotFinishedRefusal({
      predecessorRef: "workspace:2",
      runPhase: "closed",
      slug: "fresh-supervisor-handoff-9004",
    });

    expect(refusal).toBeUndefined();
  });
});
