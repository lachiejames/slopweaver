/**
 * Fit one journal entry under its byte ceiling by cutting its longest string leaves, on UTF-8 boundaries, each cut
 * marked where it happened — never by dropping the entry. Pure.
 *
 * Why a ceiling at all: a journal part is read back a page at a time by `talk call-thread`, and one line nothing can
 * page through is an unreadable audit record. A part rotates before 24 MiB
 * (`./callThreadParts.ts`), so one entry must sit well under that: 8 MiB, the app-server's own line ceiling
 * (`site/lib/talkPlanProtocol.ts`), so anything that arrived whole fits whole bar the stored envelope around it.
 */
import type { JsonValue } from "./callThreadEntry.js";

/** The most one stored journal line may take, newline excluded. */
export const CALL_THREAD_ENTRY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * What a cut records: the stored line's bytes before fitting, and the string bytes dropped. The kept size is not
 * recorded — it would describe the very line it sits in — and is the line's own length.
 */
interface Truncation {
  readonly originalBytes: number;
  readonly truncatedBytes: number;
}

/** How the stored line measures, with the truncation record it will carry. */
export type MeasureLine = (input: { readonly capture: JsonValue; readonly truncation: Truncation | null }) => number;

/** What fitting did: the capture as kept, and its truncation, or `null` when it fit whole. */
export interface Fitted {
  readonly capture: JsonValue;
  readonly truncation: Truncation | null;
}

/**
 * The longest prefix of `text` that is at most `maxBytes` of UTF-8, never splitting a character.
 *
 * @param maxBytes the byte budget for the kept prefix
 * @returns the prefix, and how many bytes were cut
 */
export function utf8Prefix({ text, maxBytes }: { text: string; maxBytes: number }): {
  readonly kept: string;
  readonly cutBytes: number;
} {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) {
    return { cutBytes: 0, kept: text };
  }
  let end = Math.max(0, maxBytes);
  // A continuation byte is 0b10xxxxxx: back off until the cut sits before a character's first byte. `end` is below
  // the length, which is past `maxBytes`, so the byte is there.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return { cutBytes: bytes.length - end, kept: bytes.subarray(0, end).toString("utf8") };
}

/**
 * Every string leaf cut to at most `capBytes` of UTF-8, each cut one followed by a marker naming what it dropped.
 *
 * @param value the capture
 * @param capBytes the most any one leaf keeps
 * @param cut running total of bytes dropped, added to
 * @returns the capped capture
 */
function capLeaves({
  value,
  capBytes,
  cut,
}: {
  value: JsonValue;
  capBytes: number;
  cut: { bytes: number };
}): JsonValue {
  if (typeof value === "string") {
    const { kept, cutBytes } = utf8Prefix({ maxBytes: capBytes, text: value });
    if (cutBytes === 0) {
      return value;
    }
    cut.bytes += cutBytes;
    return `${kept}…[truncated ${String(cutBytes)} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => capLeaves({ capBytes, cut, value: item }));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, capLeaves({ capBytes, cut, value: item })]),
    );
  }
  return value;
}

/**
 * The longest string leaf's UTF-8 length.
 *
 * @param value the capture
 * @returns the length, 0 when it holds no string
 */
function longestLeaf({ value }: { value: JsonValue }): number {
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8");
  }
  if (Array.isArray(value)) {
    return value.reduce((most: number, item: JsonValue) => Math.max(most, longestLeaf({ value: item })), 0);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce((most: number, item) => Math.max(most, longestLeaf({ value: item })), 0);
  }
  return 0;
}

/**
 * Fit a capture so its stored line is at most `maxBytes`: unchanged when it already fits, else every leaf capped at
 * the largest per-leaf budget that fits, found by bisection over the measured line — JSON escaping inflates a leaf, so
 * only the serialised line is the truth.
 *
 * @param capture the capture after binary stand-ins and masking
 * @param measure the stored line's byte length for a candidate capture
 * @param maxBytes the ceiling, {@link CALL_THREAD_ENTRY_MAX_BYTES} unless a test narrows it
 * @returns the fitted capture and its truncation, or `undefined` when even empty leaves leave the line over the
 *   ceiling — a capture of that many keys is withheld rather than cut
 */
export function fitCapture({
  capture,
  measure,
  maxBytes = CALL_THREAD_ENTRY_MAX_BYTES,
}: {
  capture: JsonValue;
  measure: MeasureLine;
  maxBytes?: number;
}): Fitted | undefined {
  const originalBytes = measure({ capture, truncation: null });
  if (originalBytes <= maxBytes) {
    return { capture, truncation: null };
  }
  // Every attempt is measured carrying the truncation record at its widest — no leaf can lose more bytes than the
  // whole line held — so the record the kept line really carries never pushes it back over the ceiling.
  const widest: Truncation = { originalBytes, truncatedBytes: originalBytes };
  const attempt = ({ capBytes }: { capBytes: number }): { capture: JsonValue; cutBytes: number; bytes: number } => {
    const cut = { bytes: 0 };
    const capped = capLeaves({ capBytes, cut, value: capture });
    return { bytes: measure({ capture: capped, truncation: widest }), capture: capped, cutBytes: cut.bytes };
  };
  const floor = attempt({ capBytes: 0 });
  if (floor.bytes > maxBytes) {
    return undefined;
  }
  let best = floor;
  let low = 0;
  let high = longestLeaf({ value: capture });
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const tried = attempt({ capBytes: mid });
    if (tried.bytes <= maxBytes) {
      best = tried;
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { capture: best.capture, truncation: { originalBytes, truncatedBytes: best.cutBytes } };
}
