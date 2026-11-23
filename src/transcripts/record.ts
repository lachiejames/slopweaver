/**
 * One line of a Claude Code transcript, decoded into the handful of fields anything here reads.
 *
 * ## Structured, never lexical
 *
 * Every question this module family answers is asked of ROLES, COUNTS and FLAGS — never of a substring
 * sweep over the file. That is a measured decision rather than a taste: a lexical pass over this corpus
 * counts mentions, and the sweeping session's own output is echoed back into its own transcript, so the
 * sweep's top hits are its own words. The typed shape below is what makes the structured question askable.
 *
 * ## What a `.jsonl` line actually holds
 *
 * A transcript interleaves many record `type`s — `assistant`, `user`, and a long tail of housekeeping
 * (`attachment`, `last-prompt`, `mode`, `ai-title`, `queue-operation`, `system`, `file-history-delta`, …).
 * Only `user` and `assistant` carry a `message`; the rest are ignored here rather than modelled, because
 * nothing in this phase asks them anything. Reproduce the inventory with:
 *
 * ```
 * cat ~/.claude/projects/<dir>/*.jsonl | jq -r .type | sort | uniq -c | sort -rn
 * ```
 *
 * A `user` record's `message.content` comes in BOTH shapes Claude Code emits — a bare string, and an array
 * of content blocks (`text`, `image`, `document`, `tool_result`) — so both are decoded here once, rather
 * than at each call site where forgetting one silently loses turns.
 *
 * Pure: text in, typed values out. No I/O, no clock.
 */

import { isRecord } from "../lib/parsers.js";

/** The roles this phase reads. Everything else on a line is housekeeping and is not modelled. */
export type TranscriptRole = "user" | "assistant";

/** One `tool_use` block, reduced to what lets a later result be named and a launched skill be identified. */
export interface ToolUseBlock {
  /** The call's id, which the answering `tool_result` quotes back. */
  readonly toolUseId: string;
  /** The tool that was called, e.g. `Bash`. */
  readonly name: string;
  /**
   * For a `Bash` call, `input.command` — the shell it ran; "" for every other tool.
   *
   * `Bash` is not one tool: `git status` and a ten-minute test run share its name, so a latency question
   * asked of `Bash` as a whole compares workloads rather than machines. `./latency.ts` cuts a homogeneous
   * slice by the prefix of this field, which is the only thing on the record that can distinguish them.
   */
  readonly command: string;
  /**
   * For a `Skill` call, `input.skill` — the skill that was launched; "" for every other tool.
   *
   * The tool NAME alone says nothing here: every skill invocation is a call to `Skill`, so the one field
   * that distinguishes them is its input. `../supervisor/chainScan.ts` asks exactly this question of a
   * transcript to decide whether the session ever ran as the supervisor.
   */
  readonly skill: string;
}

/** One `tool_result` block, reduced to what a structured query asks of it. */
interface ToolResultBlock {
  /** The `tool_use` this answers, so a caller can join it back to the call that produced it. */
  readonly toolUseId: string;
  /** Whether the tool reported a failure. `is_error` is absent on many results; absent reads as false. */
  readonly isError: boolean;
  /** The result body, flattened to text. A block-array body is joined; a non-text block contributes "". */
  readonly text: string;
}

/** A decoded `user` or `assistant` line. */
export interface TranscriptRecord {
  readonly role: TranscriptRole;
  /** The 1-based position in the file, so every answer can point at the line it came from. */
  readonly lineNumber: number;
  /** The record's own uuid, or "" when the line carried none. */
  readonly uuid: string;
  /** The record's ISO timestamp, or "" when the line carried none. */
  readonly timestamp: string;
  /** `message.content`'s text blocks joined with newlines — "" when the content held no text at all. */
  readonly text: string;
  /** Every `tool_result` block on the line, in order. */
  readonly toolResults: readonly ToolResultBlock[];
  /** Every `tool_use` block on the line, in order — an assistant record's calls. */
  readonly toolUses: readonly ToolUseBlock[];
  /** The block `type`s the content carried, in order — how an image-only or document-only turn is spotted. */
  readonly blockKinds: readonly string[];
  /** `promptSource` — `typed`, `queued`, `suggestion_accepted`, `system`, `sdk`, or "" when absent. */
  readonly promptSource: string;
  /** `origin.kind` — `human`, `task-notification`, `peer`, … or "" when the line carried no origin. */
  readonly originKind: string;
  /** `isMeta` — Claude Code's own marker for a message it injected rather than a person sending one. */
  readonly isMeta: boolean;
  /** Whether the line carried a `toolUseResult` payload, the sibling marker of a tool_result content block. */
  readonly hasToolUseResult: boolean;
  /** `isCompactSummary` — set on the synthetic turn a compaction writes in place of the history it dropped. */
  readonly isCompactSummary: boolean;
  /** `isSidechain` — set on a subagent's own turns, which are not the main thread's. */
  readonly isSidechain: boolean;
  /** The model that served an assistant turn, or "" for a user record or an unnamed model. */
  readonly model: string;
  /** The working directory the session was running in, or "" when the line carried none. */
  readonly cwd: string;
}

