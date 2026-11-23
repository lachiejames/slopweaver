/**
 * A top-level JSON ARRAY read one element at a time, so a document whose size is set by data never passes
 * through one JS string.
 *
 * The case that needs it: a chat-history export is ONE array of every conversation an account ever had
 * (`conversations.json` in ChatGPT's archive), and a heavy account's file runs to hundreds of megabytes —
 * past `safeJsonParse`'s 100 MiB refusal and, at the top, past V8's ~512 MiB string wall. Each ELEMENT is one
 * conversation, bounded by the conversation, so splitting the array and parsing each element alone keeps every
 * string the size of one conversation (typescript-patterns.md § Never let a data-sized payload through one JS
 * string).
 *
 * The splitter here is a pure state machine over text chunks; `jsonArrayFile.ts`'s `readJsonArrayElements` is the
 * thin file edge. It splits and never parses: each element's text is handed to the caller, who parses it with
 * whatever schema it owns.
 */
import { type JsonArrayError, JsonArrayErrors } from "./jsonArrayErrors.js";
import { err, ok, type Result } from "./result.js";
import { JSON_REFUSE_BYTES } from "./safeJson.js";

/**
 * Where the splitter is in the document. The three between-element phases are the array's whole grammar: right
 * after `[` a value or `]`; after a comma a value only; after a value a comma or `]`. A damaged file whose commas
 * are doubled, leading or trailing is refused here rather than read as a whole array.
 */
type SplitPhase = "before-array" | "first-value-or-close" | "value" | "comma-or-close" | "in-element" | "after-array";

/** A JSON whitespace character (RFC 8259 § 2). */
function isJsonWhitespace({ char }: { char: string }): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

/** The streaming splitter: feed chunks in order, collect each finished element's text, then end. */
export interface JsonArraySplitter {
  /** Feed the next chunk of text; answers every element that chunk finished, in order. */
  readonly push: (args: { chunk: string }) => Result<readonly string[], JsonArrayError>;
  /** Declare the input finished; refuses a document whose array never closed. */
  readonly end: () => Result<void, JsonArrayError>;
}

/** Everything one splitter carries between characters and across chunks. */
interface SplitState {
  phase: SplitPhase;
  depth: number;
  inString: boolean;
  escaped: boolean;
  /**
   * A scalar element (`1`, `true`, `"x"` at depth zero) has no closing bracket, so it ends at the next comma
   * or the array's own close instead.
   */
  scalar: boolean;
  current: string[];
  currentChars: number;
  /** The document offset of the current chunk's first character. */
  offset: number;
  /** Where the open element starts in the current chunk — 0 when it began in an earlier one. */
  start: number;
  readonly maxElementChars: number;
}

/** One character's step: the state it moves, the chunk it sits in, and where finished elements go. */
interface CharStep {
  readonly state: SplitState;
  readonly chunk: string;
  readonly index: number;
  readonly out: string[];
}

/** Add a piece to the open element, refusing it once the element passes the cap. */
function take({ state, piece }: { state: SplitState; piece: string }): Result<void, JsonArrayError> {
  state.currentChars += piece.length;
  if (state.currentChars > state.maxElementChars) {
    return err(JsonArrayErrors.elementTooLarge({ limit: state.maxElementChars }));
  }
  state.current.push(piece);
  return ok(undefined);
}

/** Close the open element with its last piece, handing its trimmed text to `out`. */
function finish({
  state,
  out,
  piece,
}: {
  state: SplitState;
  out: string[];
  piece: string;
}): Result<void, JsonArrayError> {
  const taken = take({ piece, state });
  if (taken.isErr()) {
    return taken;
  }
  const text = state.current.join("").trim();
  if (text.length > 0) {
    out.push(text);
  }
  state.current = [];
  state.currentChars = 0;
  state.scalar = false;
  return ok(undefined);
}

/** Before `[`: whitespace and a leading byte-order mark pass; anything but `[` is not an array. */
function stepBeforeArray({ state, chunk, index }: CharStep): Result<void, JsonArrayError> {
  const char = chunk[index]!;
  const isLeadingBom = state.offset === 0 && index === 0 && char === "﻿";
  if (isJsonWhitespace({ char }) || isLeadingBom) {
    return ok(undefined);
  }
  if (char !== "[") {
    return err(JsonArrayErrors.notAnArray({ opensWith: char }));
  }
  state.phase = "first-value-or-close";
  return ok(undefined);
}

/** After `]`: only whitespace may follow. */
function stepAfterArray({ state, chunk, index }: CharStep): Result<void, JsonArrayError> {
  if (!isJsonWhitespace({ char: chunk[index]! })) {
    return err(JsonArrayErrors.trailingText({ offset: state.offset + index }));
  }
  return ok(undefined);
}

/** After a value: a comma or the array's close, nothing else. */
function stepCommaOrClose({ state, chunk, index }: CharStep): Result<void, JsonArrayError> {
  const char = chunk[index]!;
  if (isJsonWhitespace({ char })) {
    return ok(undefined);
  }
  if (char === ",") {
    state.phase = "value";
  } else if (char === "]") {
    state.phase = "after-array";
  } else {
    return err(JsonArrayErrors.misplacedSeparator({ char, offset: state.offset + index }));
  }
  return ok(undefined);
}

