/**
 * A call line too large for one `talk unread` batch, printed in parts that each fit — so no line is ever marked read
 * on the chair's word that it read it elsewhere.
 *
 * A stretch of the owner's speech may run to 16,000 characters (`CALL_TEXT_CHARS`), and a line that does not parse to any
 * length, while a batch prints at most what every host the chair runs on keeps whole (`./unreadBatch.ts`). Such a
 * line once had to be read from its file and adopted as read with a hatch, which is a claim, not a record. Now each `talk unread` prints the next part and `--mark` records that part in the cursor, which stays
 * at the line's start — bound to the line's hash — until the last part is marked and it moves past the line.
 *
 * ## One stretch is printed once, however many snapshots of it the call wrote
 *
 * The page appends a WHOLE snapshot of a stretch each time it grows, so a stretch the owner spoke for twenty minutes is
 * a long run of lines, each nearly the size of the last. MEASURED on one call: one segment on 195
 * lines of 7.5 to 16 KB, each printed in two parts, so catching up cost two marks a snapshot while the call kept
 * appending, and the eight stretches after it — the ones `supervisor tick close` named — were never reached. A batch
 * of whole lines already folds snapshots into the newest (`./unreadWords.ts`); a part run now does the same. It
 * prints the newest snapshot of the first line's stretch that every snapshot before it continues, and its last part
 * moves the cursor past every line that snapshot prints — every snapshot of the stretch it continues, and every line
 * no report prints (the voice's own segments, relays, tool and usage lines). It stops at the first line a report
 * would print otherwise: a line that does not parse, another stretch of the owner's, a snapshot it does not continue.
 * Reproduce the measurement: `slopweaver talk unread` over that call, before and after.
 *
 * Pure: the read is `./unreadRead.ts`, the printing `src/cli/commands/talk/unreadReport.ts`.
 */
import { safeJsonStringify } from "../lib/safeJson.js";
import type { CallEntry } from "./callRecord.js";
import { type CallFrontier, formatCallPointer, printsSnapshot, type TailLine, type UnreadRead } from "./unreadWords.js";

/**
 * The most one part weighs, counted as the larger of its UTF-8 bytes and its JSON-escaped bytes, so the same cut
 * fits a batch in either output shape with room for the lines around it — what the stretch answered among them
 * (`src/talk/answerContext.ts`). MEASURED at 6,000: the widest frame, the costliest ids and an unreadable
 * verdict made a part 8,067 bytes against the 8,000 a batch fits, and a quote and a reason in three-byte characters
 * add up to 720 more. Reproduce: the "widest frame" case in
 * `src/__tests__/unit/talk/unreadAnsweredWitness.test.ts`, which asserts the part it prints now.
 */
export const UNREAD_PART_BYTES = 5_000;

/** The most line breaks one part holds — a segment's text may carry them, and a host may cut by lines. */
export const UNREAD_PART_LINES = 150;

/** The sha256 of zero bytes — the prefix hash of a frontier standing at a file's very start. */
const EMPTY_PREFIX_SHA256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** One part of an oversized line, as printed, and the frontier a mark of it records. */
export interface LinePartPrint {
  readonly callId: string;
  /** Where the line begins in its call file. */
  readonly byteOffset: number;
  /** `talk-call:<callId>#<segmentId>` when the line is a segment, `undefined` for a line that does not parse. */
  readonly pointer: string | undefined;
  /** Which part this is, counted from 1. */
  readonly index: number;
  readonly of: number;
  readonly text: string;
  /** The line's start with this part recorded, or — for the last part — the frontier past every line it prints. */
  readonly frontier: CallFrontier;
  /** How many of its call's unread lines the last part's mark moves past: the snapshots it prints, and the lines between. */
  readonly passes: number;
}

/**
 * What one code point weighs in a part: its JSON-escaped UTF-8 bytes, never fewer than its raw ones.
 *
 * @param char one code point, or a lone surrogate
 * @returns its weight in bytes
 */
