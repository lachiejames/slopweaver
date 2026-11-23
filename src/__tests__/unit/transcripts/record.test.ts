/**
 * Line decoding: both content shapes, the tool blocks, and every way a line yields no record at all.
 */
import { describe, expect, it } from "vitest";

import { decodeContent, readTranscriptLine, type TranscriptRecord } from "../../../transcripts/record.js";

/** Decode through the real parser, failing the test if the line yielded no record. */
function decode({ line }: { line: string }): TranscriptRecord {
  const reading = readTranscriptLine({ line, lineNumber: 7 });
  expect("record" in reading).toBe(true);
  return (reading as { readonly record: TranscriptRecord }).record;
}

describe("decodeContent", () => {
  it("treats a bare string as one text block", () => {
    expect(decodeContent({ content: "hello" })).toStrictEqual({
      blockKinds: ["text"],
      malformedBlocks: 0,
      text: "hello",
      toolResults: [],
      toolUses: [],
    });
  });

  it("joins text blocks with newlines and keeps the block kinds in order", () => {
    expect(
      decodeContent({
        content: [
          { text: "a", type: "text" },
          { text: "b", type: "text" },
        ],
      }),
    ).toStrictEqual({ blockKinds: ["text", "text"], malformedBlocks: 0, text: "a\nb", toolResults: [], toolUses: [] });
  });

  it("reads a tool_result whose body is a string", () => {
    expect(
      decodeContent({ content: [{ content: "Exit code 1", is_error: true, tool_use_id: "t1", type: "tool_result" }] })
        .toolResults,
    ).toStrictEqual([{ isError: true, text: "Exit code 1", toolUseId: "t1" }]);
  });

  it("reads a tool_result whose body is a block array, which 477 of 27,221 measured results were", () => {
    expect(
      decodeContent({
        content: [
          {
            content: [
              { text: "line one", type: "text" },
              { source: {}, type: "image" },
              { text: "line two", type: "text" },
            ],
            tool_use_id: "t2",
            type: "tool_result",
          },
        ],
      }).toolResults,
    ).toStrictEqual([{ isError: false, text: "line one\nline two", toolUseId: "t2" }]);
  });

  it("reads an absent is_error as not an error, which is how 7,064 measured results arrived", () => {
    expect(
      decodeContent({ content: [{ content: "fine", tool_use_id: "t3", type: "tool_result" }] }).toolResults[0]!.isError,
    ).toBe(false);
  });

  it("reads a tool_use's id and name, which is the only place a result's tool is named", () => {
    expect(
      decodeContent({ content: [{ id: "t4", input: {}, name: "Bash", type: "tool_use" }] }).toolUses,
    ).toStrictEqual([{ command: "", name: "Bash", skill: "", toolUseId: "t4" }]);
  });

  it("reads a Skill call's launched skill, which its tool name alone never says", () => {
    expect(
      decodeContent({
        content: [{ id: "t5", input: { skill: "slopweaver:supervisor" }, name: "Skill", type: "tool_use" }],
      }).toolUses,
    ).toStrictEqual([{ command: "", name: "Skill", skill: "slopweaver:supervisor", toolUseId: "t5" }]);
  });

  it("leaves the skill empty when a tool_use carries no input object at all", () => {
    expect(decodeContent({ content: [{ id: "t6", name: "Bash", type: "tool_use" }] }).toolUses).toStrictEqual([
      { command: "", name: "Bash", skill: "", toolUseId: "t6" },
    ]);
  });

  it("yields nothing at all for content that is neither a string nor an array", () => {
    expect(decodeContent({ content: undefined })).toStrictEqual({
      blockKinds: [],
      malformedBlocks: 0,
      text: "",
      toolResults: [],
      toolUses: [],
    });
  });
});

