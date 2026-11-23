/**
 * A parked draft's payload as lines: its `rich_text` blocks, a bot card's wrapper, or the plain escape hatch's bytes.
 */
import { type Bag, bags, num, str } from "../../lib/bag";
import { type DraftLine, type DraftRun, sectionRuns } from "./readSlackDraftsRuns";

/** The two block elements that hold inline runs like a section but draw a box around them. */
const FRAMES: ReadonlyMap<string | undefined, "quote" | "code"> = new Map([
  ["rich_text_quote", "quote"],
  ["rich_text_preformatted", "code"],
]);

/** The glyph Slack draws for a bullet at each nesting depth, cycling past the third. */
const BULLET_GLYPHS = ["•", "◦", "▪"] as const;

/**
 * Every line of one `rich_text` block, or `undefined` when any part of it is unreadable.
 *
 * @returns every line, or undefined when any part is unreadable
 */
export function blockLines({ block }: { block: Bag }): readonly DraftLine[] | undefined {
  const elements = bags({ bag: block, key: "elements" });
  if (str({ bag: block, key: "type" }) !== "rich_text" || elements === undefined) {
    return undefined;
  }
  const lines: DraftLine[] = [];
  for (const element of elements) {
    const type = str({ bag: element, key: "type" });
    const frame = FRAMES.get(type);
    if (type === "rich_text_section" || frame !== undefined) {
      const runs = sectionRuns({ section: element });
      if (runs === undefined) {
        return undefined;
      }
      lines.push({ frame, marker: undefined, runs });
      continue;
    }
    if (type !== "rich_text_list") {
      return undefined;
    }
    const items = bags({ bag: element, key: "elements" });
    if (items === undefined) {
      return undefined;
    }
    const style = str({ bag: element, key: "style" });
    if (style !== "bullet" && style !== "ordered") {
      return undefined;
    }
    const ordered = style === "ordered";
    // A list resumed after a nested one is a new list carrying where it resumes from, as Slack numbers it.
    const offset = element["offset"] === undefined ? 0 : num({ bag: element, key: "offset" });
    // A nested list is a sibling list one `indent` in, which Slack draws further in with the next glyph.
    const indent = element["indent"] === undefined ? 0 : num({ bag: element, key: "indent" });
    if (offset === undefined || indent === undefined || !Number.isSafeInteger(indent) || indent < 0) {
      return undefined;
    }
    const glyph = BULLET_GLYPHS[indent % BULLET_GLYPHS.length];
    for (const [index, item] of items.entries()) {
      if (str({ bag: item, key: "type" }) !== "rich_text_section") {
        return undefined;
      }
      const runs = sectionRuns({ section: item });
      if (runs === undefined) {
        return undefined;
      }
      const marker = ordered ? `${String(offset + index + 1)}.` : glyph;
      lines.push({ frame: undefined, marker, runs, ...(indent === 0 ? {} : { indent }) });
    }
  }
  return lines;
}

/**
 * One block of a bot card's wrapper as lines: its `rich_text` as any other, a `context` block's mrkdwn as one plain
 * line each, and a divider as nothing — the three kinds the card renderer writes (`src/outbound/slack/render.ts`).
 * Anything else is `undefined`, which refuses the reading like any other unreadable part.
 */
function cardBlockLines({ block }: { block: Bag }): readonly DraftLine[] | undefined {
  const type = str({ bag: block, key: "type" });
  if (type === "rich_text") {
    return blockLines({ block });
  }
  if (type === "divider") {
    return [];
  }
  const elements = bags({ bag: block, key: "elements" });
  if (type !== "context" || elements === undefined) {
    return undefined;
  }
  const lines: DraftLine[] = [];
  for (const element of elements) {
    const text = str({ bag: element, key: "text" });
    if (str({ bag: element, key: "type" }) !== "mrkdwn" || text === undefined) {
      return undefined;
    }
    lines.push({ frame: undefined, marker: undefined, runs: plainRuns({ text }) });
  }
  return lines;
}

/**
 * A bot card's lines, off the one wrapper in its `attachments` — where a `slack draft record --as bot` row keeps its
 * words, since the card's own `text` is empty. `undefined` for a row that is not one card or has an unreadable block.
 */
function cardLines({ payload }: { payload: Bag }): readonly DraftLine[] | undefined {
  const wrappers = bags({ bag: payload, key: "attachments" });
  const wrapper = wrappers?.[0];
  const blocks = wrapper === undefined ? undefined : bags({ bag: wrapper, key: "blocks" });
  if (wrappers?.length !== 1 || blocks === undefined) {
    return undefined;
  }
  const lines: DraftLine[] = [];
  for (const block of blocks) {
    const read = cardBlockLines({ block });
    if (read === undefined) {
      return undefined;
    }
    lines.push(...read);
  }
  return lines;
}

/**
 * The whole message's lines, off the payload the register recorded.
 *
 * @returns the message lines, or undefined when the payload is unreadable
 */
export function payloadLines({ payload }: { payload: Bag }): readonly DraftLine[] | undefined {
  if (payload["attachments"] !== undefined) {
    return cardLines({ payload });
  }
  const blocks = bags({ bag: payload, key: "blocks" });
  if (payload["blocks"] !== undefined && blocks === undefined) {
    return undefined;
  }
  if (blocks === undefined) {
    // The `plain` escape hatch carries no blocks, only its own bytes. Each of its lines is a paragraph, and an
    // empty one is a blank line the card draws — except after the last word, where Slack draws nothing, so a
    // trailing newline is not a line at all.
    const text = str({ bag: payload, key: "text" });
    if (text === undefined) {
      return undefined;
    }
    return text
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => ({ frame: undefined, marker: undefined, runs: plainRuns({ text: line }) }));
  }
  const lines: DraftLine[] = [];
  for (const block of blocks) {
    const read = blockLines({ block });
    if (read === undefined) {
      return undefined;
    }
    lines.push(...read);
  }
  return lines;
}

/** A user mention in mrkdwn text, which Slack draws as a chip even in a plain message. */
const PLAIN_USER_MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/**
 * One plain line's runs: its text verbatim, with each `<@U…>` lifted out as the user run Slack would draw.
 * Nothing else in plain text is interpreted — a literal `*` stays a literal `*`.
 *
 * @returns the line's text and user-mention runs
 */
export function plainRuns({ text }: { text: string }): readonly DraftRun[] {
  const runs: DraftRun[] = [];
  let at = 0;
  for (const match of text.matchAll(PLAIN_USER_MENTION)) {
    const userId = match.at(1);
    if (userId === undefined) {
      continue;
    }
    if (match.index > at) {
      runs.push(asText({ text: text.slice(at, match.index) }));
    }
    runs.push({ kind: "user", userId });
    at = match.index + match[0].length;
  }
  if (at < text.length || runs.length === 0) {
    runs.push(asText({ text: text.slice(at) }));
  }
  return runs;
}

/** One plain string as an unstyled run. */
function asText({ text }: { text: string }): DraftRun {
  return { bold: false, code: false, italic: false, kind: "text", text };
}
