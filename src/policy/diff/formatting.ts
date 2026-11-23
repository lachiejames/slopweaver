/**
 * Whether two sides that say the same words differ only in formatting, and if so which kinds.
 *
 * `./align.ts` decides a pair says the same words; this decides whether anything ELSE that matters moved under them —
 * the nesting the words hang from, a link's address, an image, a character of code — and names the formatting kinds
 * a row that passes carries.
 *
 * Pure.
 */
import type { FormattingKind } from "./record.js";
import { codeText, type DocUnit, plainText, type SideTokens, sideTokens } from "./units.js";

/** Whether two lists hold the same items in the same order. */
function sameList({ a, b }: { a: readonly string[]; b: readonly string[] }): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** The count of non-overlapping occurrences of a pattern. */
function occurrences({ text, pattern }: { text: string; pattern: RegExp }): number {
  return Array.from(text.matchAll(pattern)).length;
}

/**
 * Whether two sides are laid out differently: a different number, kind, level or depth of units.
 *
 * @returns true when any unit's shape differs, or the counts do
 */
export function structureDiffers({
  before,
  after,
}: {
  before: readonly DocUnit[];
  after: readonly DocUnit[];
}): boolean {
  if (before.length !== after.length) {
    return true;
  }
  return before.some((unit, index) => {
    const other = after[index]!;
    return unit.kind !== other.kind || unit.level !== other.level || unit.depth !== other.depth;
  });
}

/** The heading levels some units carry, in order. */
function headingLevels({ units }: { units: readonly DocUnit[] }): string {
  return units.flatMap((unit) => (unit.kind === "heading" ? [String(unit.level)] : [])).join(" ");
}

/**
 * Whether a row still hangs where it did: the same headings at the same levels, and its units at the same depths —
 * one for one when the count is unchanged, else every unit on both sides at ONE depth. A list item indented under the
 * one above it, or out of the list it was in, and a `##` becoming a `###`, all say the same words while moving what
 * they say under a different parent: "USB drives" under `Prohibited:` re-nested under `Allowed:` is a rule reversed.
 * A paragraph split into a list, or a list joined into a paragraph, where it stood is the same words in the same
 * place; a split that also nests is a parent given to what had none, so it is material too.
 *
 * @returns true when nothing was re-nested or re-levelled
 */
export function nestingHolds({ before, after }: { before: readonly DocUnit[]; after: readonly DocUnit[] }): boolean {
  if (headingLevels({ units: before }) !== headingLevels({ units: after })) {
    return false;
  }
  if (before.length === after.length) {
    return before.every((unit, index) => unit.depth === after[index]!.depth);
  }
  const depth = before[0]!.depth;
  return [...before, ...after].every((unit) => unit.depth === depth);
}

/** Letters and digits only, each run once, so two texts compare equal when only their case-blind words do. */
function caseOnly({ text }: { text: string }): string {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]).join(" ");
}

/** Every character that is not a letter, a digit or a space. */
function punctuationOf({ text }: { text: string }): string {
  return text.replace(/[\p{L}\p{N}\s]+/gu, "");
}

/**
 * What kind of formatting separates two sides that say the same words. Every kind present is named; a row whose
 * difference none of the named tests sees is `punctuation`, the residue.
 *
 * @returns the kinds, in a fixed order
 */
export function formattingKinds({
  before,
  after,
}: {
  before: readonly DocUnit[];
  after: readonly DocUnit[];
}): readonly FormattingKind[] {
  const kinds: FormattingKind[] = [];
  if (structureDiffers({ after, before })) {
    kinds.push("structure");
  }
  const b = before.map((unit) => unit.raw).join(" ");
  const a = after.map((unit) => unit.raw).join(" ");
  const plainB = plainText({ markdown: b });
  const plainA = plainText({ markdown: a });
  if (caseOnly({ text: plainB }) !== caseOnly({ text: plainA })) {
    kinds.push("case");
  }
  if (occurrences({ pattern: /\*\*|__/g, text: b }) !== occurrences({ pattern: /\*\*|__/g, text: a })) {
    kinds.push("emphasis");
  }
  if (occurrences({ pattern: /`/g, text: b }) !== occurrences({ pattern: /`/g, text: a })) {
    kinds.push("code");
  }
  if (occurrences({ pattern: /\]\(/g, text: b }) !== occurrences({ pattern: /\]\(/g, text: a })) {
    kinds.push("links");
  }
  if (punctuationOf({ text: plainB }) !== punctuationOf({ text: plainA }) || kinds.length === 0) {
    kinds.push("punctuation");
  }
  return kinds;
}

