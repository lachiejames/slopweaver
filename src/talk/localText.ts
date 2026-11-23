/**
 * The text half of `slopweaver talk file read`: one bounded window of a file that is not a picture, masked over
 * a margin on each side. `./localFile.ts` runs every path refusal and the inode check first and hands over the
 * open descriptor; nothing here resolves or opens a path. A window holding a NUL byte is binary and refused; a
 * truncated one ends at its last line break where it has one, so a credential the edge cuts is masked whole.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type ReadWindow, utf8BoundaryAtOrBefore } from "./codeBounds.js";
import { type RedactedText, redactWindow, survivingSecrets, windowRedactor } from "./fileRedaction.js";
import { type LocalFileError, LocalFileErrors } from "./localFileErrors.js";
import { readAfterHead } from "./localImage.js";
import { isSourcePath } from "./localPath.js";
import { PAGE_OUTLINE_MAX_BYTES, type PageHeading, type PageOutlineResult, pageOutline } from "./pageOutline.js";

/** A page the voice is handed an outline of: `.html` or `.htm`, by where it resolved to. */
const PAGE_EXTENSION = /\.html?$/iu;

/**
 * Bytes read after a window so a credential the window cuts is still matched whole (`./fileRedaction.ts`
 * § "Matched on the context"). Wider than the largest shape it must hold: an RSA-4096 PEM block is about
 * 3.2 KiB, so a window can never sit inside one with neither its BEGIN nor its END in reach.
 */
const CONTEXT_AFTER = 8192;

/**
 * Bytes read BEFORE a window, far wider than {@link CONTEXT_AFTER} because a secret-named block scalar is masked
 * only while its KEY line is in reach, and its body runs on below that key for up to 200 lines. Before windows
 * were cut to 10 KiB (`DEFAULT_CODE_BUDGET`) the voice read 256 KiB at once with {@link CONTEXT_AFTER} either
 * side, so a byte's context could open up to 256 KiB plus that margin before it; reaching back exactly as far
 * means no paged window masks less than that read did. MEASURED at an 8 KiB lookback: a
 * `client_secret: |` block of 199 lines of 79 characters sent 71 body lines on the second 10 KiB window; at
 * 256 KiB alone, a 281 KiB block keyed just before offset 256 KiB still sent 2.8 KB past offset 512 KiB. Repro:
 * write such a block to a `.yaml`, then `slopweaver talk file read --path <it> --from <offset> --json`.
 */
const CONTEXT_BEFORE = 262_144 + CONTEXT_AFTER;

/** One window of one local file, masked. */
export interface LocalRead {
  readonly kind: "text";
  /** The path as asked, expanded. */
  readonly path: string;
  /** Where it resolved to. */
  readonly resolvedPath: string;
  /** The file's whole size in bytes. */
  readonly size: number;
  /** The byte window carried. */
  readonly window: ReadWindow;
  /** The window's text, with every credential masked. */
  readonly text: string;
  /** What was masked. */
  readonly redactions: RedactedText["redactions"];
  /**
   * An HTML page's headings and the byte offset each opens at (`./pageOutline.ts`), the same on every window of
   * it so a section the window does not hold is one `from` away; empty for any other file, for a page over
   * `PAGE_OUTLINE_MAX_BYTES`, and for a page whose heading carried a credential the mask did not catch.
   */
  readonly outline: readonly PageHeading[];
  /**
   * Whether a heading of an outlined page is missing from {@link outline}: past the 16-entry cap, or cleared with
   * the rest because one carried a credential. `false` for any other file and for a page too large to outline, whose
   * window markers say what is unread.
   */
  readonly outlineCut: boolean;
}

/**
 * Read one masked text window out of a checked descriptor.
 *
 * @param fd an open descriptor `./localFile.ts` already checked is the file it resolved
 * @param path the path as asked, expanded
 * @param real where it resolved to, which decides the source-file masking exemptions
 * @param size the file's whole size in bytes
 * @param planned the window `./codeBounds.ts` already judged valid, before any byte was read
 * @param head the bytes the picture sniff already read from offset 0, which are never read again
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the window, or why it was refused
 */
export function readLocalText({
  fd,
  path,
  real,
  size,
  planned,
  head,
  denylist,
}: {
  fd: number;
  path: string;
  real: string;
  size: number;
  planned: ReadWindow;
  head: Buffer;
  denylist: readonly string[];
}): Result<LocalRead, LocalFileError> {
  return textWindowOf({
    denylist,
    path,
    planned,
    readContext: ({ start, end }) => {
      const buffer = Buffer.alloc(end - start);
      return buffer.subarray(0, readAfterHead({ at: start, fd, head, into: buffer }));
    },
    real,
    size,
  });
}

/**
 * Read one masked text window of a document already held whole in memory — a published page the store returned —
 * masked over exactly the margin, and outlined exactly as, the same bytes read off disk would be.
 *
 * @param bytes the whole document
 * @param path the path the document answers to, named in the read and in every refusal
 * @param planned the window `./codeBounds.ts` already judged valid against `bytes.length`
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the window, or why it was refused
 */
export function readHeldText({
  bytes,
  path,
  planned,
  denylist,
}: {
  bytes: Uint8Array;
  path: string;
  planned: ReadWindow;
  denylist: readonly string[];
}): Result<LocalRead, LocalFileError> {
  const whole = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return textWindowOf({
    denylist,
    path,
    planned,
    readContext: ({ start, end }) => whole.subarray(start, end),
    real: path,
    size: whole.length,
  });
}