/** A line that would not decode into a record, and why — never thrown, always counted. */
export interface UndecodedLine {
  /** 1-based position in the file, so a caller can go and look at it. */
  readonly lineNumber: number;
  /**
   * What stopped it decoding: not JSON, not an object, not a role this phase reads, past the line cap, or a
   * `type` that is no string or a message whose content is neither a string nor an array — either of which may
   * have been a turn — or a queued prompt whose `origin` names neither the owner nor a peer, so nothing says who typed it.
   */
  readonly why:
    "not-json" | "not-an-object" | "not-a-message-role" | "malformed-message" | "oversized" | "unproven-origin";
}

/** Either a decoded record or the reason the line yielded none. Not a Result — neither arm is a failure. */
export type LineReading = { readonly record: TranscriptRecord } | { readonly undecoded: UndecodedLine };

/**
 * Read a string field off a decoded line, defaulting to "" rather than to `undefined`.
 *
 * The default is empty-string rather than optional on purpose: every consumer here renders or compares
 * these, and an `undefined` that has to be re-defaulted at each call site is where a `?? ""` sprawls.
 *
 * @param on the decoded object
 * @param key the field to read
 * @returns the string value, or ""
 */
function str({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/**
 * Flatten a `tool_result` block's body to text.
 *
 * The body is a string on the overwhelming majority of results and a block array on the rest (measured
 * 26,744 string vs 477 array over one project directory; reproduce with a `jq` pass over
 * `message.content[] | select(.type=="tool_result") | .content | type`). Both are flattened here so a
 * caller never has to ask which it got.
 *
 * @param content the block's `content` field, in whichever shape it arrived
 * @returns the body as text, or "" when it held none
 */
function toolResultText({ content }: { content: unknown }): string {
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

/**
 * Reduce one `tool_use` block to the three fields anything here reads.
 *
 * @param block the decoded content block
 * @returns the call's id, the tool it named, the skill it launched and the shell it ran, where each applies
 */
function toolUseOf({ block }: { block: Record<string, unknown> }): ToolUseBlock {
  const input = isRecord(block["input"]) ? block["input"] : {};
  return {
    command: str({ key: "command", on: input }),
    name: str({ key: "name", on: block }),
    skill: str({ key: "skill", on: input }),
    toolUseId: str({ key: "id", on: block }),
  };
}

/** What a content array decomposed into: its text, its tool traffic, and the block kinds it carried. */
interface DecodedContent {
  readonly text: string;
  readonly toolResults: readonly ToolResultBlock[];
  readonly toolUses: readonly ToolUseBlock[];
  readonly blockKinds: readonly string[];
  /**
   * Blocks that are not a block: not an object, no string `type`, or a `text` block whose `text` is not a string.
   * Their words are not in `text`, so a verbatim reader refuses a turn carrying any rather than quote what is left.
   */
  readonly malformedBlocks: number;
}

/** Whether one content-array member is malformed: not an object, no string `type`, or text with no string `text`. */
function isMalformedBlock({ block }: { block: unknown }): boolean {
  if (!isRecord(block) || typeof block["type"] !== "string") {
    return true;
  }
  return block["type"] === "text" && typeof block["text"] !== "string";
}

/**
 * Decompose `message.content` in either of the two shapes Claude Code emits.
 *
 * @param content a bare string, or an array of content blocks
 * @returns the joined text, every tool_result block, the block kinds in order, and how many blocks were malformed
 */
export function decodeContent({ content }: { content: unknown }): DecodedContent {
  if (typeof content === "string") {
    return { blockKinds: ["text"], malformedBlocks: 0, text: content, toolResults: [], toolUses: [] };
  }
  if (!Array.isArray(content)) {
    return { blockKinds: [], malformedBlocks: 0, text: "", toolResults: [], toolUses: [] };
  }
  const texts: string[] = [];
  const toolResults: ToolResultBlock[] = [];
  const toolUses: ToolUseBlock[] = [];
  const blockKinds: string[] = [];
  let malformedBlocks = 0;
  for (const block of content) {
    if (isMalformedBlock({ block }) || !isRecord(block)) {
      malformedBlocks += 1;
      continue;
    }
    const kind = str({ key: "type", on: block });
    blockKinds.push(kind);
    if (kind === "text") {
      texts.push(str({ key: "text", on: block }));
    }
    if (kind === "tool_result") {
      toolResults.push({
        isError: block["is_error"] === true,
        text: toolResultText({ content: block["content"] }),
        toolUseId: str({ key: "tool_use_id", on: block }),
      });
    }
    if (kind === "tool_use") {
      toolUses.push(toolUseOf({ block }));
    }
  }
  return { blockKinds, malformedBlocks, text: texts.join("\n"), toolResults, toolUses };
}

/** The flags that say whose a record is, each read only as the exact boolean the harness writes. */
const PROVENANCE_FLAGS = ["isSidechain", "isMeta", "isCompactSummary"] as const;

/**
 * Whether a line's provenance markers are present but not of the shape the harness writes: a flag that is no boolean,
 * a `promptSource` that is no string, an `origin` that is no object. Read as `=== true`, a malformed flag would make a
 * subagent's prompt look like the owner's, so such a user record is unread rather than guessed at.
 *
 * @param parsed the decoded line
 * @returns whether any marker is malformed
 */
export function provenanceMalformed({ parsed }: { parsed: Record<string, unknown> }): boolean {
  const flagBad = PROVENANCE_FLAGS.some((key) => parsed[key] !== undefined && typeof parsed[key] !== "boolean");
  const sourceBad = parsed["promptSource"] !== undefined && typeof parsed["promptSource"] !== "string";
  const originBad = parsed["origin"] !== undefined && !isRecord(parsed["origin"]);
  return flagBad || sourceBad || originBad;
}

/**
 * Decode one transcript line.
 *
 * A malformed line is REPORTED, never thrown on and never silently dropped: a transcript is appended to
 * live, so its last line is routinely a half-written fragment, and a bounded read that begins mid-file
 * begins mid-line. Both are ordinary, and both must be visible as a count rather than as a missing turn.
 *
 * @param line the raw JSONL line
 * @param lineNumber the 1-based position, carried into an undecoded reading so a caller can go and look
 * @returns the decoded record, or the reason the line yielded none
 */
export function readTranscriptLine({ line, lineNumber }: { line: string; lineNumber: number }): LineReading {
  if (line.trim() === "") {
    return { undecoded: { lineNumber, why: "not-json" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { undecoded: { lineNumber, why: "not-json" } };
  }
  if (!isRecord(parsed)) {
    return { undecoded: { lineNumber, why: "not-an-object" } };
  }
  if (typeof parsed["type"] !== "string") {
    return { undecoded: { lineNumber, why: "malformed-message" } };
  }
  const type = parsed["type"];
  if (type !== "user" && type !== "assistant") {
    return { undecoded: { lineNumber, why: "not-a-message-role" } };
  }
  const message = isRecord(parsed["message"]) ? parsed["message"] : {};
  const rawContent = message["content"];
  if (typeof rawContent !== "string" && !Array.isArray(rawContent)) {
    return { undecoded: { lineNumber, why: "malformed-message" } };
  }
  const content = decodeContent({ content: rawContent });
  // A user record's text is quoted as the owner's whole turn, so one malformed block is the line unread, never a fragment.
  if (type === "user" && (content.malformedBlocks > 0 || provenanceMalformed({ parsed }))) {
    return { undecoded: { lineNumber, why: "malformed-message" } };
  }
  const origin = isRecord(parsed["origin"]) ? parsed["origin"] : {};
  return {
    record: {
      blockKinds: content.blockKinds,
      cwd: str({ key: "cwd", on: parsed }),
      hasToolUseResult: parsed["toolUseResult"] !== undefined,
      isCompactSummary: parsed["isCompactSummary"] === true,
      isMeta: parsed["isMeta"] === true,
      isSidechain: parsed["isSidechain"] === true,
      lineNumber,
      model: str({ key: "model", on: message }),
      originKind: str({ key: "kind", on: origin }),
      promptSource: str({ key: "promptSource", on: parsed }),
      role: type,
      text: content.text,
      timestamp: str({ key: "timestamp", on: parsed }),
      toolResults: content.toolResults,
      toolUses: content.toolUses,
      uuid: str({ key: "uuid", on: parsed }),
    },
  };
}
