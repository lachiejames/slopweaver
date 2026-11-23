/**
 * The draw fold's walk: one pass over a transcript's raw lines, measuring each gap's prompt growth against the
 * results that arrived in it and closing a tick on each recorded `tick close`. `./draw.ts` carries where every
 * number comes from; `./drawFinish.ts` turns the walk's state into the reading.
 */
import { isRecord } from "../lib/parsers.js";
import { finishReading } from "./drawFinish.js";
import {
  type ApiCall,
  CAP_REFUSAL,
  type DrawCall,
  type DrawReading,
  type DrawState,
  preambleCharsOf,
  stripCommandPrefix,
  verbHeadOf,
} from "./drawShapes.js";

/** A number field of a record, 0 when absent or not a number. */
function num({ on, key }: { on: Record<string, unknown>; key: string }): number {
  const value = on[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A string field of a record, "" when absent. */
function str({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/** A tool_result block's body as text, whichever shape it arrived in. */
function resultText({ content }: { content: unknown }): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block: unknown) => (isRecord(block) ? str({ key: "text", on: block }) : ""))
    .filter((text) => text !== "")
    .join("\n");
}

/** The characters a tool_use block's input carried — its command for Bash, its serialised input otherwise. */
function inputCharsOf({ block }: { block: Record<string, unknown> }): number {
  const input = block["input"];
  if (!isRecord(input)) {
    return 0;
  }
  const command = str({ key: "command", on: input });
  return command !== "" ? command.length : JSON.stringify(input).length;
}

/** A call's target for a per-call listing: its command past any `cd`/env prefix, else its file path. */
function inputLabelOf({ input }: { input: Record<string, unknown> }): string {
  const command = str({ key: "command", on: input });
  const label = command !== "" ? stripCommandPrefix({ command }) : str({ key: "file_path", on: input });
  return label.replace(/\s+/gu, " ").slice(0, 120);
}

/** Record an assistant line's API call and its tool calls. */
function onAssistant({ state, parsed }: { state: DrawState; parsed: Record<string, unknown> }): void {
  const message = isRecord(parsed["message"]) ? parsed["message"] : {};
  const messageId = str({ key: "id", on: message });
  const usage = isRecord(message["usage"]) ? message["usage"] : {};
  const known = state.byMessage.get(messageId);
  let api: ApiCall;
  if (known !== undefined && messageId !== "") {
    api = known;
    api.outputTokens = Math.max(api.outputTokens, num({ key: "output_tokens", on: usage }));
  } else {
    api = {
      messageId,
      outputTokens: num({ key: "output_tokens", on: usage }),
      promptTokens:
        num({ key: "input_tokens", on: usage }) +
        num({ key: "cache_creation_input_tokens", on: usage }) +
        num({ key: "cache_read_input_tokens", on: usage }),
      segment: state.segment,
      tick: state.segment,
    };
    measurePending({ next: api, state });
    state.apiCalls.push(api);
    state.byMessage.set(messageId, api);
  }
  const content = Array.isArray(message["content"]) ? message["content"] : [];
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_use") {
      continue;
    }
    const input = isRecord(block["input"]) ? block["input"] : {};
    const tool = str({ key: "name", on: block });
    const call: DrawCall = {
      answered: false,
      apiIndex: state.apiCalls.length - 1,
      capRefusal: false,
      hookRefused: false,
      head: verbHeadOf({ command: str({ key: "command", on: input }), tool }),
      inputChars: inputCharsOf({ block }),
      inputLabel: inputLabelOf({ input }),
      isError: false,
      measured: false,
      measuredTokens: 0,
      preambleChars: 0,
      readIndex: -1,
      refusalLine: "",
      resultChars: 0,
      segment: state.segment,
      tick: state.segment,
      tool,
      toolUseId: str({ key: "id", on: block }),
    };
    state.calls.push(call);
    state.byToolUse.set(call.toolUseId, call);
  }
}

/**
 * Attribute the prompt growth between the last API call and this one to the results that arrived in between.
 *
 * @param state the walk
 * @param next the API call that just read them
 */
function measurePending({ state, next }: { state: DrawState; next: ApiCall }): void {
  const previous = state.apiCalls.at(-1);
  const index = state.apiCalls.length;
  const waiting = state.pending;
  state.pending = [];
  waiting.forEach((call) => {
    call.readIndex = index;
  });
  const attachments = state.pendingAttachments;
  state.pendingAttachments = new Map();
  if (previous === undefined || (waiting.length === 0 && attachments.size === 0)) {
    return;
  }
  const growth = next.promptTokens - previous.promptTokens - previous.outputTokens;
  if (growth < 0 || next.promptTokens < previous.promptTokens) {
    state.epochStarts.push(index);
    return;
  }
  const resultChars = waiting.reduce((sum, call) => sum + call.resultChars, 0);
  const attachmentChars = [...attachments.values()].reduce((sum, chars) => sum + chars, 0);
  const chars = resultChars + attachmentChars;
  waiting.forEach((call) => {
    call.measured = true;
    call.measuredTokens = chars === 0 ? growth / waiting.length : (growth * call.resultChars) / chars;
  });
  if (chars === 0) {
    return;
  }
  attachments.forEach((kindChars, kind) => {
    state.attachments.push({ kind, tick: next.tick, tokens: (growth * kindChars) / chars });
  });
}

