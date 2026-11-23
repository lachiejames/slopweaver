/*
 * The session view's tool grouping: where a run of tool calls is closed, what the one-line summary says, and
 * which calls a group carries as running or failed.
 */
import { describe, expect, it } from "vitest";

import {
  adoptRuns,
  callOpen,
  foldOpen,
  groupSummary,
  groupTurnParts,
  NO_FOLDS,
  newestChoice,
  pressFolds,
  runChoiceOf,
  runOpen,
  type ToolGroupRow,
  type TurnPart,
  type TurnRow,
} from "../../lib/toolGroup";

/** A tool call as the session view draws it; named off the lib, since knip reads this file against the root. */
type DynamicToolUIPart = ToolGroupRow["tools"][number];

/** A finished tool call. */
const done = ({ id, name }: { id: string; name: string }): DynamicToolUIPart => ({
  input: "{}",
  output: "ok",
  state: "output-available",
  toolCallId: id,
  toolName: name,
  type: "dynamic-tool",
});

/** A tool call still waiting on its result. */
const running = ({ id, name }: { id: string; name: string }): DynamicToolUIPart => ({
  input: "{}",
  state: "input-available",
  toolCallId: id,
  toolName: name,
  type: "dynamic-tool",
});

/** A tool call whose result was a failure. */
const failed = ({ id, name }: { id: string; name: string }): DynamicToolUIPart => ({
  errorText: "ENOENT",
  input: "{}",
  state: "output-error",
  toolCallId: id,
  toolName: name,
  type: "dynamic-tool",
});

const text = ({ words }: { words: string }): TurnPart => ({ state: "done", text: words, type: "text" });
const thinking = ({ words }: { words: string }): TurnPart => ({ state: "done", text: words, type: "reasoning" });

/** Each row as a short string, so a test asserts the whole fold at once. */
const shapeOf = ({ rows }: { rows: readonly TurnRow[] }): readonly string[] =>
  rows.map((row) => (row.kind === "part" ? `${row.part.type}@${row.key}` : `group ${row.key} [${row.summary}]`));

describe("groupTurnParts", () => {
  it("folds every run of consecutive calls into one group, closed at each text and thinking part", () => {
    const rows = groupTurnParts({
      parts: [
        running({ id: "t-0", name: "Read" }),
        thinking({ words: "look at the pool" }),
        done({ id: "t-1", name: "Read" }),
        done({ id: "t-2", name: "Grep" }),
        done({ id: "t-3", name: "Read" }),
        text({ words: "found it" }),
        done({ id: "t-4", name: "Bash" }),
      ],
    });
    expect(shapeOf({ rows })).toEqual([
      "group tools:t-0 [1 read]",
      "reasoning@part:1",
      "group tools:t-1 [2 reads · 1 search]",
      "text@part:5",
      "group tools:t-4 [1 command]",
    ]);
  });

  it("passes prose through untouched when there are no calls", () => {
    const rows = groupTurnParts({ parts: [text({ words: "a" }), text({ words: "b" })] });
    expect(shapeOf({ rows })).toEqual(["text@part:0", "text@part:1"]);
  });

  it("answers no rows for no parts", () => {
    expect(groupTurnParts({ parts: [] })).toEqual([]);
  });

  it("counts the calls still running and carries the failures by identity", () => {
    const broken = failed({ id: "t-2", name: "Read" });
    const [row] = groupTurnParts({
      parts: [
        done({ id: "t-1", name: "Read" }),
        broken,
        running({ id: "t-3", name: "Bash" }),
        running({ id: "t-4", name: "Bash" }),
      ],
    });
    expect(row).toEqual({
      failed: [broken],
      key: "tools:t-1",
      kind: "tool-group",
      running: 2,
      summary: "2 reads · 2 commands",
      tools: [
        done({ id: "t-1", name: "Read" }),
        broken,
        running({ id: "t-3", name: "Bash" }),
        running({ id: "t-4", name: "Bash" }),
      ],
    });
  });

  it("keeps a group's key while the run grows, so a poll does not re-key it", () => {
    const first = groupTurnParts({ parts: [done({ id: "t-1", name: "Read" })] });
    const later = groupTurnParts({ parts: [done({ id: "t-1", name: "Read" }), running({ id: "t-2", name: "Edit" })] });
    expect([first[0].key, later[0].key]).toEqual(["tools:t-1", "tools:t-1"]);
  });
});

