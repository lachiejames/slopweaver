/**
 * The session view's tool-activity grouping: a turn's parts folded into rows a reader can scan, where every
 * run of consecutive tool calls between two pieces of prose becomes ONE row with a one-line summary, and the
 * calls themselves sit behind it.
 *
 * The design is the archive's (`ai-tool-group.tsx`, `buildTimelineExpandedRows`): a group is flushed at every
 * text or thinking boundary and never spans one, so the order a session worked in survives the fold. What is
 * this repository's own is the vocabulary: the archive named a hosted app's platforms, and a Claude session
 * calls Claude Code's tools, so the summary counts reads, searches, edits, commands, subagents and each MCP
 * server by the tool names a transcript actually carries.
 *
 * Pure, and imports `ai` for its TYPES only: a test under `site/__tests__/unit` reaches it without React.
 */
import type { DynamicToolUIPart, UIMessage } from "ai";

/** One part of a message, as AI Elements draws it. */
export type TurnPart = UIMessage["parts"][number];

/** A run of consecutive tool calls, drawn as one row. */
export interface ToolGroupRow {
  readonly kind: "tool-group";
  /**
   * The first call's id: stable while the run grows, but not once the answer's part budget drops that call. Fold
   * state is therefore never held against this key — it is keyed by call id ({@link runChoiceOf}).
   */
  readonly key: string;
  readonly tools: readonly DynamicToolUIPart[];
  /** How many calls are still waiting on a result. */
  readonly running: number;
  /** The calls whose result was a failure — any one of them opens the group until the reader folds it. */
  readonly failed: readonly DynamicToolUIPart[];
  /** What the run did, in the order it first did each kind of thing: `3 reads · 1 search · 2 commands`. */
  readonly summary: string;
}

/** One row of a message: a part drawn as it is, or a group of tool calls. */
export type TurnRow = { readonly kind: "part"; readonly key: string; readonly part: TurnPart } | ToolGroupRow;

/** A kind of tool activity, and the noun a count of it is said with. */
interface Bucket {
  readonly id: string;
  readonly singular: string;
  readonly plural: string;
}

/** Claude Code's own tools, by the kind of work each call is. A tool not named here is counted by its own name. */
const KNOWN: ReadonlyMap<string, Bucket> = new Map([
  ["Read", { id: "read", plural: "reads", singular: "read" }],
  ["Grep", { id: "search", plural: "searches", singular: "search" }],
  ["Glob", { id: "search", plural: "searches", singular: "search" }],
  ["ToolSearch", { id: "search", plural: "searches", singular: "search" }],
  ["WebSearch", { id: "web", plural: "web reads", singular: "web read" }],
  ["WebFetch", { id: "web", plural: "web reads", singular: "web read" }],
  ["Edit", { id: "edit", plural: "edits", singular: "edit" }],
  ["Write", { id: "edit", plural: "edits", singular: "edit" }],
  ["NotebookEdit", { id: "edit", plural: "edits", singular: "edit" }],
  ["Bash", { id: "command", plural: "commands", singular: "command" }],
  ["Agent", { id: "subagent", plural: "subagents", singular: "subagent" }],
  ["Task", { id: "subagent", plural: "subagents", singular: "subagent" }],
]);

/** An MCP tool's name: `mcp__<server>__<tool>`. */
const MCP_NAME = /^mcp__(.+?)__.+$/;

/**
 * The bucket one tool call is counted in.
 *
 * @returns the bucket: a known kind of work, the MCP server the call went to, or the tool's own name
 */
function bucketOf({ toolName }: { toolName: string }): Bucket {
  const known = KNOWN.get(toolName);
  if (known !== undefined) {
    return known;
  }
  const server = MCP_NAME.exec(toolName)?.[1];
  if (server !== undefined) {
    return { id: `mcp:${server}`, plural: `${server} calls`, singular: `${server} call` };
  }
  return { id: `tool:${toolName}`, plural: `${toolName} calls`, singular: `${toolName} call` };
}

/**
 * What a run of tool calls did, one count per kind of work, in the order the run first did each.
 *
 * @returns the line, e.g. `3 reads · 1 search · 2 commands`; "" for no calls
 */
export function groupSummary({ tools }: { tools: readonly DynamicToolUIPart[] }): string {
  const counts = new Map<string, { bucket: Bucket; count: number }>();
  for (const tool of tools) {
    const bucket = bucketOf({ toolName: tool.toolName });
    const seen = counts.get(bucket.id);
    if (seen === undefined) {
      counts.set(bucket.id, { bucket, count: 1 });
    } else {
      seen.count += 1;
    }
  }
  return [...counts.values()]
    .map(({ bucket, count }) => `${String(count)} ${count === 1 ? bucket.singular : bucket.plural}`)
    .join(" · ");
}