/** Note an `attachment` line — a hook's injected context or a harness reminder — against the gap it lands in. */
function onAttachment({ state, parsed }: { state: DrawState; parsed: Record<string, unknown> }): void {
  const attachment = isRecord(parsed["attachment"]) ? parsed["attachment"] : {};
  const kind = str({ key: "type", on: attachment });
  const content = attachment["content"];
  const chars = typeof content === "string" ? content.length : JSON.stringify(attachment).length;
  if (kind === "" || chars === 0) {
    return;
  }
  const prior = state.pendingAttachments.get(kind);
  state.pendingAttachments.set(kind, prior === undefined ? chars : prior + chars);
}

/** Join a user line's tool results to their calls, and close a tick on a recorded `tick close`. */
function onUser({ state, parsed }: { state: DrawState; parsed: Record<string, unknown> }): void {
  if (parsed["isCompactSummary"] === true) {
    state.epochStarts.push(state.apiCalls.length);
  }
  const message = isRecord(parsed["message"]) ? parsed["message"] : {};
  const content = Array.isArray(message["content"]) ? message["content"] : [];
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_result") {
      continue;
    }
    const call = state.byToolUse.get(str({ key: "tool_use_id", on: block }));
    if (call === undefined || call.answered) {
      continue;
    }
    const text = resultText({ content: block["content"] });
    call.answered = true;
    call.resultChars = text.length;
    call.preambleChars = preambleCharsOf({ text });
    call.isError = block["is_error"] === true;
    call.hookRefused = call.isError && text.startsWith("PreToolUse:");
    call.capRefusal = !call.hookRefused && call.head.startsWith("slopweaver ") && CAP_REFUSAL.test(text);
    call.refusalLine = call.capRefusal ? firstRefusalLine({ text }) : "";
    state.pending.push(call);
    closeTick({ call, state, text });
  }
}

/** The first line of a result that names the cap, else its first non-empty line. */
function firstRefusalLine({ text }: { text: string }): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const capLine = lines.find((line) => CAP_REFUSAL.test(line));
  if (capLine === undefined) {
    return lines.join(" ").slice(0, 200);
  }
  return capLine.slice(0, 200);
}

/**
 * The receipt `src/cli/commands/supervisor/tickCloseCommit.ts` prints when a tick is recorded:
 * `supervisor tick close: <handoff>-tick-<n> recorded; …`. The ledger's `n`, not `tick open`'s directory number —
 * the scratch directories are pruned and renumbered, so `tick open: tick 8` recurs across a shift.
 */
const TICK_RECORDED = /^supervisor tick close: \S+-tick-(\d+) recorded/mu;

/** Close the walk's current segment as tick `n` when a `tick close` recorded it. */
function closeTick({ state, call, text }: { state: DrawState; call: DrawCall; text: string }): void {
  if (call.isError || call.head !== "slopweaver supervisor tick close") {
    return;
  }
  const named = TICK_RECORDED.exec(text);
  if (named !== null) {
    state.labels.set(state.segment, Number(named[1]));
    state.segment += 1;
  }
}

/** The kinds of line the walk reads, matched as raw text before any line is parsed. */
const READ_KINDS = ['"type":"assistant"', '"type":"user"', '"type":"attachment"'];

/** One line parsed, when it is a main-thread record of a kind the walk reads; a subagent's or a torn one is not. */
function mainThreadRecordOf({ line }: { line: string }): Record<string, unknown> | undefined {
  if (!READ_KINDS.some((kind) => line.includes(kind))) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["isSidechain"] === true) {
    return undefined;
  }
  return parsed;
}

/**
 * Walk one transcript's raw lines into per-call costs, cap retries and ticks.
 *
 * Only the main thread is read: a subagent's calls are its own context's cost, not the session's.
 *
 * @param lines the transcript's raw lines, in file order
 * @returns the reading
 */
export function drawReading({ lines }: { lines: Iterable<string> }): DrawReading {
  const state: DrawState = {
    apiCalls: [],
    attachments: [],
    byMessage: new Map(),
    byToolUse: new Map(),
    calls: [],
    epochStarts: [0],
    pending: [],
    labels: new Map(),
    pendingAttachments: new Map(),
    segment: 0,
  };
  for (const line of lines) {
    const parsed = mainThreadRecordOf({ line });
    if (parsed === undefined) {
      continue;
    }
    if (parsed["type"] === "assistant") {
      onAssistant({ parsed, state });
    }
    if (parsed["type"] === "user") {
      onUser({ parsed, state });
    }
    if (parsed["type"] === "attachment") {
      onAttachment({ parsed, state });
    }
  }
  return finishReading({ state });
}
