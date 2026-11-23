/**
 * The block surgery behind `./claimCorrection.ts`: find where a message's blocks make a claim, strike it there, and
 * put the Correction block directly under the block that made it. Split out under the file-size cap along the line
 * between WHERE the claim sits in Slack's block tree (here) and WHETHER a correction may be composed at all (there,
 * with the contract). Pure, like its caller. `correctBlocks`, `correctionFollows`, `countInBlock`, `isCorrectionLine`,
 * `stringValues`, `unstrikeableCount`, `CORRECTION_LABEL` and `OPAQUE` are exported from here only and
 * `./claimCorrection.ts` imports them; this module imports nothing from it. Reading `mrkdwn` text for what a `~` cannot
 * reach is `./claimMrkdwnSpans.ts`.
 */

import { isDeepStrictEqual } from "node:util";

import { isRecord } from "../../lib/parsers.js";
import { occurrences, opaqueSpanCount } from "./claimMrkdwnSpans.js";

/** The label the line opens with, bold. */
export const CORRECTION_LABEL = "Correction:";

/** Stands in for an element the claim cannot run through: a mention, an emoji, a link with no label. */
export const OPAQUE = "\u0000";

/** The string a rich-text leaf reads as, one entry per element, an opaque stand-in where words are not text. */
function leafPieces({ leaf }: { leaf: Record<string, unknown> }): readonly string[] {
  const elements = Array.isArray(leaf["elements"]) ? leaf["elements"] : [];
  return elements.map((element) => {
    if (!isRecord(element)) {
      return OPAQUE;
    }
    const text = element["text"];
    const matchable = element["type"] === "text" || element["type"] === "link";
    return matchable && typeof text === "string" ? text : OPAQUE;
  });
}

/** The leaves of one `rich_text` block: each section, quote and preformatted run, and each list item. */
function richLeaves({ block }: { block: Record<string, unknown> }): readonly Record<string, unknown>[] {
  const elements = Array.isArray(block["elements"]) ? block["elements"] : [];
  return elements.flatMap((element) => {
    if (!isRecord(element)) {
      return [];
    }
    if (element["type"] === "rich_text_list") {
      const items = Array.isArray(element["elements"]) ? element["elements"] : [];
      return items.filter(isRecord);
    }
    return [element];
  });
}

/**
 * How many times one block makes the claim.
 *
 * @returns the count across its rich-text leaves or its `mrkdwn` text; zero for any other block
 */
export function countInBlock({ block, wrong }: { block: unknown; wrong: string }): number {
  if (!isRecord(block)) {
    return 0;
  }
  if (block["type"] === "rich_text") {
    return richLeaves({ block }).reduce(
      (sum, leaf) => sum + occurrences({ haystack: leafPieces({ leaf }).join(""), needle: wrong }).length,
      0,
    );
  }
  const text = mrkdwnOf({ block });
  return text === undefined ? 0 : occurrences({ haystack: text, needle: wrong }).length;
}

/** Keys naming a node's kind or identity rather than anything a reader sees. */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["block_id", "type"]);

/**
 * Every string anywhere in a tree, under any key but a structural one — `text`, `alt_text`, a date's `fallback`, a
 * placeholder, a title — since which of them Slack renders differs by element kind and an allowlist of keys is one
 * more renderable field away from wrong.
 *
 * @returns every non-structural string, in document order
 */
export function stringValues({ value }: { value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringValues({ value: item }));
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, inner]) =>
    STRUCTURAL_KEYS.has(key) ? [] : stringValues({ value: inner }),
  );
}

/**
 * What a block holds outside the text the strike reads: rich text's elements other than a text run or a LABELLED
 * link (a label-less link shows its URL, which `leafPieces` reads as opaque), else all but a section's `mrkdwn` text.
 */
function outsideStrike({ block }: { block: Record<string, unknown> }): unknown {
  if (block["type"] === "rich_text") {
    return richLeaves({ block }).flatMap((leaf) => {
      const elements = Array.isArray(leaf["elements"]) ? leaf["elements"] : [];
      return elements.filter((element) => {
        if (!isRecord(element) || typeof element["text"] !== "string") {
          return true;
        }
        // An empty label shows the address too, so only a non-empty one hides the URL.
        const labelledLink = element["type"] === "link" && element["text"].length > 0;
        return element["type"] !== "text" && !labelledLink;
      });
    });
  }
  return mrkdwnOf({ block }) === undefined ? block : { ...block, text: undefined };
}

/**
 * How many times one block shows the claim where no strike can reach it: a header, a context line or image's alt
 * text, a section's fields or `plain_text`, a rich-text date's fallback, a rich-text preformatted block or code run, a
 * `mrkdwn` code span or `<…>` token. `countInBlock` and the strike read only
 * rich text's text and link runs and a section's `mrkdwn` text, so a copy anywhere else stays readable after a
 * correction lands.
 *
 * @returns the count outside the strikeable text
 */
