/**
 * Line up two versions of a document and say, for every row, whether it is unchanged, a FORMATTING change or a
 * MATERIAL one.
 *
 * A diff is a mix of formatting and material changes. The split is decided by one test, never by judgement: two sides that say the same words in the same
 * order (`./units.ts`'s `canonicalWords` — punctuation, case and markup gone) are formatting, whatever else moved.
 * That test is applied to a whole change hunk first, so a sentence split into a nested list is one formatting row
 * rather than a removal and three additions. What may still move under the same words is `./formatting.ts`'s call.
 *
 * Pure.
 */
import { diffArrays } from "diff";

import { formattingKinds, nestingHolds, sameLiterals, structureDiffers } from "./formatting.js";
import type { FormattingKind } from "./record.js";
import { canonicalWords, type DocUnit, plainText } from "./units.js";

/** What a row is. `changed`, `added` and `removed` are the material kinds. */
export type DiffRowKind = "same" | "formatting" | "changed" | "added" | "removed";

/** One row of the aligned diff: the units on each side, and what kind of change joins them. */
export interface DiffRow {
  readonly kind: DiffRowKind;
  readonly before: readonly DocUnit[];
  readonly after: readonly DocUnit[];
  /** What kind of formatting moved, for a `formatting` row; empty for every other kind. */
  readonly formatting: readonly FormattingKind[];
  /** The nearest heading at or above this row, as plain text, for context. */
  readonly section: string;
}

/** The share of words two sides must have in common, in order, to be the same sentence edited. */
const PAIRING_SIMILARITY = 0.4;

/**
 * Whether a row kind is a material change.
 *
 * @returns true for `changed`, `added` and `removed`
 */
export function isMaterial({ kind }: { kind: DiffRowKind }): boolean {
  return kind === "changed" || kind === "added" || kind === "removed";
}

/** The words of several units, joined. */
function wordsOf({ units }: { units: readonly DocUnit[] }): readonly string[] {
  return units.flatMap((unit) => canonicalWords({ markdown: unit.raw }));
}

/** Whether two word lists are the same words in the same order. */
function sameWords({ a, b }: { a: readonly string[]; b: readonly string[] }): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

/**
 * The share of the SHORTER side's words the longer one holds in order, past which a short unit is a piece of the
 * long one — the opening line of a paragraph that became a list, which {@link similarity} scores far below
 * {@link PAIRING_SIMILARITY} because the paragraph is long. `src/__tests__/unit/policy/diff/align.test.ts` holds the
 * case.
 */
const CONTAINMENT = 0.8;

/** The fewest words a side may have for {@link CONTAINMENT} to pair it, so a two-word line cannot pair by luck. */
const CONTAINMENT_MIN_WORDS = 3;

/** The words two sides share in order, and how many each has. */
function overlap({ a, b }: { a: readonly DocUnit[]; b: readonly DocUnit[] }): {
  shared: number;
  left: number;
  right: number;
} {
  const wa = wordsOf({ units: a });
  const wb = wordsOf({ units: b });
  let shared = 0;
  for (const part of diffArrays([...wa], [...wb])) {
    if (part.added !== true && part.removed !== true) {
      shared += part.value.length;
    }
  }
  return { left: wa.length, right: wb.length, shared };
}

/**
 * How alike two sides are: twice the words they share in order, over the words in both. 1 is identical, 0 shares
 * nothing.
 *
 * @returns the similarity, between 0 and 1
 */
function similarity({ a, b }: { a: readonly DocUnit[]; b: readonly DocUnit[] }): number {
  const { shared, left, right } = overlap({ a, b });
  if (left + right === 0) {
    return 1;
  }
  return (2 * shared) / (left + right);
}

/** Whether two units are the same text edited, or one is a piece the other was split into. */
function pairs({ a, b }: { a: readonly DocUnit[]; b: readonly DocUnit[] }): boolean {
  if (similarity({ a, b }) >= PAIRING_SIMILARITY) {
    return true;
  }
  const { shared, left, right } = overlap({ a, b });
  const shorter = Math.min(left, right);
  return shorter >= CONTAINMENT_MIN_WORDS && shared / shorter >= CONTAINMENT;
}

