/**
 * How a `read_page` answer is held under its byte bound (`./pageVoice.ts`): a reading too big for one answer is cut
 * into windows a read on continues through, a reading that crossed from the console window is cut to fit beside this
 * window's own fields, and the whole reading's own cuts ride on every window. Split out of `./pageVoice.ts`, which
 * keeps what the voice knows about the page; this file keeps how much of it one answer carries.
 */

import { type PageReadWindow, pageReadingId, pageWindowOf } from "./pageReadWindow";
import type { PageRead } from "./pageVoice";
import type { Json } from "./readCoverage";
import { cutMarked } from "./talkOffer";
import { toolCutsOf } from "./toolCuts";

/**
 * Why a read carries none of the page's own fields: they leave no room under its bound even for {@link NO_ROOM}, so
 * saying so at all means dropping them. Worded to be true whenever it is reached, never that a field ALONE passes the
 * bound, which a path just short of it does not.
 */
const PAST_THE_BOUND =
  "this page's own path, title and open card leave no room under this read's bound even to say so, so none of them rides in it, nor any of its reading";

/** The shortest saying of a read carrying none of its reading, tried before the page's own fields are dropped. */
const NO_ROOM = "no room under this read's bound for any of its reading";

/** The most of a whole reading's own cuts a window carries, beside a count of the rest. */
const READING_CUTS_MAX = 8;

/** The most characters of one of those cuts a window carries, the cut marked past it. */
const READING_CUT_MAX_CHARS = 200;

/**
 * UTF-8 size of a string.
 *
 * @param text the string to measure
 * @returns its size in bytes
 */
export function byteLength({ text }: { text: string }): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Parsed JSON text as the `Json` it is. A value `JSON.parse` returns carries only what JSON can spell, so every
 * branch here is exact: nothing is dropped or rewritten.
 *
 * @param value what `JSON.parse` returned
 * @returns the same value, typed
 */
function jsonOf({ value }: { value: unknown }): Json {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonOf({ value: item }));
  }
  if (typeof value !== "object") {
    throw new Error(`JSON.parse returned a ${typeof value}, which JSON text cannot spell`);
  }
  const bag: Record<string, Json> = {};
  for (const [key, field] of Object.entries(value)) {
    bag[key] = jsonOf({ value: field });
  }
  return bag;
}

/**
 * The cuts a whole reading marks, as the read_page probes word them (`./toolCuts.ts`), for a window to carry: its
 * own `shows` is a fragment of text no probe can see into. They are read off the very
 * serialised text the windows cut, parsed back, so a reading serialised through its own `toJSON` is probed as the
 * text it became, never as the object it was.
 *
 * @param text the page's whole reading, serialised exactly as its windows cut it
 * @returns one clause per cut, or `undefined` when it marks none
 */
export function readingCutsOf({ text }: { text: string }): readonly string[] | undefined {
  const parsed: unknown = JSON.parse(text);
  const cuts = toolCutsOf({ answer: { shows: jsonOf({ value: parsed }) }, tool: "read_page" });
  if (cuts.length === 0) {
    return undefined;
  }
  // A clause quotes its marker's value, which the reading sets, so each is cut and only the first few ride: uncapped,
  // one long marker passed the bound and crowded out every window.
  const kept = cuts.slice(0, READING_CUTS_MAX).map((cut) => cutMarked({ max: READING_CUT_MAX_CHARS, text: cut }));
  if (cuts.length > READING_CUTS_MAX) {
    return [...kept, `and ${String(cuts.length - READING_CUTS_MAX)} more cuts the whole reading marks`];
  }
  return kept;
}

/**
 * A carried read, kept under the bound. This window rebuilds the read with the path it has, which can be longer than
 * the console window's, so the page's own path, title and open card stay whole and the reading that crossed is cut to
 * the largest start of it that fits beside them, its cut saying how much of what crossed it carries. Only when those fields leave no room for any of it is none carried, and said so; only when they
 * alone pass the bound are they blanked too.
 *
 * @param read the page read, rebuilt from what crossed
 * @param maxBytes the byte bound on the serialised answer
 * @returns the read as it was when it fits, else with the reading cut, else carrying none of it
 */
export function withinBound({ read, maxBytes }: { read: PageRead; maxBytes: number }): PageRead {
  const fits = ({ answer }: { answer: PageRead }): boolean => byteLength({ text: JSON.stringify(answer) }) <= maxBytes;
  if (fits({ answer: read })) {
    return read;
  }
  const text = typeof read.shows === "string" ? read.shows : JSON.stringify(read.shows);
  const crossed = byteLength({ text });
  let crossedCut = "it crossed whole";
  if (read.truncated !== undefined) {
    crossedCut = `its own cut reads: ${read.truncated}`;
  }
  const cutAt = ({ budget }: { budget: number }): PageRead => {
    const window = pageWindowOf({ from: 0, maxBytes: budget, text });
    const carried = byteLength({ text: window.text });
    const truncated = `the voice's window carries only the first ${String(carried)} of the ${String(crossed)} bytes of this page's reading that crossed to it; ${crossedCut}`;
    return { ...read, shows: window.text, truncated };
  };
  let low = 1;
  let high = Math.max(1, Math.min(crossed - 1, maxBytes));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits({ answer: cutAt({ budget: mid }) })) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const cut = cutAt({ budget: low });
  if (crossed > 0 && fits({ answer: cut })) {
    return cut;
  }
  const named = {
    ...read,
    shows: "",
    truncated: `the page's own path, title and open card leave no room under this read's ${String(maxBytes)}-byte bound for any of the ${String(crossed)} bytes of its reading that crossed to the voice's window`,
  };
  if (fits({ answer: named })) {
    return named;
  }
  // The fields may fit beside a shorter sentence where not beside that one: they are dropped only past that.
  const terse = { ...named, truncated: NO_ROOM };
  if (fits({ answer: terse })) {
    return terse;
  }
  return { ...named, open: undefined, page: "", path: "", truncated: PAST_THE_BOUND };
}

