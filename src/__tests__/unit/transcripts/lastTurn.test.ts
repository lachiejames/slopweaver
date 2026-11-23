/**
 * The latest-turn fold, over lines shaped like the ones Claude Code writes, and the verb that serves it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runTranscriptsLastTurn } from "../../../cli/commands/transcripts/lastTurn.js";
import { FRAGMENT_TURN_ID, foldLastTurn, MAX_PARTS, TOOL_CHARS } from "../../../transcripts/lastTurn.js";

const SESSION = "a0000018-0000-4000-8000-000000000021";

/** A `user` line a person typed. */
function typed({ text, uuid }: { text: string; uuid: string }): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content: text, role: "user" },
    promptSource: "typed",
    timestamp: "2026-09-24T01:00:00.000Z",
    type: "user",
    uuid,
  });
}

/** An `assistant` line carrying the given content blocks. */
function assistant({ content, extra = {} }: { content: unknown; extra?: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content, model: "claude-opus-5-5", role: "assistant" },
    timestamp: "2026-09-24T01:00:05.000Z",
    type: "assistant",
    uuid: "a-1",
    ...extra,
  });
}

/** A `user` line carrying one tool result. */
function toolResult({ id, text, isError = false }: { id: string; text: string; isError?: boolean }): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content: [{ content: text, is_error: isError, tool_use_id: id, type: "tool_result" }], role: "user" },
    timestamp: "2026-09-24T01:00:09.000Z",
    toolUseResult: {},
    type: "user",
    uuid: "r-1",
  });
}