describe("groupSummary", () => {
  it("names each kind of Claude Code work, singular and plural, in the order the run first did it", () => {
    const summary = groupSummary({
      tools: [
        done({ id: "1", name: "Bash" }),
        done({ id: "2", name: "Edit" }),
        done({ id: "3", name: "Write" }),
        done({ id: "4", name: "NotebookEdit" }),
        done({ id: "5", name: "Glob" }),
        done({ id: "6", name: "ToolSearch" }),
        done({ id: "7", name: "WebFetch" }),
        done({ id: "8", name: "WebSearch" }),
        done({ id: "9", name: "Agent" }),
        done({ id: "10", name: "Task" }),
        done({ id: "11", name: "Read" }),
      ],
    });
    expect(summary).toBe("1 command · 3 edits · 2 searches · 2 web reads · 2 subagents · 1 read");
  });

  it("counts an MCP call by its server, whatever the tool on it", () => {
    const summary = groupSummary({
      tools: [
        done({ id: "1", name: "mcp__slack__read_thread" }),
        done({ id: "2", name: "mcp__slack__search" }),
        done({ id: "3", name: "mcp__plugin_trajectory_trajectory__trajectory_query" }),
      ],
    });
    expect(summary).toBe("2 slack calls · 1 plugin_trajectory_trajectory call");
  });

  it("counts a tool it does not know by its own name", () => {
    const summary = groupSummary({ tools: [done({ id: "1", name: "Skill" }), done({ id: "2", name: "mcp__" })] });
    expect(summary).toBe("1 Skill call · 1 mcp__ call");
  });

  it("says nothing for no calls", () => {
    expect(groupSummary({ tools: [] })).toBe("");
  });
});

describe("foldOpen", () => {
  it("stays shut before any press when nothing inside failed and the reader opened nothing", () => {
    expect(foldOpen({ chosen: undefined, failedIds: [], opensItself: false })).toBe(false);
  });

  it("opens itself for a failure, and for a call the reader already opened inside it", () => {
    expect([
      foldOpen({ chosen: undefined, failedIds: ["t-2"], opensItself: false }),
      foldOpen({ chosen: undefined, failedIds: [], opensItself: true }),
    ]).toEqual([true, true]);
  });

  it("keeps the reader's press while every failure inside was already on screen when they made it", () => {
    const folded = { open: false, seen: new Set(["t-2"]) };
    expect(foldOpen({ chosen: folded, failedIds: ["t-2"], opensItself: true })).toBe(false);
  });

  it("reopens for a failure the reader has not seen, even one replacing a failure they had", () => {
    const folded = { open: false, seen: new Set(["t-1"]) };
    expect(foldOpen({ chosen: folded, failedIds: ["t-2"], opensItself: false })).toBe(true);
  });

  it("keeps a fold the reader opened open, whatever changes inside it", () => {
    const opened = { open: true, seen: new Set<string>() };
    expect(foldOpen({ chosen: opened, failedIds: [], opensItself: false })).toBe(true);
  });
});

describe("groupTurnParts offset", () => {
  it("keys each part by its place in the whole turn, so dropping the oldest parts re-keys nothing still drawn", () => {
    const before = groupTurnParts({ offset: 3, parts: [text({ words: "a" }), text({ words: "b" })] });
    const after = groupTurnParts({ offset: 4, parts: [text({ words: "b" })] });
    expect([before[1].key, after[0].key]).toEqual(["part:4", "part:4"]);
  });
});

describe("runChoiceOf", () => {
  it("finds the reader's press on a run through any call it still holds, once its first call is dropped", () => {
    const choices = {
      "t-1": { open: true, press: 1, seen: new Set<string>() },
      "t-2": { open: true, press: 1, seen: new Set<string>() },
    };
    const run = [done({ id: "t-2", name: "Read" }), done({ id: "t-3", name: "Read" })];
    expect(runChoiceOf({ choices, tools: run })!.open).toBe(true);
  });

  it("takes the newest press when the run's calls carry more than one", () => {
    const choices = {
      "t-1": { open: true, press: 1, seen: new Set<string>() },
      "t-2": { open: false, press: 2, seen: new Set<string>() },
    };
    const run = [done({ id: "t-1", name: "Read" }), done({ id: "t-2", name: "Read" })];
    expect(runChoiceOf({ choices, tools: run })!.press).toBe(2);
  });

  it("answers undefined for a run the reader never pressed", () => {
    expect(runChoiceOf({ choices: {}, tools: [done({ id: "t-1", name: "Read" })] })).toBe(undefined);
  });
});

describe("newestChoice", () => {
  it("keeps a run the reader opened open once the budget cuts it back to one call", () => {
    const runs = {
      "t-1": { open: true, press: 1, seen: new Set<string>() },
      "t-2": { open: true, press: 1, seen: new Set<string>() },
    };
    const runChoice = runChoiceOf({ choices: runs, tools: [done({ id: "t-2", name: "Read" })] });
    const chosen = newestChoice({ choices: [undefined, runChoice] });
    expect(foldOpen({ chosen, failedIds: [], opensItself: false })).toBe(true);
  });

  it("lets a later press on the call itself outrank the run's", () => {
    const run = { open: true, press: 1, seen: new Set<string>() };
    const call = { open: false, press: 2, seen: new Set<string>() };
    expect(newestChoice({ choices: [call, run] })!.open).toBe(false);
  });

  it("lets a later press on the run outrank an earlier one on the call", () => {
    const call = { open: true, press: 1, seen: new Set<string>() };
    const run = { open: false, press: 2, seen: new Set<string>() };
    expect(newestChoice({ choices: [call, run] })!.open).toBe(false);
  });

  it("answers undefined when nothing was pressed", () => {
    expect(newestChoice({ choices: [undefined, undefined] })).toBe(undefined);
  });
});