export function unstrikeableCount({ block, wrong }: { block: unknown; wrong: string }): number {
  if (!isRecord(block)) {
    return 0;
  }
  const texts = stringValues({ value: outsideStrike({ block }) });
  // Joined too, since Slack renders adjacent elements (a context line's, say) as one run a claim can span.
  const outside = [...texts, texts.join(""), texts.join(" ")].reduce(
    (sum, text) => sum + occurrences({ haystack: text, needle: wrong }).length,
    0,
  );
  const mrkdwn = mrkdwnOf({ block });
  return (
    outside + richCodeCount({ block, wrong }) + (mrkdwn === undefined ? 0 : opaqueSpanCount({ text: mrkdwn, wrong }))
  );
}

/**
 * How many times a rich-text block makes the claim touching code — a preformatted leaf, or a code-styled run — read
 * over each leaf's joined text, as `countInBlock` reads it, so a claim running from plain words into code counts. A
 * strike is not known to render on code, so such a copy is never struck.
 */
function richCodeCount({ block, wrong }: { block: Record<string, unknown>; wrong: string }): number {
  if (block["type"] !== "rich_text") {
    return 0;
  }
  return richLeaves({ block }).reduce((sum, leaf) => {
    const elements = Array.isArray(leaf["elements"]) ? leaf["elements"] : [];
    const pieces = leafPieces({ leaf });
    const preformatted = leaf["type"] === "rich_text_preformatted";
    const code: { start: number; end: number }[] = [];
    let offset = 0;
    pieces.forEach((piece, index) => {
      const element: unknown = elements[index];
      const codeRun = isRecord(element) && isRecord(element["style"]) && element["style"]["code"] === true;
      if (preformatted || codeRun) {
        code.push({ end: offset + piece.length, start: offset });
      }
      offset += piece.length;
    });
    const touching = occurrences({ haystack: pieces.join(""), needle: wrong }).filter((at) =>
      code.some(({ end, start }) => at < end && at + wrong.length > start),
    );
    return sum + touching.length;
  }, 0);
}

/** A `section` block's `mrkdwn` text, when it has one. */
function mrkdwnOf({ block }: { block: Record<string, unknown> }): string | undefined {
  const text = block["text"];
  if (block["type"] !== "section" || !isRecord(text) || text["type"] !== "mrkdwn") {
    return undefined;
  }
  return typeof text["text"] === "string" ? text["text"] : undefined;
}

/** Whether an element's style already strikes it. */
function isStruck({ element }: { element: Record<string, unknown> }): boolean {
  const style = element["style"];
  return isRecord(style) && style["strike"] === true;
}

/** One element cut to `[from, to)` of its text, struck or not. */
function cut({
  element,
  from,
  strike,
  text,
  to,
}: {
  element: Record<string, unknown>;
  from: number;
  strike: boolean;
  text: string;
  to: number;
}): Record<string, unknown> {
  const style = isRecord(element["style"]) ? element["style"] : {};
  const nextStyle = strike ? { ...style, strike: true } : style;
  const bare = Object.fromEntries(Object.entries(element).filter(([key]) => key !== "style"));
  const styled = Object.keys(nextStyle).length > 0 ? { style: nextStyle } : {};
  return { ...bare, ...styled, text: text.slice(from, to) };
}

/**
 * One leaf with `[start, end)` of its visible string struck: the covered text runs split at the claim's edges.
 *
 * @returns the rewritten leaf, and whether every covered run was struck already
 */
function strikeLeaf({ leaf, start, end }: { leaf: Record<string, unknown>; start: number; end: number }): {
  readonly leaf: Record<string, unknown>;
  readonly alreadyStruck: boolean;
} {
  const elements = Array.isArray(leaf["elements"]) ? leaf["elements"] : [];
  const pieces = leafPieces({ leaf });
  const rewritten: unknown[] = [];
  let offset = 0;
  let allStruck = true;
  elements.forEach((element, index) => {
    const piece = pieces[index]!;
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, piece.length);
    offset += piece.length;
    if (!isRecord(element) || from >= to) {
      rewritten.push(element);
      return;
    }
    allStruck = allStruck && isStruck({ element });
    const parts = [
      { from: 0, strike: isStruck({ element }), to: from },
      { from, strike: true, to },
      { from: to, strike: isStruck({ element }), to: piece.length },
    ].filter((part) => part.to > part.from);
    for (const part of parts) {
      rewritten.push(cut({ element, from: part.from, strike: part.strike, text: piece, to: part.to }));
    }
  });
  return { alreadyStruck: allStruck, leaf: { ...leaf, elements: rewritten } };
}