describe("readTranscriptLine", () => {
  it("decodes a user record with every field it carries", () => {
    const record = decode({
      line: JSON.stringify({
        cwd: "/repo",
        isMeta: true,
        isSidechain: true,
        message: { content: "hi", role: "user" },
        origin: { kind: "human" },
        promptSource: "typed",
        timestamp: "2026-08-27T00:00:00.000Z",
        toolUseResult: {},
        type: "user",
        uuid: "u-9",
      }),
    });
    expect(record).toStrictEqual({
      blockKinds: ["text"],
      cwd: "/repo",
      hasToolUseResult: true,
      isCompactSummary: false,
      isMeta: true,
      isSidechain: true,
      lineNumber: 7,
      model: "",
      originKind: "human",
      promptSource: "typed",
      role: "user",
      text: "hi",
      timestamp: "2026-08-27T00:00:00.000Z",
      toolResults: [],
      toolUses: [],
      uuid: "u-9",
    });
  });

  it("reads the model off an assistant record's message", () => {
    expect(
      decode({
        line: JSON.stringify({
          message: { content: [], model: "claude-opus-5", role: "assistant" },
          type: "assistant",
        }),
      }).model,
    ).toBe("claude-opus-5");
  });

  it("reports a line that is not JSON rather than throwing — a live tail truncates mid-line", () => {
    expect(readTranscriptLine({ line: '{"type":"user","mess', lineNumber: 3 })).toStrictEqual({
      undecoded: { lineNumber: 3, why: "not-json" },
    });
  });

  it("reports a JSON line that is not an object", () => {
    expect(readTranscriptLine({ line: "[1,2,3]", lineNumber: 4 })).toStrictEqual({
      undecoded: { lineNumber: 4, why: "not-an-object" },
    });
  });

  it("reports a housekeeping record as carrying no message role", () => {
    expect(readTranscriptLine({ line: JSON.stringify({ title: "x", type: "ai-title" }), lineNumber: 5 })).toStrictEqual(
      {
        undecoded: { lineNumber: 5, why: "not-a-message-role" },
      },
    );
  });

  it("reports a line whose type is no string, or a message with no string or array content, as malformed", () => {
    const lines = ['{"type":5}', '{"type":"user","message":{"content":42}}', '{"type":"assistant"}'];
    expect(lines.map((line, index) => readTranscriptLine({ line, lineNumber: index + 1 }))).toStrictEqual([
      { undecoded: { lineNumber: 1, why: "malformed-message" } },
      { undecoded: { lineNumber: 2, why: "malformed-message" } },
      { undecoded: { lineNumber: 3, why: "malformed-message" } },
    ]);
  });

  it("reports a user record carrying a malformed content block as malformed, never quoting what is left", () => {
    const lines = [
      '{"type":"user","message":{"content":[{"type":"text","text":42}]}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"kept"},{"type":"text","text":null}]}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"kept"},7]}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"kept"},{"text":"no type"}]}}',
    ];
    expect(lines.map((line, index) => readTranscriptLine({ line, lineNumber: index + 1 }))).toStrictEqual([
      { undecoded: { lineNumber: 1, why: "malformed-message" } },
      { undecoded: { lineNumber: 2, why: "malformed-message" } },
      { undecoded: { lineNumber: 3, why: "malformed-message" } },
      { undecoded: { lineNumber: 4, why: "malformed-message" } },
    ]);
  });

  it("still decodes a user record whose non-text blocks are well formed", () => {
    const line = '{"type":"user","message":{"content":[{"type":"text","text":"see"},{"type":"image","source":{}}]}}';
    expect(decode({ line }).text).toBe("see");
  });

  it("counts a malformed block in an array content", () => {
    expect(
      decodeContent({ content: [{ text: "a", type: "text" }, { text: 1, type: "text" }, 3] }).malformedBlocks,
    ).toBe(2);
  });

  it("reports a blank line rather than decoding one", () => {
    expect(readTranscriptLine({ line: "   ", lineNumber: 6 })).toStrictEqual({
      undecoded: { lineNumber: 6, why: "not-json" },
    });
  });

  it("defaults every absent string field to empty rather than to undefined", () => {
    const record = decode({ line: JSON.stringify({ message: { content: "x" }, type: "user" }) });
    expect(record.uuid).toBe("");
    expect(record.timestamp).toBe("");
    expect(record.cwd).toBe("");
    expect(record.promptSource).toBe("");
    expect(record.originKind).toBe("");
  });
});