/**
 * One window of a reading, as a page read: the sentence naming the read on only while more follows. It rides in
 * `readOn`, never `truncated`, which says a cut no call reads on from (`./toolCuts.ts`); the window's cut is its
 * `nextFrom` (`./readCoverage.ts`).
 *
 * @param whole the page read the window rides in
 * @param text the serialised reading
 * @param start where the window starts, in bytes
 * @param readOn the sentence a window with more after it carries
 * @param maxBytes the most the read carries, its own fields included
 * @param cuts the cuts the whole reading marks, carried on every window and every no-room answer alike
 * @returns the page read
 */
export function windowRead({
  whole,
  text,
  start,
  readOn,
  maxBytes,
  cuts,
}: {
  whole: PageRead;
  text: string;
  start: number;
  readOn: string;
  maxBytes: number;
  cuts: readonly string[] | undefined;
}): PageReadWindow {
  const reading = pageReadingId({ text });
  /** The whole answer carrying the window a byte budget cuts, its read on only while more follows. */
  const answerAt = ({ budget }: { budget: number }): PageReadWindow => {
    const window = pageWindowOf({ from: start, maxBytes: budget, text });
    const more = window.nextFrom === undefined ? undefined : readOn;
    return {
      ...whole,
      nextFrom: window.nextFrom,
      reading,
      readingCuts: cuts,
      readOn: more,
      shows: window.text,
      size: window.size,
      start,
    };
  };
  const fits = ({ answer }: { answer: PageReadWindow }): boolean =>
    byteLength({ text: JSON.stringify(answer) }) <= maxBytes;
  // Every candidate is measured as the WHOLE answer it would be, so the window's escapes, its own two quotes and the
  // digits of `nextFrom` and `size` are counted exactly, with no frame reserving room a real answer does not use. The
  // rest of the reading first, in one last window carrying no `nextFrom` and no read on; its raw bytes alone past the
  // bound cannot fit.
  const last = answerAt({ budget: Number.POSITIVE_INFINITY });
  const restBytes = last.size - start;
  if (restBytes <= maxBytes && fits({ answer: last })) {
    return last;
  }
  // Short of the end, every window carries a `nextFrom` and a read on, and a bigger budget cuts a longer prefix of the
  // same text, so the answer only grows with its budget: search for the largest that fits, never shrinking a fixed
  // number of times and giving up on a reading dense with escapes.
  let low = 1;
  let high = Math.max(1, Math.min(restBytes - 1, maxBytes));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits({ answer: answerAt({ budget: mid }) })) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const window = answerAt({ budget: low });
  if (fits({ answer: window })) {
    return window;
  }
  // A window always carries one character, so one that still does not fit means the page's own fields leave no room:
  // say so, offering no read on, rather than pass the bound. They are its path, its title
  // and the card it has open, each riding whole, so together they can fill the bound.
  // The reading's own cuts ride before any of its text, so a window never reads as whole over one;
  // when they are what fills the room, the sentence names them.
  // The sentence stays shorter than the read on it replaces, so where a window only just misses, saying so still fits
  // beside the page's own fields rather than falling through to blanking them.
  let fields = "path, title and open card";
  if (cuts !== undefined) {
    fields = "path, title, open card and reading cuts";
  }
  const truncated = `no room beside this page's ${fields} under the ${String(maxBytes)}-byte bound for any of its ${String(last.size)}-byte reading`;
  const empty = {
    ...whole,
    nextFrom: undefined,
    reading,
    readingCuts: cuts,
    readOn: undefined,
    shows: "",
    size: last.size,
    start,
  };
  const named = { ...empty, truncated };
  if (byteLength({ text: JSON.stringify(named) }) <= maxBytes) {
    return named;
  }
  // Before the page's own fields are dropped, the shortest saying, without the cuts: this answer carries none of the
  // reading, so its `truncated` is already a cut and the cuts add nothing a window could be read as whole over. The
  // fields are dropped only where even that cannot ride beside them.
  const terse = { ...empty, readingCuts: undefined, truncated: NO_ROOM };
  if (byteLength({ text: JSON.stringify(terse) }) <= maxBytes) {
    return terse;
  }
  return { ...empty, open: undefined, page: "", path: "", readingCuts: undefined, truncated: PAST_THE_BOUND };
}