function weightOf({ char }: { char: string }): number {
  return Math.max(Buffer.byteLength(char, "utf8"), Buffer.byteLength(JSON.stringify(char).slice(1, -1), "utf8"));
}

/**
 * A text cut into parts of at most {@link UNREAD_PART_BYTES} and {@link UNREAD_PART_LINES} line breaks, on code-point
 * boundaries — the same cut every time, since a mark records only how many were printed.
 *
 * @param text the whole line's printed text
 * @returns its parts, one empty part for an empty text
 */
export function partsOf({ text }: { text: string }): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let weight = 0;
  let breaks = 0;
  for (const char of text) {
    const next = weightOf({ char });
    const isBreak = char === "\n";
    const full = weight + next > UNREAD_PART_BYTES || (isBreak && breaks === UNREAD_PART_LINES);
    if (full && current !== "") {
      parts.push(current);
      current = "";
      weight = 0;
      breaks = 0;
    }
    current += char;
    weight += next;
    breaks += isBreak ? 1 : 0;
  }
  parts.push(current);
  return parts;
}

/**
 * What of a line is printed in parts: a segment's text, a line that did not parse whole, anything else as stored.
 *
 * @param callId the call the line is on
 * @param line the line
 * @returns its text and, for a segment, its pointer
 */
function printedOf({ callId, line }: { callId: string; line: TailLine }): {
  text: string;
  pointer: string | undefined;
} {
  if (line.kind === "unparseable") {
    return { pointer: undefined, text: line.line.text };
  }
  if (line.entry.kind === "segment") {
    return { pointer: formatCallPointer({ callId, segmentId: line.entry.id }), text: line.entry.text };
  }
  return { pointer: undefined, text: safeJsonStringify({ label: "talk unread line", value: line.entry }) };
}

/**
 * How many parts a line prints in — what a cursor standing inside it is checked against (`./unreadRead.ts`).
 *
 * @param callId the call the line is on
 * @returns the count, at least 1
 */
export function partCountOf({ callId, line }: { callId: string; line: TailLine }): number {
  return partsOf({ text: printedOf({ callId, line }).text }).length;
}

/**
 * A line's segment, when it is one of the owner's — the only kind of entry a report prints.
 *
 * @param line the line
 * @returns the segment, or `undefined`
 */
function ownerSegmentOf({ line }: { line: TailLine }): Extract<CallEntry, { kind: "segment" }> | undefined {
  if (line.kind !== "entry" || line.entry.kind !== "segment" || line.entry.who !== "owner") {
    return undefined;
  }
  return line.entry;
}

/**
 * The last line a part run printing `lines[cover]` moves past: through every line from the first that the cover
 * prints — a snapshot of its stretch it continues — or that no report prints at all, up to the last snapshot it
 * prints. Checked against EVERY snapshot, never inferred from a chain of them: whether one snapshot continues another
 * is a grapheme-boundary test, which a chain need not keep.
 *
 * @param lines a call's unread lines, from its frontier
 * @param cover the index of the line printed in parts
 * @returns the index of the last line passed, or `undefined` when a line before the cover is one it does not print
 */
export function coverEnd({ lines, cover }: { lines: readonly TailLine[]; cover: number }): number | undefined {
  const shown = ownerSegmentOf({ line: lines[cover]! });
  if (shown === undefined) {
    // A line that is not the owner's stretch prints only itself, so a part run over it passes only it.
    return cover === 0 ? 0 : undefined;
  }
  let end: number | undefined;
  for (const [index, line] of lines.entries()) {
    if (line.kind === "unparseable") {
      break;
    }
    const segment = ownerSegmentOf({ line });
    if (segment === undefined) {
      continue;
    }
    if (segment.id !== shown.id || !printsSnapshot({ shown: shown.text, snapshot: segment.text })) {
      break;
    }
    end = index;
  }
  if (end === undefined || end < cover) {
    return undefined;
  }
  return end;
}