/** One row before sections are attached. */
interface BareRow {
  readonly kind: DiffRowKind;
  readonly before: readonly DocUnit[];
  readonly after: readonly DocUnit[];
  readonly formatting: readonly FormattingKind[];
}

/**
 * A row for two sides that matched on their words: unchanged when byte-identical, formatting when only the markup
 * moved, and changed when what the words sit under moved (`nestingHolds`) or a link, an image or a piece of code
 * under the same words changed (`sameLiterals`).
 */
function matchedRow({ before, after }: { before: readonly DocUnit[]; after: readonly DocUnit[] }): BareRow {
  const identical =
    !structureDiffers({ after, before }) && before.every((unit, index) => unit.raw === after[index]!.raw);
  if (identical) {
    return { after, before, formatting: [], kind: "same" };
  }
  if (!nestingHolds({ after, before }) || !sameLiterals({ after, before })) {
    return { after, before, formatting: [], kind: "changed" };
  }
  return { after, before, formatting: formattingKinds({ after, before }), kind: "formatting" };
}

/**
 * The longest run of `side` units starting at `from` that is more like `other` than any shorter run — so a sentence
 * split into three list items pairs with all three.
 *
 * @returns how many units the run holds, at least one
 */
function runLength({
  side,
  from,
  other,
}: {
  side: readonly DocUnit[];
  from: number;
  other: readonly DocUnit[];
}): number {
  let length = 1;
  let best = similarity({ a: other, b: side.slice(from, from + 1) });
  while (from + length < side.length) {
    const next = similarity({ a: other, b: side.slice(from, from + length + 1) });
    if (next <= best) {
      break;
    }
    best = next;
    length += 1;
  }
  return length;
}

/** A walk through one change hunk: the rows so far, and how far into each side they reach. */
interface HunkWalk {
  readonly removed: readonly DocUnit[];
  readonly added: readonly DocUnit[];
  readonly rows: BareRow[];
  r: number;
  a: number;
}

/** The first removed unit at or past the walk's cursor that pairs with the added unit at its cursor, or -1. */
function pairIndex({ walk }: { walk: HunkWalk }): number {
  const unit = walk.added.slice(walk.a, walk.a + 1);
  for (let k = walk.r; k < walk.removed.length; k += 1) {
    if (pairs({ a: walk.removed.slice(k, k + 1), b: unit })) {
      return k;
    }
  }
  return -1;
}

/** Every removed unit from the walk's cursor up to `until`, each a removed row. */
function removeUntil({ walk, until }: { walk: HunkWalk; until: number }): void {
  while (walk.r < until) {
    walk.rows.push({ after: [], before: walk.removed.slice(walk.r, walk.r + 1), formatting: [], kind: "removed" });
    walk.r += 1;
  }
}

/** The run at the walk's cursors that pairs, as one row: matched when its words agree, else changed. */
function takePairedRun({ walk }: { walk: HunkWalk }): void {
  const takeAdded = runLength({ from: walk.a, other: walk.removed.slice(walk.r, walk.r + 1), side: walk.added });
  const takeRemoved = runLength({
    from: walk.r,
    other: walk.added.slice(walk.a, walk.a + takeAdded),
    side: walk.removed,
  });
  const before = walk.removed.slice(walk.r, walk.r + takeRemoved);
  const after = walk.added.slice(walk.a, walk.a + takeAdded);
  if (sameWords({ a: wordsOf({ units: before }), b: wordsOf({ units: after }) })) {
    walk.rows.push(matchedRow({ after, before }));
  } else {
    walk.rows.push({ after, before, formatting: [], kind: "changed" });
  }
  walk.r += takeRemoved;
  walk.a += takeAdded;
}

