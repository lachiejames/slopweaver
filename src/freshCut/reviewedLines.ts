/**
 * The logical lines a reviewed-residue entry is bound to. A line ends at LF or NUL, because the verify scans a blob's
 * NUL bytes as line breaks; nothing is decoded, trimmed or normalised, so a CR stays part of its line. A line's
 * identity is its SHA-256 and its OCCURRENCE: the 1-based index among the file's lines with those exact bytes, which
 * stays put when other lines move above it and tells two byte-identical copies apart.
 */
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../lib/result.js";

/**
 * The 1-based line a caller named lies past the file's last line.
 *
 * @internal — the declared failure of {@link lineBytesAt} and {@link reviewedLineIdentity}.
 */
export interface LineOutOfRangeError {
  readonly code: "LINE_OUT_OF_RANGE";
  readonly message: string;
}

/** One line's digest and its occurrence among the file's lines with the same bytes. */
export interface ReviewedLineIdentity {
  readonly lineSha256: string;
  readonly occurrence: number;
}

/**
 * Pure: the byte ranges of every logical line, in order, delimiters excluded.
 *
 * @param bytes the file's bytes
 * @returns each line's start and end offsets
 */
function lineRanges({ bytes }: { bytes: Buffer }): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a || bytes[index] === 0x00) {
      ranges.push({ end: index, start });
      start = index + 1;
    }
  }
  ranges.push({ end: bytes.length, start });
  return ranges;
}

/**
 * Pure: the SHA-256 of the bytes one range spans.
 *
 * @param bytes the file's bytes
 * @param range one line's start and end offsets
 * @returns the lowercase hex digest
 */
function rangeSha256({
  bytes,
  range,
}: {
  bytes: Buffer;
  range: { readonly start: number; readonly end: number };
}): string {
  return createHash("sha256").update(bytes.subarray(range.start, range.end)).digest("hex");
}

/**
 * Pure: the exact bytes of one logical line, its delimiter excluded.
 *
 * @param bytes the file's bytes
 * @param line the 1-based line number
 * @returns the line's bytes, or why there is no such line
 */
export function lineBytesAt({ bytes, line }: { bytes: Buffer; line: number }): Result<Buffer, LineOutOfRangeError> {
  const range = lineRanges({ bytes })[line - 1];
  if (range === undefined || line < 1) {
    return err({ code: "LINE_OUT_OF_RANGE", message: `line ${String(line)} is past the file's last line` });
  }
  return ok(bytes.subarray(range.start, range.end));
}

/**
 * Pure: the SHA-256 of one logical line's exact bytes ({@link lineBytesAt}).
 *
 * @param bytes the file's bytes
 * @param line the 1-based line number
 * @returns the lowercase hex digest, or why there is no such line
 */
export function reviewedLineSha256({
  bytes,
  line,
}: {
  bytes: Buffer;
  line: number;
}): Result<string, LineOutOfRangeError> {
  return lineBytesAt({ bytes, line }).map((lineBytes) => createHash("sha256").update(lineBytes).digest("hex"));
}

/**
 * Pure: every line's 1-based number, grouped by its digest, each group in file order — so a digest's group at index
 * `occurrence - 1` is that occurrence's line.
 *
 * @param bytes the file's bytes
 * @returns the line numbers of each digest
 */
export function lineNumbersByDigest({ bytes }: { bytes: Buffer }): ReadonlyMap<string, readonly number[]> {
  const byDigest = new Map<string, number[]>();
  lineRanges({ bytes }).forEach((range, index) => {
    const digest = rangeSha256({ bytes, range });
    const group = byDigest.get(digest);
    if (group === undefined) {
      byDigest.set(digest, [index + 1]);
    } else {
      group.push(index + 1);
    }
  });
  return byDigest;
}

/**
 * Pure: one line's digest and its occurrence among the file's lines with the same bytes — one more than the earlier
 * lines carrying that digest, so the line itself is always counted and no lookup can miss it.
 *
 * @param bytes the file's bytes
 * @param line the 1-based line number
 * @returns the line's identity, or why there is no such line
 */
export function reviewedLineIdentity({
  bytes,
  line,
}: {
  bytes: Buffer;
  line: number;
}): Result<ReviewedLineIdentity, LineOutOfRangeError> {
  return reviewedLineSha256({ bytes, line }).map((lineSha256) => {
    const earlier = lineRanges({ bytes })
      .slice(0, line - 1)
      .filter((range) => rangeSha256({ bytes, range }) === lineSha256).length;
    return { lineSha256, occurrence: earlier + 1 };
  });
}
