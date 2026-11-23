/**
 * The first line a reader meets in a rendered finding, read off the exact bytes a release would post: a message's drawn
 * blocks, else a card's tldr where its lead opens on it, else its text. Split from `./findingProof.ts`, whose
 * first-line count check is its one caller.
 */
import type { KnownBlock } from "@slack/types";

import { isRecord } from "#lib/parsers.js";

import { previewBlockLines } from "./preview.js";
import { PRIMARY_LINK_GLYPH } from "./render.js";

/**
 * The first line a reader meets in a rendered payload: a card's notification fallback (its `tldr`), else the first
 * line of the message text. Read off the rendered bytes, which are what the owner's approval binds, so one reader serves every
 * form kind.
 *
 * @param payload the exact bytes a release would post
 * @returns the first line, or `undefined` when the payload carries no text at all
 */
export function findingFirstLine({ payload }: { payload: unknown }): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const { attachments, blocks, text } = payload;
  if (Array.isArray(blocks) && blocks.length > 0) {
    return firstDrawnLine({ blocks });
  }
  if (Array.isArray(attachments)) {
    const [card] = attachments;
    if (isRecord(card) && typeof card["fallback"] === "string") {
      return cardFirstLine({ blocks: card["blocks"], fallback: card["fallback"] });
    }
  }
  return typeof text === "string" ? firstLineOf({ text }) : undefined;
}

/**
 * A card's first line: its `fallback`'s, which the card renderer sets from the tldr its lead draws — but only when the
 * card's blocks draw that line WHERE the renderer draws it, opening the lead. A fallback is the notification, so one
 * its blocks never show, or show only further down, is no first line, and the card reads as the first line
 * its blocks draw instead: the author row, which carries no count, so it fails closed.
 */
function cardFirstLine({ blocks, fallback }: { blocks: unknown; fallback: string }): string | undefined {
  const drawnBlocks = Array.isArray(blocks) ? blocks : [];
  const tldr = firstLineOf({ text: fallback }).trim();
  if (tldr !== "" && leadOpeningLine({ blocks: drawnBlocks }) === tldr) {
    return tldr;
  }
  return firstDrawnLine({ blocks: drawnBlocks });
}

/**
 * The line a card's lead opens on, read in the card renderer's own frame (`render.ts`): an author `context` row, a
 * `divider`, then a `rich_text` lead whose first section opens on the tldr, or on the primary link and then the tldr.
 * Any other shape (a day-one intro above the tldr included) is not that frame, so it opens on nothing here.
 */
function leadOpeningLine({ blocks }: { blocks: readonly unknown[] }): string | undefined {
  const [author, divider, lead] = blocks;
  const framed =
    isRecord(author) &&
    author["type"] === "context" &&
    isRecord(divider) &&
    divider["type"] === "divider" &&
    isRecord(lead) &&
    lead["type"] === "rich_text";
  if (!framed || !Array.isArray(lead["elements"])) {
    return undefined;
  }
  const [section]: readonly unknown[] = lead["elements"];
  if (!isRecord(section) || section["type"] !== "rich_text_section" || !Array.isArray(section["elements"])) {
    return undefined;
  }
  const [first, second, third]: readonly unknown[] = section["elements"];
  const linked = textRun({ run: first }) === PRIMARY_LINK_GLYPH && isRecord(second) && second["type"] === "link";
  const opening = linked ? textRun({ run: third }) : textRun({ run: first });
  if (opening === undefined) {
    return undefined;
  }
  return firstLineOf({ text: opening.replace(/^[\n\r]+/u, "") }).trim();
}

/** A rich text `text` run's string, or `undefined` for any other element. */
function textRun({ run }: { run: unknown }): string | undefined {
  if (!isRecord(run) || run["type"] !== "text" || typeof run["text"] !== "string") {
    return undefined;
  }
  return run["text"];
}

/**
 * The first non-blank line a message's own blocks draw, through the poster's preview renderer. Where a message has
 * blocks Slack draws them and its `text` is only the notification, so a count in that `text` alone is no count the
 * reader sees. A block the renderer only names (`[section block]`) carries no count, so it fails closed.
 */
function firstDrawnLine({ blocks }: { blocks: readonly unknown[] }): string | undefined {
  for (const block of blocks) {
    if (!isTypedBlock(block)) {
      continue;
    }
    const drawn = drawnLinesOf({ block })
      .map((line) => firstLineOf({ text: line }))
      .find((line) => line.trim() !== "");
    if (drawn !== undefined) {
      return drawn;
    }
  }
  return undefined;
}

/**
 * Whether a stored value has the one field every Block Kit block carries, its `type`. That is all the renderer
 * dispatches on; a block whose other fields are malformed is caught by {@link drawnLinesOf}.
 */
function isTypedBlock(value: unknown): value is KnownBlock {
  return isRecord(value) && typeof value["type"] === "string";
}

/**
 * The lines the preview renderer draws for one block. The renderer is typed for well-formed Block Kit and a stored
 * payload is only as well formed as its register line, so a block it cannot draw draws nothing here: the finding
 * then reads as missing its first-line count, which refuses rather than passes.
 */
function drawnLinesOf({ block }: { block: KnownBlock }): readonly string[] {
  let lines: readonly string[];
  try {
    lines = previewBlockLines({ block });
  } catch {
    return [];
  }
  const addresses = [...addressesIn({ value: block })].toSorted((a, b) => b.length - a.length);
  return lines.map((line) => addresses.reduce((drawn, address) => drawn.split(address).join(DRAWN_ADDRESS), line));
}

/** The address every link is drawn with here: it carries no digit, so it can never be read as a count. */
const DRAWN_ADDRESS = "https://address.invalid";

/**
 * Every `url` a block carries, at any depth. The preview spells a link `[label](url)` and a reader sees only the
 * label, so each is swapped for {@link DRAWN_ADDRESS} in the drawn line: an address holding a `)` would otherwise end
 * that spelling early and leave its tail, digits included, in the line the count is read from. Longest
 * first, so an address that contains another is swapped whole.
 */
function addressesIn({ value }: { value: unknown }): ReadonlySet<string> {
  if (Array.isArray(value)) {
    return new Set(value.flatMap((item: unknown) => [...addressesIn({ value: item })]));
  }
  if (!isRecord(value)) {
    return new Set();
  }
  return new Set(
    Object.entries(value).flatMap(([key, field]) => {
      if (key === "url" && typeof field === "string" && field !== "") {
        return [field];
      }
      return [...addressesIn({ value: field })];
    }),
  );
}

/**
 * The text before the first line break of any kind: `\n`, `\r`, and the Unicode line and paragraph separators a
 * reader also sees as a new line (U+2028, U+2029), so a count pushed past one is not read as first-line.
 */
function firstLineOf({ text }: { text: string }): string {
  // `split` always answers at least one element, the whole string when no separator is in it.
  return text.split(/[\n\r\u2028\u2029]/u)[0]!;
}