/**
 * Which line a fresh part run prints: the newest snapshot of the first line's stretch that grows every one before
 * it, walking forward until a line a report would print otherwise. When the walk's pick does not print every
 * snapshot before it ({@link coverEnd}), the first line alone — the cut it always was.
 *
 * @param lines a call's unread lines, from its frontier
 * @returns the index of the line to print in parts
 */
function pickCover({ lines }: { lines: readonly TailLine[] }): number {
  const first = ownerSegmentOf({ line: lines[0]! });
  if (first === undefined) {
    return 0;
  }
  let cover = 0;
  let shown = first.text;
  for (const [index, line] of lines.entries()) {
    if (line.kind === "unparseable") {
      break;
    }
    const segment = ownerSegmentOf({ line });
    if (index === 0 || segment === undefined) {
      continue;
    }
    if (segment.id !== first.id) {
      break;
    }
    if (printsSnapshot({ shown: segment.text, snapshot: shown })) {
      cover = index;
      shown = segment.text;
    } else if (!printsSnapshot({ shown, snapshot: segment.text })) {
      break;
    }
  }
  return coverEnd({ cover, lines }) === undefined ? 0 : cover;
}

/**
 * Which of a call's unread lines a frontier standing inside a part run is printing: the line at the part's own
 * offset, or — for a part that names none — the line at the frontier.
 *
 * @param frontier where the reader stood, with a part recorded
 * @param lines the call's unread lines, from that frontier
 * @returns the index of the line, or `undefined` when no line begins there
 */
export function boundCover({
  frontier,
  lines,
}: {
  frontier: CallFrontier;
  lines: readonly TailLine[];
}): number | undefined {
  let target = frontier.offset;
  if (frontier.part?.lineOffset !== undefined) {
    target = frontier.part.lineOffset;
  }
  let lineStart = frontier.offset;
  for (const [index, line] of lines.entries()) {
    if (lineStart === target) {
      return index;
    }
    lineStart = line.after.offset;
  }
  return undefined;
}

/**
 * The next part of the first unread stretch of a read — the one a batch could not print whole. A run already begun
 * goes on with the line it began; a fresh one picks the newest snapshot that prints the rest ({@link pickCover}).
 *
 * @param read everything unread, every part frontier in it already checked by the read (`./unreadRead.ts`)
 * @returns the part to print, or `undefined` for a read with no line
 */
export function nextPart({ read }: { read: UnreadRead }): LinePartPrint | undefined {
  const tail = read.tails.find((candidate) => candidate.lines.length > 0);
  if (tail === undefined) {
    return undefined;
  }
  let start: CallFrontier = { offset: 0, prefixSha256: EMPTY_PREFIX_SHA256 };
  if (tail.start !== undefined) {
    start = tail.start;
  }
  const begun = start.part;
  let cover: number;
  let printed = 0;
  if (begun === undefined) {
    cover = pickCover({ lines: tail.lines });
  } else {
    cover = boundCover({ frontier: start, lines: tail.lines })!;
    printed = begun.printed;
  }
  const line = tail.lines[cover]!;
  const { text, pointer } = printedOf({ callId: tail.callId, line });
  const parts = partsOf({ text });
  // Never past the last: a read refuses a cursor recording as many parts as the line has (`./unreadRead.ts`).
  const index = printed + 1;
  const end = coverEnd({ cover, lines: tail.lines })!;
  let frontier: CallFrontier = tail.lines[end]!.after;
  if (index < parts.length) {
    // The line's own offset only when it is not the line at the frontier, so a cursor any earlier reader wrote reads
    // the same, and one this reader writes over a single long line stays one an earlier reader can still parse.
    const lineOffset = cover === 0 ? {} : { lineOffset: tail.lines[cover - 1]!.after.offset };
    const part = { ...lineOffset, lineSha256: line.sha256, printed: index };
    frontier = { offset: start.offset, part, prefixSha256: start.prefixSha256 };
  }
  return {
    byteOffset: start.offset,
    callId: tail.callId,
    frontier,
    index,
    of: parts.length,
    passes: end + 1,
    pointer,
    text: parts[index - 1]!,
  };
}