/**
 * Close a run of tool calls into one group row.
 *
 * @returns the row
 */
function groupOf({ tools }: { tools: readonly DynamicToolUIPart[] }): ToolGroupRow {
  return {
    failed: tools.filter((tool) => tool.state === "output-error"),
    key: `tools:${tools[0].toolCallId}`,
    kind: "tool-group",
    running: tools.filter((tool) => tool.state === "input-available" || tool.state === "input-streaming").length,
    summary: groupSummary({ tools }),
    tools,
  };
}

/**
 * Fold a message's parts into rows: every part that is not a tool call passes through as itself, and every
 * run of consecutive tool calls becomes one group. A group is closed at each text or thinking part and at
 * the end, so no group ever spans prose. A run of one call is still a group; the view decides how to draw it.
 * A part is keyed by its position in the whole turn, so the budget dropping the turn's oldest parts never
 * re-keys the parts still drawn.
 *
 * @param parts the message's parts, in the order the session produced them
 * @param offset how many of the turn's parts before these were dropped, 0 when none were
 * @returns the rows, in the same order
 */
export function groupTurnParts({
  parts,
  offset = 0,
}: {
  parts: readonly TurnPart[];
  offset?: number;
}): readonly TurnRow[] {
  const rows: TurnRow[] = [];
  let run: DynamicToolUIPart[] = [];
  parts.forEach((part, index) => {
    if (part.type === "dynamic-tool") {
      run.push(part);
      return;
    }
    if (run.length > 0) {
      rows.push(groupOf({ tools: run }));
      run = [];
    }
    rows.push({ key: `part:${String(offset + index)}`, kind: "part", part });
  });
  if (run.length > 0) {
    rows.push(groupOf({ tools: run }));
  }
  return rows;
}

/** A reader's press on a fold, and which failed calls were on screen when they made it. */
export interface FoldChoice {
  readonly open: boolean;
  /** The ids of the calls that had failed at the moment of the press. */
  readonly seen: ReadonlySet<string>;
}

/**
 * Whether a fold — a call's, or a run's — is open. Until the reader presses it, it opens itself when
 * `opensItself` says so. After a press the reader's choice stands, except that a call failing after the press
 * opens it again: a failure the reader has not seen is the one result they came for, so no earlier fold may
 * hide it.
 *
 * @param opensItself whether the fold opens itself before any press — a failure inside it, or a call inside
 *   it the reader already opened
 * @param failedIds the calls inside the fold that have failed, as of this read
 * @param chosen the reader's last press, `undefined` before one
 * @returns true when the fold is open
 */
export function foldOpen({
  opensItself,
  failedIds,
  chosen,
}: {
  opensItself: boolean;
  failedIds: readonly string[];
  chosen: FoldChoice | undefined;
}): boolean {
  if (chosen === undefined || failedIds.some((failedId) => !chosen.seen.has(failedId))) {
    return opensItself || failedIds.length > 0;
  }
  return chosen.open;
}

/**
 * A reader's press on a fold, numbered across every fold in the view so the newest press wins wherever two
 * of them could decide the same fold.
 */
export interface NumberedChoice extends FoldChoice {
  readonly press: number;
}

/**
 * The newest of some presses.
 *
 * @param choices presses that could each decide one fold, any of them absent
 * @returns the highest-numbered one, `undefined` when every one is absent
 */
export function newestChoice({
  choices,
}: {
  choices: readonly (NumberedChoice | undefined)[];
}): NumberedChoice | undefined {
  let newest: NumberedChoice | undefined;
  choices.forEach((choice) => {
    if (choice !== undefined && (newest === undefined || choice.press > newest.press)) {
      newest = choice;
    }
  });
  return newest;
}

/**
 * The reader's latest press on a run. A press is recorded against EVERY call the run held when it was made,
 * because no single call names a run for long: the answer's part budget drops a run's oldest calls as the turn
 * grows, and a run's first call is gone the moment that happens. Any surviving call still carries the press —
 * and when only one survives, the run is drawn as that call alone, which the same press still decides unless
 * the reader has pressed the call itself since.
 *
 * @param choices each call's id to the last press made on a run holding it
 * @param tools the run's calls, as of this read
 * @returns the newest press on any of them, `undefined` when there is none
 */
