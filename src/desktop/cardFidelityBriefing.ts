/**
 * Whether the briefing a card carries was READ before it was answered: the card-fidelity judge's attachment check
 * (`./cardFidelity.ts`). Pure.
 *
 * A card's briefing is what its own answer names (`./cardFidelitySource.ts`): an ask's board row, which `board_row`
 * reads by slug, and every local file the card links, which `file_read` takes. Opening a page on the owner's screen is not
 * reading it, so `open_card` never counts. A read counts only between the card's first read and the challenge — the
 * turn that answered. A `board_row` line is matched by the slug its kept answer carries, since its detail names none
 * (`site/components/voice/talkToolCalls.ts`); one whose answer was not kept can be neither matched nor ruled out, so
 * the state is `not-measured` rather than `not-read`.
 */
import type { CallEntry } from "../talk/callRecord.js";
import type { CardSource } from "./cardFidelitySource.js";

/** How much of the card's briefing was read. */
export interface BriefingRead {
  /** `read` all of it, `partial`, `not-read`, `not-applicable` when the card names none, `not-measured`. */
  readonly state: "read" | "partial" | "not-read" | "not-applicable" | "not-measured";
  /** Everything the card names: `board:<slug>` and each file path. */
  readonly expected: readonly string[];
  /** Which of those were read. */
  readonly read: readonly string[];
}

/** A `file_read` detail: `read <path>`, optionally ` from <n>` (`talkToolCalls.ts`'s `detailOf`). */
const FILE_READ = /^read (.+?)(?: from \S+)?$/u;

/**
 * Whether a path `file_read` was called with is a file the card names. The model may spell a home path with `~`
 * (`read ~/.slopweaver/pages/…`, measured on a real call), which names the same file as its absolute spelling.
 *
 * @param file the absolute path the card names
 * @param path the path the tool was called with
 * @returns whether they are the same file
 */
function samePath({ file, path }: { file: string; path: string }): boolean {
  if (path.startsWith("~/")) {
    return file.endsWith(path.slice(1)) && file.startsWith("/");
  }
  return file === path;
}

/**
 * Which briefing item one tool call read: a file the card names, by `file_read`, or its board row, by `board_row`
 * — or that a `board_row` answer was not kept, so whether it named the row cannot be measured.
 *
 * @param entry one tool call in the answering turn
 * @param source the card as read
 * @returns the item read, `unmatched`, or `none`
 */
function briefingItemOf({
  entry,
  source,
}: {
  entry: CallEntry;
  source: CardSource;
}): { readonly kind: "read"; readonly item: string } | { readonly kind: "unmatched" } | { readonly kind: "none" } {
  if (entry.kind !== "tool") {
    return { kind: "none" };
  }
  if (entry.name === "file_read") {
    const path = FILE_READ.exec(entry.detail)?.[1];
    const named = path === undefined ? undefined : source.files.find((file) => samePath({ file, path }));
    return named === undefined ? { kind: "none" } : { item: named, kind: "read" };
  }
  if (entry.name !== "board_row" || source.boardSlug === undefined) {
    return { kind: "none" };
  }
  if (entry.answer === undefined) {
    return { kind: "unmatched" };
  }
  const board = `board:${source.boardSlug}`;
  return entry.answer.includes(`"${source.boardSlug}"`) ? { item: board, kind: "read" } : { kind: "none" };
}

/**
 * What of the card's briefing was read in the turn that answered it.
 *
 * @param ordered the call's lines, in instant order
 * @param source the card as read, `undefined` when its answer was not kept
 * @param fromMs the card's first read
 * @param toMs the challenge, or no bound
 * @returns the reading
 */
export function briefingOf({
  ordered,
  source,
  fromMs,
  toMs,
}: {
  ordered: readonly CallEntry[];
  source: CardSource | undefined;
  fromMs: number;
  toMs: number;
}): BriefingRead {
  if (source === undefined) {
    return { expected: [], read: [], state: "not-measured" };
  }
  const board = source.boardSlug === undefined ? [] : [`board:${source.boardSlug}`];
  const expected = [...board, ...source.files];
  if (expected.length === 0) {
    return { expected, read: [], state: "not-applicable" };
  }
  const tools = ordered.filter((entry) => {
    const atMs = Date.parse(entry.atIso);
    return entry.kind === "tool" && !entry.refused && atMs >= fromMs && atMs < toMs;
  });
  const reads = tools.map((entry) => briefingItemOf({ entry, source }));
  const read = new Set(reads.flatMap((one) => (one.kind === "read" ? [one.item] : [])));
  const unmatched = reads.some((one) => one.kind === "unmatched");
  const kept = expected.filter((item) => read.has(item));
  if (kept.length === expected.length) {
    return { expected, read: kept, state: "read" };
  }
  if (unmatched) {
    return { expected, read: kept, state: "not-measured" };
  }
  return { expected, read: kept, state: kept.length === 0 ? "not-read" : "partial" };
}
