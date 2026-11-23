/**
 * `read_page` past its cut: a page's reading longer than one read carries is read in windows of its serialised text,
 * each naming where the next starts (`nextFrom`, in UTF-8 bytes) and WHICH reading it was cut from (`reading`, an id
 * of that exact text). A read on from a window is refused once the page has moved — another page, or the same page
 * redrawn — since a window of the new text would splice two readings into one.
 *
 * The voice keeps reading until it is all read; the coverage hold names the call that
 * reads on (`./readCoverage.ts`). Only where this window draws the page: a reading the console window fitted and
 * carried across to the voice's window was cut there, and no read here carries its rest (`./pageVoice.ts`).
 *
 * Pure.
 */
import type { PageRead } from "./pageVoice";

/** One window of a page's reading. */
export interface PageWindow {
  /** The window's text: a run of the serialised reading, never split inside a character. */
  readonly text: string;
  /** Where the next window starts, in bytes; `undefined` when this one reaches the end. */
  readonly nextFrom: number | undefined;
  /** The whole serialised reading's size, in bytes. */
  readonly size: number;
}

/** A page read that carries one window of the reading: where it started, where the next starts, and of what. */
export type PageReadWindow = PageRead & {
  readonly start: number;
  readonly nextFrom: number | undefined;
  readonly size: number;
  readonly reading: string;
  /** How to read on, while more follows: the window's cut is its `nextFrom`, never a `truncated` sentence. */
  readonly readOn: string | undefined;
  /**
   * The cuts the WHOLE reading marks (`shows.drawnMore`, a hidden tag), as the read_page probes word them, carried on
   * every window: a window's `shows` is a fragment of text, where no probe can see a marker. Absent when the reading marks none.
   */
  readonly readingCuts?: readonly string[] | undefined;
};

/**
 * The id of one exact serialised reading: its length in UTF-16 code units, then two independent 32-bit hashes of
 * them (FNV-1a, and a multiply-xorshift lane), as hex. A changed reading gets a different id, so a read on from a
 * window of the old one is refused rather than spliced onto the new. One 32-bit hash alone is not enough: two
 * `/queue` readings can share one, which would splice (`pageReadWindow.test.ts`). Not a
 * cryptographic digest — the page's own redraw is what it guards against, and nothing here is adversarial. It names
 * the TEXT, not the draw: a page redrawn back to byte-identical text is the same reading, and a read on from it
 * carries exactly the bytes the cut window did not, so nothing is spliced.
 *
 * @param text the serialised reading
 * @returns the id
 */
export function pageReadingId({ text }: { text: string }): string {
  let fnv = 0x81_1c_9d_c5;
  let mix = 0x9e_37_79_b9;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    fnv = Math.imul(fnv ^ unit, 0x01_00_01_93) >>> 0;
    mix = Math.imul(mix ^ unit, 0x5b_d1_e9_95);
    mix = (mix ^ (mix >>> 15)) >>> 0;
  }
  const hex = (value: number): string => value.toString(16).padStart(8, "0");
  return `${text.length.toString(16)}-${hex(fnv)}${hex(mix)}`;
}

/**
 * One window of a serialised reading, starting at a byte offset and no longer than `maxBytes`, cut back to the start
 * of a character so no window splits one — bar a bound narrower than the one character at `from`, which is carried
 * whole so the window is never empty.
 *
 * @param text the serialised reading
 * @param from where the window starts, in bytes — on a character boundary, as a `nextFrom` always is
 * @param maxBytes the most the window carries
 * @returns the window
 */
export function pageWindowOf({ text, from, maxBytes }: { text: string; from: number; maxBytes: number }): PageWindow {
  const bytes = new TextEncoder().encode(text);
  let end = Math.min(bytes.length, from + Math.max(1, maxBytes));
  // A UTF-8 continuation byte is 10xxxxxx: back up to the byte that starts its character.
  while (end < bytes.length && end > from && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  // A bound narrower than the character at `from` still carries that one character whole, so a read on always moves.
  if (end === from && end < bytes.length) {
    end += 1;
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end += 1;
    }
  }
  // `ignoreBOM`: a window starting on U+FEFF keeps it, where a default decoder strips it as a BOM.
  const window = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(from, end));
  return { nextFrom: end < bytes.length ? end : undefined, size: bytes.length, text: window };
}

/**
 * Why a read on from a window is refused, or `undefined` when it can go ahead.
 *
 * @param path the page the window was cut from, path and query
 * @param reading the id of the reading it was cut from
 * @param from where the read on starts
 * @param now the page on screen now: its path, its serialised reading, and whether that reading was carried across
 * @returns the refusal
 */
export function pageReadOnRefusal({
  path,
  reading,
  from,
  now,
}: {
  path: unknown;
  reading: unknown;
  from: unknown;
  now: { readonly path: string; readonly text: string; readonly carried: boolean };
}): string | undefined {
  if (now.carried) {
    return "this page's reading was cut in the console window before it crossed to the voice's window, so no read here carries its rest";
  }
  if (typeof path !== "string" || typeof reading !== "string" || typeof from !== "number" || !Number.isInteger(from)) {
    return "a read on names the window it continues: path, reading and from, exactly as the cut read gave them";
  }
  if (path !== now.path || reading !== pageReadingId({ text: now.text })) {
    // The page now goes unnamed: its path has no bound of its own, and the fresh read_page names it.
    return "the page moved since that read, to another page or this one drawn afresh, so read_page again from the start";
  }
  const bytes = new TextEncoder().encode(now.text);
  const size = bytes.length;
  if (from <= 0 || from >= size) {
    return `from must sit inside the reading, past 0 and before its ${String(size)} bytes`;
  }
  // A UTF-8 continuation byte is 10xxxxxx: a window from one would open on half a character. Any boundary is a read on, never a splice — the coverage hold closes a gap only for a read that
  // starts at or before it (`./coverageHold.ts`), so a window that skips ahead certifies nothing it skipped.
  if ((bytes[from] & 0xc0) === 0x80) {
    return "from must sit on the first byte of a character, as every nextFrom does";
  }
  return undefined;
}