describe("foldLastTurn", () => {
  it("opens at the LAST typed turn and keeps text, thinking and tools in the order produced", () => {
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "an older question", uuid: "u-0" }),
        assistant({ content: [{ text: "an older answer", type: "text" }] }),
        typed({ text: "why is the pool exhausted", uuid: "u-1" }),
        assistant({ content: [{ thinking: "check the pool config first", type: "thinking" }] }),
        assistant({ content: [{ id: "t-1", input: { command: "rg pool" }, name: "Bash", type: "tool_use" }] }),
        toolResult({ id: "t-1", text: "config/pool.ts:12 max: 5" }),
        assistant({ content: [{ text: "The pool caps at 5.", type: "text" }] }),
      ],
    });
    expect(turn.prompt!.text).toBe("why is the pool exhausted");
    expect(turn.turnStartSeen).toBe(true);
    expect(turn.parts.map((part) => part.type)).toEqual(["reasoning", "tool", "text"]);
    expect(turn.parts[0]).toEqual({ text: "check the pool config first", truncated: false, type: "reasoning" });
    expect(turn.parts[1]).toEqual({
      input: '{\n  "command": "rg pool"\n}',
      output: "config/pool.ts:12 max: 5",
      state: "done",
      toolCallId: "t-1",
      toolName: "Bash",
      truncated: false,
      type: "tool",
    });
    expect(turn.parts[2]).toEqual({ text: "The pool caps at 5.", truncated: false, type: "text" });
    expect(turn.model).toBe("claude-opus-5-5");
    expect(turn.cwd).toBe("/repo");
    expect(turn.lastTimestamp).toBe("2026-09-24T01:00:05.000Z");
  });

  it("leaves a call with no result running, and marks a failed one an error", () => {
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "go", uuid: "u-1" }),
        assistant({
          content: [
            { id: "t-1", input: {}, name: "Read", type: "tool_use" },
            { id: "t-2", input: {}, name: "Bash", type: "tool_use" },
          ],
        }),
        toolResult({ id: "t-1", isError: true, text: "ENOENT" }),
      ],
    });
    expect(turn.parts.map((part) => (part.type === "tool" ? part.state : part.type))).toEqual(["error", "running"]);
  });

  it("does not open a turn at a tool result, and skips a subagent's sidechain", () => {
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "the real ask", uuid: "u-1" }),
        assistant({ content: [{ text: "from a subagent", type: "text" }], extra: { isSidechain: true } }),
        toolResult({ id: "t-9", text: "orphan" }),
        assistant({ content: [{ text: "main thread", type: "text" }] }),
      ],
    });
    expect(turn.prompt!.text).toBe("the real ask");
    expect(turn.parts).toEqual([{ text: "main thread", truncated: false, type: "text" }]);
  });

  it("says the opening was not seen when a mid-file tail holds no typed turn", () => {
    const turn = foldLastTurn({
      fromStart: false,
      lines: [assistant({ content: [{ text: "mid-turn", type: "text" }] })],
    });
    expect(turn.prompt).toBe(undefined);
    expect(turn.turnStartSeen).toBe(false);
    expect(turn.parts).toEqual([{ text: "mid-turn", truncated: false, type: "text" }]);
  });

  it("caps a tool's output, keeps only the last MAX_PARTS parts, and redacts a token", () => {
    const calls = Array.from({ length: MAX_PARTS + 3 }, (_, index) => ({
      text: `step ${String(index)}`,
      type: "text",
    }));
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "go", uuid: "u-1" }),
        assistant({ content: calls }),
        assistant({ content: [{ id: "t-1", input: {}, name: "Bash", type: "tool_use" }] }),
        toolResult({ id: "t-1", text: `ghp_${"a".repeat(36)} ${"x".repeat(TOOL_CHARS)}` }),
      ],
    });
    expect(turn.parts.length).toBe(MAX_PARTS);
    expect(turn.partsDropped).toBe(4);
    const tool = turn.parts.at(-1)!;
    expect(tool.type).toBe("tool");
    expect(tool.truncated).toBe(true);
    expect(JSON.stringify(tool)).not.toContain(`ghp_${"a".repeat(36)}`);
  });

  it("redacts a token that straddles the cap, so no prefix of it prints", () => {
    const prefix = "ghp_aaaaaa";
    const turn = foldLastTurn({
      fromStart: true,
      lines: [typed({ text: `${"x".repeat(19_990)}ghp_${"a".repeat(36)} ${"y".repeat(100)}`, uuid: "u-1" })],
    });
    expect(turn.prompt!.truncated).toBe(true);
    expect(turn.prompt!.text).not.toContain(prefix);
    expect(turn.prompt!.text.startsWith("x".repeat(19_990))).toBe(true);
  });

  it("answers one turn by default, keyed by its opening's uuid, and counts the turns before it", () => {
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "first", uuid: "u-0" }),
        assistant({ content: [{ text: "one", type: "text" }] }),
        typed({ text: "second", uuid: "u-1" }),
        assistant({ content: [{ text: "two", type: "text" }] }),
        typed({ text: "third", uuid: "u-2" }),
        assistant({ content: [{ text: "three", type: "text" }] }),
      ],
    });
    expect(turn.turnId).toBe("u-2");
    expect(turn.earlier).toEqual([]);
    expect(turn.earlierTurnsInTail).toBe(2);
  });

  it("answers the turns before the latest oldest first, each joining only its own tool results", () => {
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "first", uuid: "u-0" }),
        assistant({ content: [{ id: "t-1", input: {}, name: "Read", type: "tool_use" }] }),
        typed({ text: "second", uuid: "u-1" }),
        toolResult({ id: "t-1", text: "late result from the first turn" }),
        assistant({ content: [{ text: "two", type: "text" }] }),
        typed({ text: "third", uuid: "u-2" }),
        assistant({ content: [{ text: "three", type: "text" }] }),
      ],
      turns: 3,
    });
    expect(turn.earlier.map((slice) => [slice.turnId, slice.prompt.text, slice.partsDropped])).toEqual([
      ["u-0", "first", 0],
      ["u-1", "second", 0],
    ]);
    expect(turn.earlier[0]!.parts).toEqual([
      {
        input: "{}",
        output: "",
        state: "running",
        toolCallId: "t-1",
        toolName: "Read",
        truncated: false,
        type: "tool",
      },
    ]);
    expect(turn.earlier[1]!.parts).toEqual([{ text: "two", truncated: false, type: "text" }]);
    expect(turn.prompt!.text).toBe("third");
    expect(turn.parts).toEqual([{ text: "three", truncated: false, type: "text" }]);
  });

  it("answers only the earlier turns the tail holds, however many were asked for", () => {
    const turn = foldLastTurn({
      fromStart: false,
      lines: [
        assistant({ content: [{ text: "before any opening", type: "text" }] }),
        typed({ text: "only", uuid: "u-9" }),
        assistant({ content: [{ text: "reply", type: "text" }] }),
      ],
      turns: 20,
    });
    expect(turn.earlier).toEqual([]);
    expect(turn.earlierTurnsInTail).toBe(0);
    expect(turn.parts).toEqual([{ text: "reply", truncated: false, type: "text" }]);
  });

  it("keys a mid-file fragment with no opening by one constant id, so a poll never re-keys it", () => {
    const turn = foldLastTurn({ fromStart: false, lines: [assistant({ content: [{ text: "mid", type: "text" }] })] });
    expect([turn.turnId, turn.earlierTurnsInTail]).toEqual([FRAGMENT_TURN_ID, 0]);
  });

  it("cuts the part budget from the OLDEST turn first, counting what each turn lost", () => {
    const many = ({ count, tag }: { count: number; tag: string }): unknown[] =>
      Array.from({ length: count }, (_, index) => ({ text: `${tag} ${String(index)}`, type: "text" }));
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "old", uuid: "u-0" }),
        assistant({ content: many({ count: 30, tag: "old" }) }),
        typed({ text: "mid", uuid: "u-1" }),
        assistant({ content: many({ count: 20, tag: "mid" }) }),
        typed({ text: "new", uuid: "u-2" }),
        assistant({ content: many({ count: MAX_PARTS - 10, tag: "new" }) }),
      ],
      turns: 3,
    });
    expect(turn.earlier.map((slice) => [slice.parts.length, slice.partsDropped])).toEqual([
      [0, 30],
      [10, 10],
    ]);
    expect(turn.earlier[0]!.prompt.text).toBe("old");
    expect(turn.earlier[1]!.parts[0]).toEqual({ text: "mid 10", truncated: false, type: "text" });
    expect([turn.parts.length, turn.partsDropped]).toEqual([MAX_PARTS - 10, 0]);
  });

  it("redacts an earlier turn's prompt and parts exactly as the latest one's", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: `use ${token}`, uuid: `u-${token}` }),
        assistant({ content: [{ text: `echo ${token}`, type: "text" }] }),
        typed({ text: "next", uuid: "u-1" }),
      ],
      turns: 2,
    });
    expect(JSON.stringify(turn.earlier[0])).toContain("use ");
    expect(JSON.stringify(turn.earlier)).not.toContain(token);
  });

  it("redacts and caps every label the turn carries, not only its bodies", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const turn = foldLastTurn({
      fromStart: true,
      lines: [
        typed({ text: "go", uuid: "u-1" }),
        assistant({
          content: [{ id: `t-${token}`, input: {}, name: `Bash${"n".repeat(2_000)}`, type: "tool_use" }],
          extra: { cwd: `/tmp/${token}` },
        }),
        toolResult({ id: `t-${token}`, text: "ok" }),
      ],
    });
    const tool = turn.parts.at(0)!;
    expect(JSON.stringify(turn)).not.toContain(token);
    expect(turn.cwd).not.toBe(`/tmp/${token}`);
    expect(JSON.stringify(tool)).toContain('"state":"done"');
    expect(JSON.stringify(tool).length).toBeLessThan(1_500);
  });
});