/** Where a value may start: `]` closes an array still empty, a stray separator is refused, anything else opens one. */
function stepValueStart({ state, chunk, index }: CharStep): Result<void, JsonArrayError> {
  const char = chunk[index]!;
  if (isJsonWhitespace({ char })) {
    return ok(undefined);
  }
  if (char === "]" && state.phase === "first-value-or-close") {
    state.phase = "after-array";
    return ok(undefined);
  }
  if (char === "," || char === "]") {
    return err(JsonArrayErrors.misplacedSeparator({ char, offset: state.offset + index }));
  }
  state.phase = "in-element";
  state.start = index;
  if (char === "{" || char === "[") {
    state.depth = 1;
  } else if (char === '"') {
    state.inString = true;
    state.scalar = true;
  } else {
    state.scalar = true;
  }
  return ok(undefined);
}

/** Inside a string: a backslash escapes the next character, an unescaped quote closes it. */
function scanStringChar({ state, char }: { state: SplitState; char: string }): void {
  if (state.escaped) {
    state.escaped = false;
  } else if (char === "\\") {
    state.escaped = true;
  } else if (char === '"') {
    state.inString = false;
  }
}

/** A depth-zero scalar ends at the comma or close that follows it, which is not part of it. */
function stepScalar({ state, chunk, index, out }: CharStep): Result<void, JsonArrayError> {
  const char = chunk[index]!;
  if (char !== "," && char !== "]") {
    return ok(undefined);
  }
  const finished = finish({ out, piece: chunk.slice(state.start, index), state });
  if (finished.isErr()) {
    return finished;
  }
  state.phase = char === "]" ? "after-array" : "value";
  return ok(undefined);
}

/** An object or array element ends at the bracket that brings its depth back to zero. */
function stepContainer({ state, chunk, index, out }: CharStep): Result<void, JsonArrayError> {
  const char = chunk[index]!;
  if (char === "{" || char === "[") {
    state.depth += 1;
    return ok(undefined);
  }
  if (char !== "}" && char !== "]") {
    return ok(undefined);
  }
  state.depth -= 1;
  if (state.depth !== 0) {
    return ok(undefined);
  }
  const finished = finish({ out, piece: chunk.slice(state.start, index + 1), state });
  if (finished.isErr()) {
    return finished;
  }
  state.phase = "comma-or-close";
  return ok(undefined);
}

/** Inside an element: track strings, then end a scalar or a container where it closes. */
function stepInElement(step: CharStep): Result<void, JsonArrayError> {
  const { state, chunk, index } = step;
  const char = chunk[index]!;
  if (state.inString) {
    scanStringChar({ char, state });
    return ok(undefined);
  }
  if (char === '"') {
    state.inString = true;
    return ok(undefined);
  }
  if (state.scalar && state.depth === 0) {
    return stepScalar(step);
  }
  return stepContainer(step);
}

/** One character, routed to its phase's step. */
function stepChar(step: CharStep): Result<void, JsonArrayError> {
  switch (step.state.phase) {
    case "before-array":
      return stepBeforeArray(step);
    case "after-array":
      return stepAfterArray(step);
    case "comma-or-close":
      return stepCommaOrClose(step);
    case "first-value-or-close":
    case "value":
      return stepValueStart(step);
    case "in-element":
      return stepInElement(step);
  }
}

/**
 * Make a splitter for one document whose top level is a JSON array.
 *
 * It tracks only what decides where an element ENDS — nesting depth, whether it is inside a string, and
 * whether the previous character was a backslash — so it never builds a value, and malformed text INSIDE an
 * element is the element parser's to refuse. What it does refuse is a document that is not an array at all,
 * text after the closing bracket, an array that never closes, and one element longer than `maxElementChars`.
 *
 * That last cap is what keeps the splitting worth doing: one element can be the whole document, so without it a
 * hostile file of a single enormous element would be joined into one string before any parser saw it.
 *
 * @param maxElementChars the longest element it hands over, in UTF-16 code units; the refusal fires while the
 *   element is still accumulating, never after a join. Defaults to `safeJsonParse`'s own refusal size.
 * @returns the splitter
 */
export function createJsonArraySplitter({
  maxElementChars = JSON_REFUSE_BYTES,
}: { maxElementChars?: number } = {}): JsonArraySplitter {
  const state: SplitState = {
    current: [],
    currentChars: 0,
    depth: 0,
    escaped: false,
    inString: false,
    maxElementChars,
    offset: 0,
    phase: "before-array",
    scalar: false,
    start: 0,
  };

  const push = ({ chunk }: { chunk: string }): Result<readonly string[], JsonArrayError> => {
    const out: string[] = [];
    state.start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const stepped = stepChar({ chunk, index, out, state });
      if (stepped.isErr()) {
        return err(stepped.error);
      }
    }
    if (state.phase === "in-element") {
      const taken = take({ piece: chunk.slice(state.start), state });
      if (taken.isErr()) {
        return err(taken.error);
      }
    }
    state.offset += chunk.length;
    return ok(out);
  };

  const end = (): Result<void, JsonArrayError> => {
    if (state.phase === "before-array") {
      return err(JsonArrayErrors.emptyDocument());
    }
    if (state.phase !== "after-array") {
      return err(JsonArrayErrors.unclosed());
    }
    return ok(undefined);
  };

  return { end, push };
}
