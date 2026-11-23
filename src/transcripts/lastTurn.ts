/**
 * One session's LATEST TURN, as the ordered parts a reader sees: the words a person typed, then every text
 * block, thinking block and tool call the assistant produced after it, each tool call joined to its result.
 *
 * What the console's session view draws (`site/app/(console)/fleet/session/[id]`), and why it is a fold of its
 * own rather than a use of {@link ./record}: `TranscriptRecord` keeps a tool call's name and command but not
 * its input, and records a thinking block's KIND but not its words — both right for the structured counts
 * that module serves, and both exactly what a reader of one turn wants to see.
 *
 * ## Where a turn begins
 *
 * At the last `user` record a person actually typed, judged by {@link classifyRecord} — the same judgement
 * `transcripts turns` makes — so a tool result, a reminder or a task notification never opens a turn. A
 * subagent's sidechain records are skipped outright: they are another thread's, not this one's. A caller
 * asking for more than one turn gets the turns before it too, each running from one opening to the next and
 * keyed by its opening record's uuid, so a view polling them never re-keys what it already drew.
 *
 * ## Bounded, and redacted before it leaves
 *
 * The caller hands in a TAIL of the file, never the whole of it, and says whether that tail began at byte 0.
 * When it did not and no typed turn was in it, the answer says so (`turnStartSeen: false`) rather than
 * presenting a fragment as the turn. Every string is cut to a stated cap with `truncated` set, only the last
 * {@link MAX_PARTS} parts across the whole answer are kept with the rest counted, at most {@link MAX_TURNS}
 * turns are answered, and every string passes {@link redactSecrets} —
 * a tool's output is exactly where a token turns up.
 *
 * Pure: lines in, typed value out. No I/O, no clock.
 */

import { isRecord } from "#lib/parsers.js";
import { redactSecrets } from "../corpus/redact.js";
import { classifyRecord } from "./extract.js";
import { readTranscriptLine, type TranscriptRecord } from "./record.js";

/** The most characters one text or thinking part carries before it is cut. */
const TEXT_CHARS = 20_000;

/** The most characters one tool call's input, or its output, carries before it is cut. */
export const TOOL_CHARS = 4_000;

/** The most characters a label carries — a path, a model, a timestamp, a tool's name or id. */
const LABEL_CHARS = 1_000;

/**
 * The most parts one answer carries, across every turn in it; the oldest parts past it are counted in their
 * turn's `partsDropped`, never shown, so the newest evidence is what survives.
 */
export const MAX_PARTS = 400;

/** The most turns one answer carries: the latest and up to thirty-nine before it. */
export const MAX_TURNS = 40;

/** The latest turn's id when the lines read hold no opening — the console carries the previous read's id over it. */
export const FRAGMENT_TURN_ID = "latest-fragment";

/** Where a tool call stands: no result yet, a result, or a result the tool marked a failure. */
type ToolCallState = "running" | "done" | "error";

/** One thing the assistant produced during the turn, in the order it produced it. */
type TurnPart =
  | { readonly type: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly type: "reasoning"; readonly text: string; readonly truncated: boolean }
  | {
      readonly type: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly state: ToolCallState;
      /** The call's input as indented JSON. */
      readonly input: string;
      /** The result body as text, "" while the call is still running. */
      readonly output: string;
      readonly truncated: boolean;
    };

/** The words that opened the turn. */
interface TurnPrompt {
  readonly text: string;
  readonly timestamp: string;
  readonly truncated: boolean;
}

/** A turn before the latest one: always opened by a typed turn, since that opening is what bounds it. */
interface EarlierTurn {
  /** The opening record's uuid, so a reader polling the turn keys it the same way every time. */
  readonly turnId: string;
  readonly prompt: TurnPrompt;
  readonly parts: readonly TurnPart[];
  /** How many of this turn's parts {@link MAX_PARTS} cut off the front of the whole answer. */
  readonly partsDropped: number;
}

/** One session's latest turn, and as many turns before it as were asked for and are in the lines read. */
export interface LastTurn {
  /**
   * The latest turn's identity: its opening record's uuid, or {@link FRAGMENT_TURN_ID} when the lines read
   * hold no opening. Never derived from a timestamp, which moves on every write.
   */
  readonly turnId: string;
  /** The typed turn that opened it, or `undefined` when none was in the lines read. */
  readonly prompt: TurnPrompt | undefined;
  readonly parts: readonly TurnPart[];
  /** How many earlier parts {@link MAX_PARTS} cut off the front. */
  readonly partsDropped: number;
  /** The turns before the latest, oldest first — at most `turns - 1` of them. */
  readonly earlier: readonly EarlierTurn[];
  /**
   * How many whole turns before the latest the lines read hold, whether or not they were asked for — what a
   * reader may ask for next. It counts the TAIL, never the session's whole history.
   */
  readonly earlierTurnsInTail: number;
  /** Whether the lines read included the turn's opening — false means `parts` may begin mid-turn. */
  readonly turnStartSeen: boolean;
  /** The newest timestamp on any record read, "" when none carried one. */
  readonly lastTimestamp: string;
  /** The model that served the newest assistant record, "" when there was none. */
  readonly model: string;
  /** The session's working directory, "" when no record carried one. */
  readonly cwd: string;
}