export function runChoiceOf({
  choices,
  tools,
}: {
  choices: Readonly<Record<string, NumberedChoice>>;
  tools: readonly DynamicToolUIPart[];
}): NumberedChoice | undefined {
  return newestChoice({ choices: tools.map((tool) => choices[tool.toolCallId]) });
}

/**
 * Every fold the reader has pressed, held once for the whole view and keyed by call id — never by a row's key,
 * which moves when the answer's part budget drops a run's oldest call.
 */
export interface Folds {
  /** Each call's id to the reader's last press on that call. */
  readonly calls: Readonly<Record<string, NumberedChoice>>;
  /** Each call's id to the reader's last press on a run holding it. */
  readonly runs: Readonly<Record<string, NumberedChoice>>;
  /** How many presses so far, on a call or a run — what numbers the next one. */
  readonly presses: number;
}

/** A view the reader has not pressed anything in. */
export const NO_FOLDS: Folds = { calls: {}, presses: 0, runs: {} };

/**
 * The folds after one press. A press on a run is recorded against every call it holds; a press on a run's only
 * call is recorded as a press on the call AND on the run, because that call is drawn as the whole run — so a
 * call joining it later finds that press, never an older one on the run.
 *
 * @param calls the calls pressed as calls
 * @param runs the calls of the run pressed as a run
 * @param choice what the press chose, and which failures were on screen for it
 * @returns the folds with the press recorded under the next number
 */
export function pressFolds({
  folds,
  calls,
  runs,
  choice,
}: {
  folds: Folds;
  calls: readonly string[];
  runs: readonly string[];
  choice: FoldChoice;
}): Folds {
  const press = folds.presses + 1;
  const stamped = { ...choice, press };
  const nextCalls = { ...folds.calls };
  calls.forEach((callId) => {
    nextCalls[callId] = stamped;
  });
  const nextRuns = { ...folds.runs };
  runs.forEach((callId) => {
    nextRuns[callId] = stamped;
  });
  return { calls: nextCalls, presses: press, runs: nextRuns };
}

/**
 * Whether one call is open. A run's only call is the whole run, so the newer of a press on it and a press on
 * the run decides it; a call inside a larger run answers to its own press alone.
 *
 * @param wholeRun whether the call is its run's only one
 * @returns true when the call is drawn open
 */
export function callOpen({
  folds,
  tool,
  wholeRun,
}: {
  folds: Folds;
  tool: DynamicToolUIPart;
  wholeRun: boolean;
}): boolean {
  const failedIds = tool.state === "output-error" ? [tool.toolCallId] : [];
  const runChoice = wholeRun ? folds.runs[tool.toolCallId] : undefined;
  const chosen = newestChoice({ choices: [folds.calls[tool.toolCallId], runChoice] });
  return foldOpen({ chosen, failedIds, opensItself: false });
}

/**
 * Whether a run of more than one call is open: the reader's newest press on it, and before one, open when it
 * holds a failure or a call the reader opened.
 *
 * @returns true when the run is drawn open
 */
export function runOpen({ folds, group }: { folds: Folds; group: ToolGroupRow }): boolean {
  return foldOpen({
    chosen: runChoiceOf({ choices: folds.runs, tools: group.tools }),
    failedIds: group.failed.map((tool) => tool.toolCallId),
    opensItself: group.tools.some((tool) => folds.calls[tool.toolCallId]?.open === true),
  });
}

/**
 * The folds with every run's newest press copied onto each call it now holds. A press is recorded against the
 * calls a run held when it was made, but the run keeps growing, and the part budget can later drop every one
 * of those calls while a call that joined after the press survives. Copying the press on each read is what
 * lets that survivor still answer for the run. Never numbers a new press.
 *
 * @param runs each run on screen, as its calls' ids in session order
 * @returns `folds` itself when every call already carries its run's newest press, so a caller can tell a read
 *   that changed nothing
 */
export function adoptRuns({ folds, runs }: { folds: Folds; runs: readonly (readonly string[])[] }): Folds {
  const nextRuns: Record<string, NumberedChoice> = { ...folds.runs };
  let changed = false;
  for (const callIds of runs) {
    const newest = newestChoice({ choices: callIds.map((callId) => folds.runs[callId]) });
    for (const callId of callIds) {
      if (newest !== undefined && folds.runs[callId] !== newest) {
        nextRuns[callId] = newest;
        changed = true;
      }
    }
  }
  if (!changed) {
    return folds;
  }
  return { ...folds, runs: nextRuns };
}