/** Whether two spans start and end at the same place. */
function sameBounds({
  a,
  b,
}: {
  a: { readonly start: number; readonly end: number };
  b: { readonly start: number; readonly end: number };
}): boolean {
  return a.start === b.start && a.end === b.end;
}

/**
 * Whether every piece of code on `from` reads every character of itself at the same words on `to` — in code or out
 * of it. The piece is pinned by its first and last word, and the characters it holds before the first and after the
 * last (`*.` in `*.log`, ` *` in `rm -rf *`) are read off `to` at the same distance, so nothing at either end goes
 * unread. What is read on `to` must be wholly out of code, or exactly one piece of code there — a character moved
 * across the code's edge (`` `PATH=/usr/bin`: `` to `` `PATH=/usr/bin:` ``) is not the same code. Anchored by
 * POSITION, so `env.prod` cannot pass because the other side says `env.prod` somewhere else; code holding no word is
 * {@link SideTokens}'s `anchors`, compared apart.
 */
function codeHolds({ from, to }: { from: SideTokens; to: SideTokens }): boolean {
  return from.codeSpans.every((span, index) => {
    const words = from.tokens.flatMap((token, at) => (token.code === index ? [at] : []));
    if (words.length === 0) {
      return true;
    }
    const first = from.tokens[words[0]!]!;
    const last = from.tokens[words.at(-1)!]!;
    const start = to.tokens[words[0]!]!.start - (first.start - span.start);
    const end = to.tokens[words.at(-1)!]!.end + (span.end - last.end);
    if (start < 0 || end > to.visible.length) {
      return false;
    }
    const overlapping = to.codeSpans.filter((other) => other.start < end && other.end > start);
    const clean =
      overlapping.length === 0 || (overlapping.length === 1 && sameBounds({ a: overlapping[0]!, b: { end, start } }));
    return (
      clean &&
      codeText({ text: from.visible.slice(span.start, span.end) }) === codeText({ text: to.visible.slice(start, end) })
    );
  });
}

/**
 * Whether every word under a link on both sides is under the same address, and the row only adds links or only
 * removes them — never both, which is a link moved to another phrase with the same words.
 */
function linksAgree({ before, after }: { before: SideTokens; after: SideTokens }): boolean {
  let added = 0;
  let removed = 0;
  for (const [index, token] of before.tokens.entries()) {
    const other = after.tokens[index]!.link;
    if (token.link !== null && other !== null && token.link !== other) {
      return false;
    }
    if (token.link === null && other !== null) {
      added += 1;
    }
    if (token.link !== null && other === null) {
      removed += 1;
    }
  }
  return added === 0 || removed === 0;
}

/**
 * Whether two sides that say the same words also point at the same places and carry the same code, compared word for
 * word ({@link sideTokens}). A link added to a phrase or taken off one is formatting, and so is code marked up or
 * unmarked when its characters survive; everything else is not:
 *
 * - a word under a link on both sides must be under the SAME address, and a row may add links or remove them, never
 *   both — so a link re-pointed, swapped, or moved to another phrase with the same words is a change;
 * - images must be the same, in order — a diagram added, removed or swapped is never formatting;
 * - every piece of code on either side must read the same at the same words on the other, so `a && b` cannot become
 *   `a || b` and `env.prod` cannot become `env-prod` as it is unmarked;
 * - a link or code span holding no word must be the same, after the same number of words.
 *
 * @returns true when nothing but formatting moved under the words
 */
export function sameLiterals({ before, after }: { before: readonly DocUnit[]; after: readonly DocUnit[] }): boolean {
  const b = sideTokens({ units: before });
  const a = sideTokens({ units: after });
  const sameWords = sameList({ a: a.tokens.map((token) => token.word), b: b.tokens.map((token) => token.word) });
  if (!sameWords || !sameList({ a: a.images, b: b.images }) || !sameList({ a: a.anchors, b: b.anchors })) {
    return false;
  }
  return linksAgree({ after: a, before: b }) && codeHolds({ from: b, to: a }) && codeHolds({ from: a, to: b });
}