/** The Correction line, as its own rich-text block. */
function correctionBlock({ correction }: { correction: string }): Record<string, unknown> {
  return {
    elements: [
      {
        elements: [
          { style: { bold: true }, text: `${CORRECTION_LABEL} `, type: "text" },
          { text: correction, type: "text" },
        ],
        type: "rich_text_section",
      },
    ],
    type: "rich_text",
  };
}

/** One block with its single occurrence struck, or undefined when it does not make the claim. */
function strikeBlock({
  block,
  wrong,
}: {
  block: Record<string, unknown>;
  wrong: string;
}): { readonly block: Record<string, unknown>; readonly alreadyStruck: boolean } | undefined {
  if (block["type"] === "rich_text") {
    const elements = Array.isArray(block["elements"]) ? block["elements"] : [];
    let result: { alreadyStruck: boolean } | undefined;
    const strikeIn = (leaf: Record<string, unknown>): Record<string, unknown> => {
      const at = leafPieces({ leaf }).join("").indexOf(wrong);
      if (at === -1) {
        return leaf;
      }
      const struck = strikeLeaf({ end: at + wrong.length, leaf, start: at });
      result = { alreadyStruck: struck.alreadyStruck };
      return struck.leaf;
    };
    const rewritten = elements.map((element) => {
      if (!isRecord(element)) {
        return element;
      }
      if (element["type"] === "rich_text_list") {
        const items = Array.isArray(element["elements"]) ? element["elements"] : [];
        return { ...element, elements: items.map((item) => (isRecord(item) ? strikeIn(item) : item)) };
      }
      return strikeIn(element);
    });
    return result === undefined
      ? undefined
      : { alreadyStruck: result.alreadyStruck, block: { ...block, elements: rewritten } };
  }
  const text = mrkdwnOf({ block });
  if (text === undefined || !text.includes(wrong)) {
    return undefined;
  }
  const struckAlready = text.includes(`~${wrong}~`);
  const textField = isRecord(block["text"]) ? block["text"] : {};
  return {
    alreadyStruck: struckAlready,
    block: { ...block, text: { ...textField, text: text.replace(wrong, `~${wrong}~`) } },
  };
}

/**
 * Whether one block IS the Correction line `correctBlocks` writes for this correction — the same elements and styles,
 * bar the `block_id` Slack assigns — so a line reading the same in other markup (a link, code) is not this one.
 *
 * @param correction the trimmed correction line
 * @returns whether the block is that line
 */
export function isCorrectionLine({ block, correction }: { block: unknown; correction: string }): boolean {
  if (!isRecord(block)) {
    return false;
  }
  const { block_id: _assigned, ...shape } = block;
  return isDeepStrictEqual(shape, correctionBlock({ correction }));
}

/**
 * Whether a block list ALREADY shows this exact correction: the claim struck, and the block directly under it
 * reading exactly as the Correction line `correctBlocks` writes. A strike with a different line, or none, is not.
 * It judges the first occurrence in each block, so a caller holding a whole message also asks that the claim
 * occurs once (`claimCorrectedAs`).
 *
 * @param correction the trimmed correction line
 * @returns whether the struck claim and this line sit together
 */
export function correctionFollows({
  blocks,
  correction,
  wrong,
}: {
  blocks: readonly unknown[];
  correction: string;
  wrong: string;
}): boolean {
  return blocks.some((block, index) => {
    // A Correction line that quotes the claim is never the claim's own block, struck or not.
    if (isCorrectionLine({ block, correction })) {
      return false;
    }
    const hit = isRecord(block) ? strikeBlock({ block, wrong }) : undefined;
    if (hit === undefined || !hit.alreadyStruck) {
      return false;
    }
    return isCorrectionLine({ block: blocks[index + 1], correction });
  });
}

/**
 * A block list with the claim struck and the Correction block directly under it, or unchanged.
 *
 * @returns the rewritten blocks, and where the strike landed when one did
 */
export function correctBlocks({
  blocks,
  correction,
  wrong,
}: {
  blocks: readonly unknown[];
  correction: string;
  wrong: string;
}): {
  readonly blocks: readonly unknown[];
  readonly struck?: { alreadyStruck: boolean; kind: "rich-text" | "mrkdwn" };
} {
  const out: unknown[] = [];
  let struck: { alreadyStruck: boolean; kind: "rich-text" | "mrkdwn" } | undefined;
  for (const block of blocks) {
    const hit = isRecord(block) ? strikeBlock({ block, wrong }) : undefined;
    if (hit === undefined) {
      out.push(block);
      continue;
    }
    out.push(hit.block, correctionBlock({ correction }));
    struck = { alreadyStruck: hit.alreadyStruck, kind: hit.block["type"] === "rich_text" ? "rich-text" : "mrkdwn" };
  }
  return struck === undefined ? { blocks: out } : { blocks: out, struck };
}