describe("transcripts last-turn", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  /** Run the verb against a throwaway projects directory holding one transcript. */
  function run({ rest, lines }: { rest: readonly string[]; lines: readonly string[] }): {
    code: number;
    out: string[];
    diagnostics: string[];
  } {
    const projects = mkdtempSync(join(tmpdir(), "last-turn-"));
    dirs.push(projects);
    mkdirSync(join(projects, "-repo"));
    writeFileSync(join(projects, "-repo", `${SESSION}.jsonl`), `${lines.join("\n")}\n`);
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = runTranscriptsLastTurn({
      deps: {
        projectsDir: () => projects,
        writeDiagnostic: (line) => {
          diagnostics.push(line);
        },
        writeOut: (line) => {
          out.push(line);
        },
      },
      rest,
    });
    return { code, diagnostics, out };
  }

  it("prints one JSON object naming the session and its parts", () => {
    const result = run({
      lines: [typed({ text: "hello", uuid: "u-1" }), assistant({ content: [{ text: "hi", type: "text" }] })],
      rest: ["--session", SESSION, "--json"],
    });
    expect(result.code).toBe(0);
    const printed = JSON.parse(result.out[0]!) as { sessionId: string; parts: unknown[]; prompt: { text: string } };
    expect(printed.sessionId).toBe(SESSION);
    expect(printed.prompt.text).toBe("hello");
    expect(printed.parts).toEqual([{ text: "hi", truncated: false, type: "text" }]);
  });

  it("prints the turns before the latest when --turns asks for them", () => {
    const result = run({
      lines: [
        typed({ text: "first", uuid: "u-0" }),
        assistant({ content: [{ text: "one", type: "text" }] }),
        typed({ text: "second", uuid: "u-1" }),
        assistant({ content: [{ text: "two", type: "text" }] }),
      ],
      rest: ["--session", SESSION, "--turns", "2", "--json"],
    });
    expect(result.code).toBe(0);
    const printed = JSON.parse(result.out[0]!) as {
      turnId: string;
      earlierTurnsInTail: number;
      earlier: { turnId: string; prompt: { text: string } }[];
    };
    expect([printed.turnId, printed.earlierTurnsInTail]).toEqual(["u-1", 1]);
    expect(printed.earlier.map((slice) => [slice.turnId, slice.prompt.text])).toEqual([["u-0", "first"]]);
  });

  it.each(["0", "41", "1.5", "two", "-1"])("refuses --turns %s as a usage error", (value) => {
    const result = run({ lines: [], rest: ["--session", SESSION, "--turns", value] });
    expect(result.code).toBe(2);
    expect(result.diagnostics[0]).toBe("transcripts last-turn: --turns must be a whole number from 1 to 40");
  });

  it("refuses a session id that is not a UUID before touching the disk", () => {
    const result = run({ lines: [], rest: ["--session", "../../etc/passwd", "--json"] });
    expect(result.code).toBe(2);
    expect(result.diagnostics[0]).toContain("must be a Claude session id");
  });

  it("names a session with no transcript as an error", () => {
    const result = run({ lines: [], rest: ["--session", "00000000-0000-0000-0000-000000000000"] });
    expect(result.code).toBe(1);
    expect(result.diagnostics[0]).toContain("transcripts last-turn:");
  });
});
