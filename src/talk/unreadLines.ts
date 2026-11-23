/**
 * The bytes-to-lines half of `./unreadRead.ts`: hand each whole line of an open call file over in order, and decode one
 * line into its printed text and, when it parses whole, its call entry. Kept apart from the read so the proof rules
 * about a line — never past a missing newline, never a lossy decode — sit in one place.
 */
import { readSync } from "node:fs";

import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";

import { type CallEntry, callEntryOf } from "./callRecord.js";

/** How many bytes one read of a call file takes at a time. */
const READ_CHUNK_BYTES = 1024 * 1024;

/** The newline every call line ends with. */
export const NEWLINE = 0x0a;

/** One whole line of a call file: the bytes read, and where they sit. */
export interface PlacedLine {
  readonly bytes: Buffer;
  readonly byteOffset: number;
}

/**
 * Hand each whole line of an open file from `start` to `onLine`, and count the bytes after the last newline. Those
 * are never handed over, since a write may still be landing them — and never passed over either: a caller refuses
 * them, since a write that died before its newline leaves the owner's words there for good.
 *
 * @param fd the open call file
 * @param start a line boundary this reader itself recorded
 * @param end the byte it stops before, however far the file runs
 * @param onLine takes one line
 * @returns how many bytes follow the last newline read
 */
export function forEachWholeLine({
  fd,
  start,
  end,
  onLine,
}: {
  fd: number;
  start: number;
  end: number;
  onLine: (line: PlacedLine) => void;
}): number {
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let carry = Buffer.alloc(0);
  let carryOffset = start;
  let position = start;
  for (;;) {
    const read = readSync(fd, chunk, 0, Math.max(0, Math.min(chunk.length, end - position)), position);
    if (read === 0) {
      return carry.length;
    }
    position += read;
    // `concat` copies, so a line handed over never aliases the chunk the next read overwrites.
    const window = Buffer.concat([carry, chunk.subarray(0, read)]);
    let from = 0;
    for (let at = window.indexOf(NEWLINE, from); at !== -1; at = window.indexOf(NEWLINE, from)) {
      onLine({ byteOffset: carryOffset + from, bytes: window.subarray(from, at) });
      from = at + 1;
    }
    carry = window.subarray(from);
    carryOffset += from;
  }
}

/**
 * One whole line's bytes as text and, when they parse, as a call line. Bytes that are not UTF-8 decode to U+FFFD, so
 * the printed text would not be the bytes marked read (for instance `FF 0A`): such a line never parses,
 * and its text is hex.
 *
 * @param bytes the line, without its newline
 * @returns the line's printed text and its entry, `undefined` when it is not one
 */
export function decodedLine({ bytes }: { bytes: Buffer }): { text: string; entry: CallEntry | undefined } {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    return { entry: undefined, text: `not UTF-8, as hex: ${bytes.toString("hex")}` };
  }
  return { entry: entryOfLine({ line: decoded }), text: decoded };
}

/**
 * One whole line as a call line, or `undefined` when it is not one — or when parsing it would lose text. The call
 * schema cuts a segment's text at `CALL_TEXT_CHARS`, and a mark counts the WHOLE line read, so a segment whose stored
 * text runs past the cap is handed back unparsed and printed whole (for instance 16,000 characters then
 * `SECRET` printed only the first 16,000 and marked the rest read). A segment whose text holds a lone surrogate — a
 * `\ud800` escape parses to one — is handed back too: stdout would print it as U+FFFD, not what was stored, while the
 * raw line, already checked to be UTF-8, prints exactly.
 *
 * @param line the line's text
 * @returns the entry, or `undefined`
 */
function entryOfLine({ line }: { line: string }): CallEntry | undefined {
  try {
    const value = safeJsonParse({ label: "call transcript line", text: line });
    const entry = callEntryOf({ value });
    if (entry?.kind !== "segment") {
      return entry;
    }
    const cutOnParse = isRecord(value) && value["text"] !== entry.text;
    if (cutOnParse || !entry.text.isWellFormed()) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}