/**
 * Redact a string, then cut it to a cap. Redaction runs FIRST: cut first, a token straddling the cap keeps a
 * prefix too short for {@link redactSecrets} to recognise, and that prefix would print.
 *
 * @returns the redacted text and whether it was cut
 */
function bounded({ text, cap }: { text: string; cap: number }): { text: string; truncated: boolean } {
  const redacted = redactSecrets({ text }).text;
  const truncated = redacted.length > cap;
  return { text: truncated ? `${redacted.slice(0, cap)}…` : redacted, truncated };
}

/** A short transcript string cut to {@link LABEL_CHARS} and redacted: every string the verb prints passes {@link bounded}. */
function label({ text }: { text: string }): string {
  return bounded({ cap: LABEL_CHARS, text }).text;
}

/** A string field of a block, or "" when it is absent or not a string. */
function field({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/** A tool call's input as indented JSON; an input that will not serialise is named rather than dropped. */
function inputText({ input }: { input: unknown }): string {
  if (input === undefined) {
    return "";
  }
  try {
    const text = JSON.stringify(input, undefined, 2);
    return typeof text === "string" ? text : "";
  } catch {
    return "(input could not be shown)";
  }
}

/** The raw content blocks of an assistant line, or an empty list when the line holds none. */
function assistantBlocks({ line }: { line: string }): readonly Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed["message"])) {
    return [];
  }
  const content = parsed["message"]["content"];
  if (typeof content === "string") {
    return [{ text: content, type: "text" }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((block): block is Record<string, unknown> => isRecord(block));
}

/** The parts one assistant block contributes: none, a text, a reasoning, or a running tool call. */
function partOf({ block }: { block: Record<string, unknown> }): TurnPart | undefined {
  const kind = field({ key: "type", on: block });
  if (kind === "text") {
    const text = field({ key: "text", on: block });
    return text.trim() === "" ? undefined : { type: "text", ...bounded({ cap: TEXT_CHARS, text }) };
  }
  if (kind === "thinking") {
    const text = field({ key: "thinking", on: block });
    return text.trim() === "" ? undefined : { type: "reasoning", ...bounded({ cap: TEXT_CHARS, text }) };
  }
  if (kind === "tool_use") {
    const input = bounded({ cap: TOOL_CHARS, text: inputText({ input: block["input"] }) });
    return {
      input: input.text,
      output: "",
      state: "running",
      toolCallId: label({ text: field({ key: "id", on: block }) }),
      toolName: label({ text: field({ key: "name", on: block }) }),
      truncated: input.truncated,
      type: "tool",
    };
  }
  return undefined;
}

/** One parsed record beside the raw line it came from; the raw line still carries the assistant's blocks. */
interface KeptRecord {
  readonly line: string;
  readonly record: TranscriptRecord;
}

/** Whether a record opens a turn: a main-thread user record a person actually typed. */
function opensTurn({ record }: { record: TranscriptRecord }): boolean {
  return !record.isSidechain && record.role === "user" && classifyRecord({ record }).kind === "human";
}

/** The index of every record that opens a turn, oldest first. */
function openings({ kept }: { kept: readonly KeptRecord[] }): readonly number[] {
  return kept.flatMap(({ record }, index) => (opensTurn({ record }) ? [index] : []));
}

/** A turn's identity: its opening record's uuid, else its timestamp — both fixed once the line is written. */
function turnIdOf({ opening }: { opening: KeptRecord }): string {
  if (opening.record.uuid !== "") {
    return label({ text: opening.record.uuid });
  }
  return label({ text: `at:${opening.record.timestamp}` });
}

/** One turn's slice of the records, before the answer-wide part budget is applied. */
interface Slice {
  readonly opening: KeptRecord | undefined;
  readonly parts: readonly TurnPart[];
}

/**
 * Apply {@link MAX_PARTS} across every slice at once, cutting from the front of the OLDEST, so the newest
 * parts survive; each slice keeps its own count of what was cut from it.
 *
 * @returns each slice's surviving parts and how many were cut, in the order given
 */
function budgeted({
  slices,
}: {
  slices: readonly Slice[];
}): readonly { parts: readonly TurnPart[]; dropped: number }[] {
  const total = slices.reduce((sum, slice) => sum + slice.parts.length, 0);
  let toDrop = Math.max(0, total - MAX_PARTS);
  return slices.map((slice) => {
    const dropped = Math.min(toDrop, slice.parts.length);
    toDrop -= dropped;
    return { dropped, parts: slice.parts.slice(dropped) };
  });
}

/** The newest non-empty value one string field carries across the records, "" when none does. */
function newest({ kept, pick }: { kept: readonly KeptRecord[]; pick: (record: TranscriptRecord) => string }): string {
  const found = kept.map(({ record }) => pick(record)).findLast((value) => value !== "");
  if (found === undefined) {
    return "";
  }
  return label({ text: found });
}

/** The words that opened the turn at `opening`, cut and redacted. */
function promptOf({ opening }: { opening: KeptRecord }): TurnPrompt {
  const reading = classifyRecord({ record: opening.record });
  const text = reading.kind === "human" ? reading.turn.text : opening.record.text;
  return { timestamp: label({ text: opening.record.timestamp }), ...bounded({ cap: TEXT_CHARS, text }) };
}

/** Append an assistant line's parts, remembering where each tool call landed so its result can join it. */
function appendAssistant({
  line,
  parts,
  toolIndex,
}: {
  line: string;
  parts: TurnPart[];
  toolIndex: Map<string, number>;
}): void {
  for (const block of assistantBlocks({ line })) {
    const part = partOf({ block });
    if (part?.type === "tool") {
      // Keyed on the RAW id a result names, never the redacted one the part carries.
      toolIndex.set(field({ key: "id", on: block }), parts.length);
    }
    if (part !== undefined) {
      parts.push(part);
    }
  }
}

/** Join each tool result a user record carries to the call it answers; a result for no known call is skipped. */
function joinResults({
  record,
  parts,
  toolIndex,
}: {
  record: TranscriptRecord;
  parts: TurnPart[];
  toolIndex: Map<string, number>;
}): void {
  for (const result of record.toolResults) {
    const at = toolIndex.get(result.toolUseId);
    const call = at === undefined ? undefined : parts[at];
    if (at === undefined || call?.type !== "tool") {
      continue;
    }
    const output = bounded({ cap: TOOL_CHARS, text: result.text });
    parts[at] = {
      ...call,
      output: output.text,
      state: result.isError ? "error" : "done",
      truncated: call.truncated || output.truncated,
    };
  }
}

/** Every part the main thread produced across the records, in order, each tool call joined to its result. */
function partsOf({ kept }: { kept: readonly KeptRecord[] }): TurnPart[] {
  const parts: TurnPart[] = [];
  const toolIndex = new Map<string, number>();
  for (const { line, record } of kept.filter(({ record: r }) => !r.isSidechain)) {
    if (record.role === "assistant") {
      appendAssistant({ line, parts, toolIndex });
    } else {
      joinResults({ parts, record, toolIndex });
    }
  }
  return parts;
}

/**
 * Fold a transcript's lines into its latest turn, and the turns before it that were asked for.
 *
 * Each turn runs from one typed opening to the next; a tool result is joined only to a call in its own turn.
 *
 * @param lines the transcript's lines, oldest first — a tail of the file is expected, never the whole of it
 * @param fromStart whether `lines` begins at the file's first byte, so a missing typed turn means there was none
 * @param turns how many turns to answer with, the latest included — 1 to {@link MAX_TURNS}, checked by the caller
 * @returns the turn, with its bounds and whether its opening was seen
 */
export function foldLastTurn({
  lines,
  fromStart,
  turns = 1,
}: {
  lines: readonly string[];
  fromStart: boolean;
  turns?: number;
}): LastTurn {
  const kept = lines.flatMap((line, index): KeptRecord[] => {
    const reading = readTranscriptLine({ line, lineNumber: index + 1 });
    return "record" in reading ? [{ line, record: reading.record }] : [];
  });
  const opened = openings({ kept });
  const sliceAt = ({ at }: { at: number }): Slice => {
    const start = opened[at]!;
    const end = opened[at + 1];
    return { opening: kept[start], parts: partsOf({ kept: kept.slice(start + 1, end) }) };
  };
  let latest: Slice = { opening: undefined, parts: partsOf({ kept }) };
  if (opened.length > 0) {
    latest = sliceAt({ at: opened.length - 1 });
  }
  const earlierTurnsInTail = Math.max(0, opened.length - 1);
  const wanted = Math.min(earlierTurnsInTail, Math.max(0, turns - 1));
  const earlierSlices = Array.from({ length: wanted }, (_, index) =>
    sliceAt({ at: opened.length - 1 - wanted + index }),
  );
  const cut = budgeted({ slices: [...earlierSlices, latest] });
  const latestCut = cut.at(-1)!;
  const earlier = earlierSlices.map((slice, index): EarlierTurn => {
    const opening = slice.opening!;
    const { parts, dropped } = cut[index]!;
    return { partsDropped: dropped, parts, prompt: promptOf({ opening }), turnId: turnIdOf({ opening }) };
  });
  let turnId = FRAGMENT_TURN_ID;
  if (latest.opening !== undefined) {
    turnId = turnIdOf({ opening: latest.opening });
  }
  return {
    cwd: newest({ kept, pick: (record) => record.cwd }),
    earlier,
    earlierTurnsInTail,
    lastTimestamp: newest({ kept, pick: (record) => record.timestamp }),
    model: newest({ kept: kept.filter(({ record }) => record.role === "assistant"), pick: (record) => record.model }),
    parts: latestCut.parts,
    partsDropped: latestCut.dropped,
    prompt: latest.opening === undefined ? undefined : promptOf({ opening: latest.opening }),
    turnId,
    turnStartSeen: opened.length > 0 || fromStart,
  };
}