/** One window masked over its context, wherever the context's bytes come from. */
function textWindowOf({
  readContext,
  path,
  real,
  size,
  planned,
  denylist,
}: {
  readContext: (range: { start: number; end: number }) => Buffer;
  path: string;
  real: string;
  size: number;
  planned: ReadWindow;
  denylist: readonly string[];
}): Result<LocalRead, LocalFileError> {
  const page = isOutlinedPage({ real, size });
  const { contextStart, contextEnd } = contextRange({ page, planned, size });
  const context = readContext({ end: contextEnd, start: contextStart });
  const opens = planned.start - contextStart;
  const bytes = context.subarray(opens, Math.min(opens + planned.end - planned.start, context.length));
  if (bytes.includes(0)) {
    return err(LocalFileErrors.binary({ path, size }));
  }
  const carried = bytes.subarray(0, windowEnd({ bytes, truncated: planned.truncated }));
  const end = planned.start + carried.length;
  const before = decodeUtf8({ bytes: context.subarray(0, opens) });
  const inside = decodeUtf8({ bytes: carried });
  const after = decodeUtf8({ bytes: context.subarray(opens + carried.length) });
  const masked = redactWindow({
    context: `${before}${inside}${after}`,
    denylist,
    end: before.length + inside.length,
    source: isSourcePath({ path: real }),
    start: before.length,
  });
  const survivors = survivingSecrets({ denylist, text: masked.text });
  if (survivors.length > 0) {
    return err(LocalFileErrors.credentialSurvived({ labels: survivors, path }));
  }
  const truncated = end < size;
  let outline: PageOutlineResult = { cut: false, headings: [] };
  if (page) {
    outline = maskedOutline({ bytes: context, denylist, source: isSourcePath({ path: real }) });
  }
  return ok({
    kind: "text",
    outline: outline.headings,
    outlineCut: outline.cut,
    path,
    redactions: masked.redactions,
    resolvedPath: real,
    size,
    text: masked.text,
    window: { end, nextFrom: truncated ? end : null, start: planned.start, truncated },
  });
}

/**
 * The byte range read as a window's masking context: the margin either side of it, or the whole page when the
 * file is one the voice gets an outline of, since the outline reads every heading.
 */
function contextRange({ page, planned, size }: { page: boolean; planned: ReadWindow; size: number }): {
  contextStart: number;
  contextEnd: number;
} {
  if (page) {
    return { contextEnd: size, contextStart: 0 };
  }
  return {
    contextEnd: Math.min(planned.end + CONTEXT_AFTER, size),
    contextStart: Math.max(planned.start - CONTEXT_BEFORE, 0),
  };
}

/**
 * Where a window stops: the whole buffer when nothing was cut, else just after its last line break, else at a
 * UTF-8 boundary for a single line longer than the budget.
 */
function windowEnd({ bytes, truncated }: { bytes: Buffer; truncated: boolean }): number {
  if (!truncated) {
    return bytes.length;
  }
  const lastBreak = bytes.lastIndexOf(0x0a);
  if (lastBreak >= 0) {
    return lastBreak + 1;
  }
  return utf8BoundaryAtOrBefore({ at: bytes.length, bytes });
}

/** Bytes as UTF-8 text, a split character at either edge becoming a replacement character. */
function decodeUtf8({ bytes }: { bytes: Uint8Array }): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Whether a file is a page the voice gets an outline of. Such a page is read whole, once, as both the window's
 * masking context and the outline's source — never more than `PAGE_OUTLINE_MAX_BYTES`, below the
 * {@link CONTEXT_BEFORE} margin any other window already reads.
 */
function isOutlinedPage({ real, size }: { real: string; size: number }): boolean {
  return PAGE_EXTENSION.test(real) && size <= PAGE_OUTLINE_MAX_BYTES;
}

/**
 * A page's outline, each heading's markup masked as a span of the WHOLE page, exactly as a window over the same
 * bytes is, then its shown words masked on their own; both before the cut. Masked on its
 * own, a secret ending in the heading's `</h1>` matched nothing and the cut left its prefix. A heading the mask did
 * not catch empties the WHOLE outline rather than refusing the window: the outline is a map to the section, and the
 * window the voice asked for is still clean and still answers.
 */
function maskedOutline({
  bytes,
  denylist,
  source,
}: {
  bytes: Uint8Array;
  denylist: readonly string[];
  source: boolean;
}): PageOutlineResult {
  const survivors: string[] = [];
  const kept = ({ masked }: { masked: string }): string => {
    survivors.push(...survivingSecrets({ denylist, text: masked }));
    return masked;
  };
  const page = windowRedactor({ context: decodeUtf8({ bytes }), denylist, source });
  const outline = pageOutline({
    bytes,
    mask: {
      // Both edges sit at a tag's ASCII `>` or `<`, where UTF-8 decoding resynchronises, so a prefix's decoded
      // length is the span's offset in the decoded page.
      markup: ({ start, end }) =>
        kept({
          masked: page({
            end: decodeUtf8({ bytes: bytes.subarray(0, end) }).length,
            start: decodeUtf8({ bytes: bytes.subarray(0, start) }).length,
          }).text,
        }),
      words: (text) =>
        kept({ masked: redactWindow({ context: text, denylist, end: text.length, source, start: 0 }).text }),
    },
  });
  if (
    survivors.length > 0 ||
    outline.headings.some((heading) => survivingSecrets({ denylist, text: heading.text }).length > 0)
  ) {
    return { cut: outline.headings.length > 0, headings: [] };
  }
  return outline;
}
