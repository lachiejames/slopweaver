/*
 * The voice's session tray as rows: tool lines in the order they arrived, what is still running at the foot, and a key
 * that survives the oldest line dropping off the capped list, so a fold the owner opened stays on its own row.
 */
import { describe, expect, it } from "vitest";

import type { ActivityRow } from "../../lib/voiceActivity";
import {
  PICTURE_OUTPUT,
  type SessionToolLine,
  shownToolOutputOf,
  toolCallShownOf,
  voiceSessionRows,
} from "../../lib/voiceSessionView";

const line = (over: Partial<SessionToolLine> = {}): SessionToolLine => ({
  detail: "read 3 rows",
  ms: 1800,
  name: "board",
  refused: false,
  usage: undefined,
  ...over,
});

const running = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  key: "turn:1",
  seconds: 4,
  stale: false,
  step: undefined,
  words: "asking Codex",
  ...over,
});

describe("voiceSessionRows", () => {
  it("draws nothing for a call that looked nothing up", () => {
    expect(voiceSessionRows({ inFlight: [], tools: [] })).toEqual([]);
  });

  it("draws an answered call with its detail and timing behind the fold", () => {
    expect(voiceSessionRows({ inFlight: [], tools: [line()] })).toEqual([
      {
        detail: "read 3 rows",
        key: "tool:board · read 3 rows · 1800:0",
        opened: undefined,
        openedLinks: false,
        shown: undefined,
        stale: false,
        state: "done",
        timing: "1.8s",
        title: "board",
      },
    ]);
  });

  it("carries a call's input and output behind its fold, and none onto a running row", () => {
    const shown = { input: '{\n  "q": "x"\n}', output: "the answer" };
    const rows = voiceSessionRows({ inFlight: [running()], tools: [line({ shown })] });
    expect(rows.map((row) => row.shown)).toEqual([shown, undefined]);
  });

  it("marks a refused call", () => {
    expect(voiceSessionRows({ inFlight: [], tools: [line({ refused: true })] })[0].state).toBe("refused");
  });

  it("carries the link a read opened, and none it cannot vouch for", () => {
    const rows = voiceSessionRows({
      inFlight: [],
      tools: [line({ opened: "https://example.test/a" }), line({ name: "read", opened: null })],
    });
    expect(rows.map((row) => row.opened)).toEqual(["https://example.test/a", undefined]);
    expect(rows.map((row) => row.openedLinks)).toEqual([true, false]);
  });

  it("keeps a kept call's address under a retired page as words, never a link", () => {
    const rows = voiceSessionRows({
      inFlight: [],
      tools: [
        line({ opened: "http://localhost:3000/board" }),
        line({ name: "read", opened: "http://127.0.0.1:3000/Machine/agents" }),
        line({ name: "open", opened: "http://localhost:3000/fleet" }),
      ],
    });
    expect(rows.map((row) => [row.opened, row.openedLinks])).toEqual([
      ["http://localhost:3000/board", false],
      ["http://127.0.0.1:3000/Machine/agents", false],
      ["http://localhost:3000/fleet", true],
    ]);
  });

  it("says nothing of timing when nothing was measured", () => {
    expect(voiceSessionRows({ inFlight: [], tools: [line({ ms: undefined })] })[0].timing).toBe("");
  });

  it("puts the tool lines oldest first and what is running at the foot, newest progress last", () => {
    const rows = voiceSessionRows({
      inFlight: [running({ key: "tool:new", words: "reading the board" }), running({ key: "turn:old" })],
      tools: [line({ name: "first" }), line({ name: "second" })],
    });
    expect(rows.map((row) => [row.title, row.state])).toEqual([
      ["first", "done"],
      ["second", "done"],
      ["asking Codex", "running"],
      ["reading the board", "running"],
    ]);
  });

  it("draws a running row with its age, and says when it has had no update", () => {
    const [row] = voiceSessionRows({ inFlight: [running({ seconds: 41, stale: true })], tools: [] });
    expect([row.key, row.timing, row.stale, row.detail]).toEqual(["running:turn:1", "41s", true, ""]);
  });

  it("gives two identical calls distinct keys", () => {
    const keys = voiceSessionRows({ inFlight: [], tools: [line(), line()] }).map((row) => row.key);
    expect(keys).toEqual(["tool:board · read 3 rows · 1800:0", "tool:board · read 3 rows · 1800:1"]);
  });

  it("keeps each surviving row's key when the oldest line drops off the capped list", () => {
    const before = voiceSessionRows({
      inFlight: [],
      tools: [line({ name: "oldest" }), line({ name: "middle" }), line({ name: "newest" })],
    });
    const after = voiceSessionRows({ inFlight: [], tools: [line({ name: "middle" }), line({ name: "newest" })] });
    expect(after.map((row) => row.key)).toEqual(before.slice(1).map((row) => row.key));
  });
});

describe("shownToolOutputOf", () => {
  it("draws an answered call's output as its result", () => {
    expect(shownToolOutputOf({ output: "3 rows", refused: false })).toEqual({ errorText: undefined, output: "3 rows" });
  });

  it("draws a refused call's output as its error", () => {
    expect(shownToolOutputOf({ output: "no", refused: true })).toEqual({ errorText: "no", output: undefined });
  });
});

describe("toolCallShownOf", () => {
  it("indents JSON arguments and a JSON answer", () => {
    expect(toolCallShownOf({ output: '{"rows":3}', rawArguments: '{"q":"staging pool"}' })).toEqual({
      input: '{\n  "q": "staging pool"\n}',
      output: '{\n  "rows": 3\n}',
    });
  });

  it("keeps text that is not JSON exactly as written, a refusal's words included", () => {
    expect(
      toolCallShownOf({ output: "only the voice's window may look at the owner's screen", rawArguments: "{not json" }),
    ).toEqual({ input: "{not json", output: "only the voice's window may look at the owner's screen" });
  });

  // JSON.parse rounds an integer past 2^53, so indenting it would show another number.
  it("keeps JSON verbatim when parsing would change more than its whitespace", () => {
    expect(toolCallShownOf({ output: '{"x": 1.0}', rawArguments: '{"n":9007199254740993}' })).toEqual({
      input: '{"n":9007199254740993}',
      output: '{"x": 1.0}',
    });
  });

  it("indents JSON whose strings carry spaces, escaped quotes and braces", () => {
    const rawArguments = '{ "q": "say \\"a b\\" {x}" }';
    expect(toolCallShownOf({ output: "", rawArguments }).input).toBe('{\n  "q": "say \\"a b\\" {x}"\n}');
  });

  it("names a picture rather than drawing its bytes", () => {
    const shown = toolCallShownOf({
      output: [{ image_url: "data:image/png;base64,AAAA", type: "input_image" }],
      rawArguments: "{}",
    });
    expect(shown).toEqual({ input: "{}", output: PICTURE_OUTPUT });
  });

  it("draws empty arguments as the empty text the model wrote", () => {
    expect(toolCallShownOf({ output: "", rawArguments: "" })).toEqual({ input: "", output: "" });
  });
});