/**
 * The rows of one change hunk: everything removed and everything added between two unchanged stretches.
 *
 * @returns the hunk's rows in document order
 */
function hunkRows({ removed, added }: { removed: readonly DocUnit[]; added: readonly DocUnit[] }): readonly BareRow[] {
  const whole = removed.length > 0 && added.length > 0;
  if (whole && sameWords({ a: wordsOf({ units: removed }), b: wordsOf({ units: added }) })) {
    return [matchedRow({ after: added, before: removed })];
  }
  const walk: HunkWalk = { a: 0, added, r: 0, removed, rows: [] };
  while (walk.a < added.length) {
    const paired = pairIndex({ walk });
    if (paired === -1) {
      walk.rows.push({ after: added.slice(walk.a, walk.a + 1), before: [], formatting: [], kind: "added" });
      walk.a += 1;
    } else {
      removeUntil({ until: paired, walk });
      takePairedRun({ walk });
    }
  }
  removeUntil({ until: removed.length, walk });
  return walk.rows;
}

/** The key two units are matched on: their words. */
function keyOf({ unit }: { unit: DocUnit }): string {
  return canonicalWords({ markdown: unit.raw }).join(" ");
}

/**
 * The section each row sits in: the nearest heading at or above it on the later side.
 *
 * @returns one section per row, in order
 */
function sectionsOf({ rows }: { rows: readonly BareRow[] }): readonly string[] {
  let section = "";
  return rows.map((row) => {
    const heading = [...row.after, ...row.before].find((unit) => unit.kind === "heading");
    if (heading !== undefined && row.after.length > 0) {
      section = plainText({ markdown: heading.raw });
    }
    return section;
  });
}

/** One part of the key diff: unchanged, or a run of keys only one side has. */
interface KeyPart {
  readonly added?: boolean | undefined;
  readonly removed?: boolean | undefined;
  readonly value: readonly string[];
}

/** Whether a part of the key diff is a change rather than an unchanged run. */
function isChange({ part }: { part: KeyPart }): boolean {
  return part.added === true || part.removed === true;
}

/** How many units a change part removes and adds. */
function changeSpan({ part }: { part: KeyPart }): { removed: number; added: number } {
  if (part.removed === true) {
    return { added: 0, removed: part.value.length };
  }
  return { added: part.value.length, removed: 0 };
}

/**
 * Align two documents' units into rows. A line that moved is a removal and an addition, never folded into one
 * formatting row: steps reordered, or a line moved from under `Permitted:` to under `Prohibited:`, says something
 * different where it now stands, and no rule here can tell which moves do.
 *
 * @param before the earlier version's units
 * @param after the later version's units
 * @returns every row, in the later version's order, each with the section it sits in
 */
export function alignDocuments({
  before,
  after,
}: {
  before: readonly DocUnit[];
  after: readonly DocUnit[];
}): readonly DiffRow[] {
  const parts: readonly KeyPart[] = diffArrays(
    before.map((unit) => keyOf({ unit })),
    after.map((unit) => keyOf({ unit })),
  );
  const rows: BareRow[] = [];
  let b = 0;
  let a = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!isChange({ part })) {
      for (let k = 0; k < part.value.length; k += 1) {
        rows.push(matchedRow({ after: after.slice(a + k, a + k + 1), before: before.slice(b + k, b + k + 1) }));
      }
      a += part.value.length;
      b += part.value.length;
      continue;
    }
    const span = changeSpan({ part });
    const next = parts[i + 1];
    if (next !== undefined && isChange({ part: next }) && next.added !== part.added) {
      const other = changeSpan({ part: next });
      span.added += other.added;
      span.removed += other.removed;
      i += 1;
    }
    rows.push(...hunkRows({ added: after.slice(a, a + span.added), removed: before.slice(b, b + span.removed) }));
    a += span.added;
    b += span.removed;
  }
  const sections = sectionsOf({ rows });
  return rows.map((row, index): DiffRow => ({ ...row, section: sections[index]! }));
}