/** The one run a read of these calls draws. */
const runOf = ({ tools }: { tools: DynamicToolUIPart[] }): ToolGroupRow =>
  groupTurnParts({ parts: tools })[0] as ToolGroupRow;

describe("pressFolds, callOpen and runOpen across reads", () => {
  const a = done({ id: "t-a", name: "Read" });
  const b = done({ id: "t-b", name: "Read" });
  const c = done({ id: "t-c", name: "Read" });
  const closed = { open: false, seen: new Set<string>() };
  const opened = { open: true, seen: new Set<string>() };

  it("numbers every press, on a call or a run, from one counter", () => {
    const once = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-a", "t-b"] });
    const twice = pressFolds({ calls: ["t-b"], choice: closed, folds: once, runs: [] });
    expect([twice.presses, twice.runs["t-a"].press, twice.calls["t-b"].press]).toEqual([2, 1, 2]);
  });

  it("keeps an opened run's only surviving call open once the budget drops the rest", () => {
    const folds = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-a", "t-b"] });
    expect(callOpen({ folds, tool: b, wholeRun: true })).toBe(true);
  });

  it("keeps a run closed when the reader closed its only call and a new call joins it", () => {
    const openedRun = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-a", "t-b"] });
    const closedSole = pressFolds({ calls: ["t-b"], choice: closed, folds: openedRun, runs: ["t-b"] });
    expect([
      callOpen({ folds: closedSole, tool: b, wholeRun: true }),
      runOpen({ folds: closedSole, group: runOf({ tools: [b, c] }) }),
    ]).toEqual([false, false]);
  });

  it("keeps a run open around the call the reader opened while it stood alone", () => {
    const folds = pressFolds({ calls: ["t-a"], choice: opened, folds: NO_FOLDS, runs: ["t-a"] });
    const run = runOf({ tools: [a, b] });
    expect([runOpen({ folds, group: run }), callOpen({ folds, tool: a, wholeRun: false })]).toEqual([true, true]);
  });

  it("opens a run and its call for a failure the reader has not seen, after they closed it", () => {
    const folds = pressFolds({ calls: [], choice: closed, folds: NO_FOLDS, runs: ["t-a", "t-b"] });
    const broke = failed({ id: "t-b", name: "Bash" });
    expect([
      runOpen({ folds, group: runOf({ tools: [a, broke] }) }),
      callOpen({ folds, tool: broke, wholeRun: false }),
    ]).toEqual([true, true]);
  });

  it("leaves an unpressed run of plain calls closed", () => {
    expect(runOpen({ folds: NO_FOLDS, group: runOf({ tools: [a, b] }) })).toBe(false);
  });
});

describe("adoptRuns", () => {
  const opened = { open: true, seen: new Set<string>() };
  const b = done({ id: "t-b", name: "Read" });

  it("keeps an opened call open after a call joins it and the budget then drops the one pressed", () => {
    const pressed = pressFolds({ calls: ["t-a"], choice: opened, folds: NO_FOLDS, runs: ["t-a"] });
    const grown = adoptRuns({ folds: pressed, runs: [["t-a", "t-b"]] });
    const cut = adoptRuns({ folds: grown, runs: [["t-b"]] });
    expect(callOpen({ folds: cut, tool: b, wholeRun: true })).toBe(true);
  });

  it("copies the run's newest press, never an older one a joined call already carries", () => {
    const first = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-b"] });
    const second = pressFolds({ calls: [], choice: { ...opened, open: false }, folds: first, runs: ["t-a"] });
    expect(adoptRuns({ folds: second, runs: [["t-a", "t-b"]] }).runs["t-b"].press).toBe(2);
  });

  it("answers the same folds when a read changes nothing, so the view settles", () => {
    const pressed = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-a"] });
    const grown = adoptRuns({ folds: pressed, runs: [["t-a", "t-b"]] });
    expect([adoptRuns({ folds: grown, runs: [["t-a", "t-b"]] }) === grown, grown === pressed]).toEqual([true, false]);
  });

  it("numbers no press", () => {
    const pressed = pressFolds({ calls: [], choice: opened, folds: NO_FOLDS, runs: ["t-a"] });
    expect(adoptRuns({ folds: pressed, runs: [["t-a", "t-b"]] }).presses).toBe(1);
  });
});
