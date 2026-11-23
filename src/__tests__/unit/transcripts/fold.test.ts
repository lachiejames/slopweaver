/**
 * The counting half: what a transcript says about its own shape, and which tool calls came back errors.
 */
import { describe, expect, it } from "vitest";

import { failedToolResults, mergeSummaries, summariseReadings } from "../../../transcripts/fold.js";
import { type LineReading, readTranscriptLine } from "../../../transcripts/record.js";

/** Turn fixture lines into readings the same way the streaming shell does. */
function readings({ lines }: { lines: readonly string[] }): readonly LineReading[] {
  return lines.map((line, index) => readTranscriptLine({ line, lineNumber: index + 1 }));
}

const HUMAN = JSON.stringify({
  cwd: "/repo",
  message: { content: "do the thing", role: "user" },
  origin: { kind: "human" },
  promptSource: "typed",
  timestamp: "2026-08-27T10:00:00.000Z",
  type: "user",
});

const CALL = JSON.stringify({
  message: {
    content: [{ id: "t1", input: {}, name: "Bash", type: "tool_use" }],
    model: "claude-opus-5",
    role: "assistant",
  },
  timestamp: "2026-08-27T10:00:01.000Z",
  type: "assistant",
});

const FAILURE = JSON.stringify({
  message: {
    content: [{ content: "Exit code 1", is_error: true, tool_use_id: "t1", type: "tool_result" }],
    role: "user",
  },
  timestamp: "2026-08-27T10:00:02.000Z",
  type: "user",
});

const SUCCESS = JSON.stringify({
  message: { content: [{ content: "ok", is_error: false, tool_use_id: "t9", type: "tool_result" }], role: "user" },
  timestamp: "2026-08-27T10:00:03.000Z",
  type: "user",
});

describe("summariseReadings", () => {
  it("counts every role, the tool traffic and the span", () => {
    const summary = summariseReadings({
      readings: readings({ lines: [HUMAN, CALL, FAILURE, SUCCESS, JSON.stringify({ type: "ai-title" })] }),
    });
    expect(summary).toStrictEqual({
      assistantTurns: 1,
      cwd: "/repo",
      firstIso: "2026-08-27T10:00:00.000Z",
      humanTurns: 1,
      lastIso: "2026-08-27T10:00:03.000Z",
      lineCount: 5,
      models: ["claude-opus-5"],
      sidechainRecords: 0,
      stripped: { "tool-result": 2 },
      toolErrors: 1,
      toolResults: 2,
      undecodedLines: 1,
    });
  });

  it("reports an empty transcript as empty rather than as anything else", () => {
    const summary = summariseReadings({ readings: [] });
    expect(summary.lineCount).toBe(0);
    expect(summary.humanTurns).toBe(0);
    expect(summary.firstIso).toBe("");
    expect(summary.models).toStrictEqual([]);
  });

  it("counts a malformed line as undecoded rather than throwing on it", () => {
    const summary = summariseReadings({ readings: readings({ lines: ['{"type":"user"', HUMAN] }) });
    expect(summary.undecodedLines).toBe(1);
    expect(summary.humanTurns).toBe(1);
  });

  it("counts a subagent's records separately from the main thread's", () => {
    const sidechain = JSON.stringify({
      isSidechain: true,
      message: { content: [], model: "claude-sonnet-5", role: "assistant" },
      type: "assistant",
    });
    expect(summariseReadings({ readings: readings({ lines: [sidechain] }) }).sidechainRecords).toBe(1);
  });
});

describe("failedToolResults", () => {
  it("names the failing call with the tool that made it", () => {
    expect(failedToolResults({ readings: readings({ lines: [CALL, FAILURE, SUCCESS] }) })).toStrictEqual([
      {
        lineNumber: 2,
        text: "Exit code 1",
        timestamp: "2026-08-27T10:00:02.000Z",
        tool: "Bash",
        toolUseId: "t1",
      },
    ]);
  });

  it("leaves the tool empty rather than guessing when the call is outside the lines read", () => {
    expect(failedToolResults({ readings: readings({ lines: [FAILURE] }) })[0]!.tool).toBe("");
  });

  it("returns nothing when every result succeeded", () => {
    expect(failedToolResults({ readings: readings({ lines: [CALL, SUCCESS] }) })).toStrictEqual([]);
  });
});

describe("mergeSummaries", () => {
  it("sums the counts and unions the span and the models", () => {
    const one = summariseReadings({ readings: readings({ lines: [HUMAN, CALL] }) });
    const two = summariseReadings({ readings: readings({ lines: [FAILURE] }) });
    const merged = mergeSummaries({ summaries: [two, one] });
    expect(merged).toStrictEqual({
      assistantTurns: 1,
      cwd: "",
      firstIso: "2026-08-27T10:00:00.000Z",
      humanTurns: 1,
      lastIso: "2026-08-27T10:00:02.000Z",
      lineCount: 3,
      models: ["claude-opus-5"],
      sidechainRecords: 0,
      stripped: { "tool-result": 1 },
      toolErrors: 1,
      toolResults: 1,
      undecodedLines: 0,
    });
  });

  it("merges nothing into an empty summary rather than into a zero-epoch span", () => {
    const merged = mergeSummaries({ summaries: [] });
    expect(merged.lineCount).toBe(0);
    expect(merged.firstIso).toBe("");
    expect(merged.lastIso).toBe("");
  });
});
