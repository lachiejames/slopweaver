/**
 * A message someone ELSE wrote, as lines — the conversation a draft lands in: its blocks or its mrkdwn text, and each
 * attachment under a quote bar.
 */
import { type Bag, bags, str, sub } from "../../lib/bag";
import { slackUnescaped } from "../../lib/slackEscapes";
import { blockLines, plainRuns } from "./readSlackDraftsBlocks";
import { buttonLine, linkRun, textLines } from "./readSlackDraftsMrkdwn";
import { type DraftLine, type DraftRun } from "./readSlackDraftsRuns";

/**
 * A message someone ELSE wrote, as lines — the conversation a draft lands in (`./readDraftContext.ts`).
 *
 * Unlike a draft's payload, which this module refuses whole when any part will not read, a message in the
 * conversation takes the best of what Slack gave for it: its `rich_text` blocks when every block is one this
 * reader draws, else its mrkdwn `text` — Slack's own rendering of the same message. Each attachment follows
 * under a quote bar, as Slack draws a forwarded message or an app card below the words: its `text`, else its
 * `fallback`. One app's unfamiliar block must not blank the whole conversation above the owner's draft, and what is
 * drawn instead is still Slack's words, never a paraphrase.
 *
 * @param blocks the message's Block Kit, verbatim
 * @param attachments its legacy attachments — a forwarded message, an app card — drawn under the body
 * @returns the lines; empty when Slack gave nothing drawable, which the card says in words
 */
export function messageLines({
  blocks,
  text,
  attachments,
}: {
  blocks: readonly Bag[];
  text: string;
  attachments: readonly Bag[];
}): readonly DraftLine[] {
  const lines: DraftLine[] = [...bodyLines({ blocks, text })];
  for (const attachment of attachments) {
    lines.push(...attachmentLines({ attachment, bodyText: text }));
  }
  return lines;
}

/** Whether a string field is present and says something. */
function said(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * One attachment as Slack draws it under the message, behind a quote bar: whose words they are (a forwarded
 * message's or unfurled permalink's `author_name`), the `pretext` and bold `title` an app card leads with,
 * then its `text` and its Block Kit — the bot's own answers keep every word there — else its `fallback`,
 * unless that only repeats the message's own text. A title link and a url button are links. A block, the
 * `fields`, a forwarded message's files or a picture this reader does not draw is named, never dropped silently.
 */
function attachmentLines({ attachment, bodyText }: { attachment: Bag; bodyText: string }): readonly DraftLine[] {
  const lines: DraftLine[] = [];
  const quoted = ({ runs }: { runs: readonly DraftRun[] }): DraftLine => ({ frame: "quote", marker: undefined, runs });
  const bold = ({ words }: { words: string }): DraftRun => ({
    bold: true,
    code: false,
    italic: false,
    kind: "text",
    text: slackUnescaped({ text: words }),
  });
  const author = str({ bag: attachment, key: "author_name" });
  const pretext = str({ bag: attachment, key: "pretext" });
  const title = str({ bag: attachment, key: "title" });
  const words = str({ bag: attachment, key: "text" });
  const fallback = str({ bag: attachment, key: "fallback" });
  const fields = bags({ bag: attachment, key: "fields" });
  const blocks = bags({ bag: attachment, key: "blocks" });
  const actions = bags({ bag: attachment, key: "actions" });
  const files = bags({ bag: attachment, key: "files" });
  const picture = said(str({ bag: attachment, key: "image_url" })) || said(str({ bag: attachment, key: "thumb_url" }));
  if (said(author)) {
    lines.push(quoted({ runs: [bold({ words: author })] }));
  }
  if (said(pretext)) {
    lines.push(...textLines({ frame: "quote", text: pretext }));
  }
  if (said(title)) {
    lines.push(
      quoted({ runs: [linkRun({ bold: true, label: title, url: str({ bag: attachment, key: "title_link" }) })] }),
    );
  }
  if (said(words)) {
    lines.push(...textLines({ frame: "quote", text: words }));
  }
  if (blocks !== undefined && blocks.length > 0) {
    lines.push(...foreignBlocksLines({ blocks, frame: "quote" }).lines);
  }
  if (lines.length === 0 && said(fallback) && fallback.trim() !== bodyText.trim()) {
    lines.push(...textLines({ frame: "quote", text: fallback }));
  }
  if (actions !== undefined) {
    lines.push(...buttonLine({ buttons: actions, frame: "quote" }));
  }
  if (fields !== undefined && fields.length > 0) {
    lines.push(notDrawnLine({ frame: "quote", what: counted({ count: fields.length, noun: "field" }) }));
  }
  if (files !== undefined && files.length > 0) {
    lines.push(notDrawnLine({ frame: "quote", what: counted({ count: files.length, noun: "file" }) }));
  }
  if (picture) {
    lines.push(notDrawnLine({ frame: "quote", what: "a picture" }));
  }
  return lines;
}

/** `1 field`, `2 fields`. */
function counted({ count, noun }: { count: number; noun: string }): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** One Block Kit text object's words: mrkdwn read as Slack reads it, plain text as it stands. */
function textObjectLines({ object }: { object: Bag }): readonly DraftLine[] | undefined {
  const type = str({ bag: object, key: "type" });
  const text = str({ bag: object, key: "text" });
  if (text === undefined || (type !== "mrkdwn" && type !== "plain_text")) {
    return undefined;
  }
  if (type === "plain_text") {
    return [{ frame: undefined, marker: undefined, runs: plainRuns({ text }) }];
  }
  return textLines({ frame: undefined, text });
}

/**
 * One block of a message someone else wrote, as lines: `rich_text`, a `section`'s text and fields, a `header`
 * in bold, a `context` line (its avatars left out), a divider as nothing, and a url button — in an `actions`
 * row or beside a section — as the link it is. A section's picture is named, not dropped. Any other block, or
 * a text object this cannot read, is `undefined`, which the caller says out loud rather than drawing a message
 * short.
 */
function foreignBlockLines({ block }: { block: Bag }): readonly DraftLine[] | undefined {
  const type = str({ bag: block, key: "type" });
  if (type === "rich_text") {
    return blockLines({ block });
  }
  if (type === "divider") {
    return [];
  }
  if (type === "actions") {
    const elements = bags({ bag: block, key: "elements" });
    if (elements === undefined) {
      return undefined;
    }
    return buttonLine({ buttons: elements, frame: undefined });
  }
  const text = sub({ bag: block, key: "text" });
  if (type === "header") {
    const words = text === undefined ? undefined : str({ bag: text, key: "text" });
    if (words === undefined) {
      return undefined;
    }
    return [
      {
        frame: undefined,
        marker: undefined,
        runs: [{ bold: true, code: false, italic: false, kind: "text", text: words }],
      },
    ];
  }
  const parts: Bag[] = [];
  if (type === "section") {
    const fields = bags({ bag: block, key: "fields" });
    if (text !== undefined) {
      parts.push(text);
    }
    if (fields !== undefined) {
      parts.push(...fields);
    }
  } else if (type === "context") {
    const elements = bags({ bag: block, key: "elements" });
    if (elements === undefined) {
      return undefined;
    }
    parts.push(...elements.filter((element) => str({ bag: element, key: "type" }) !== "image"));
  } else {
    return undefined;
  }
  const lines: DraftLine[] = [];
  for (const part of parts) {
    const read = textObjectLines({ object: part });
    if (read === undefined) {
      return undefined;
    }
    lines.push(...read);
  }
  const accessory = sub({ bag: block, key: "accessory" });
  if (type === "section" && accessory !== undefined) {
    const kind = str({ bag: accessory, key: "type" });
    if (kind === "image") {
      lines.push(notDrawnLine({ frame: undefined, what: "a picture" }));
    } else if (kind === "button") {
      lines.push(...buttonLine({ buttons: [accessory], frame: undefined }));
    }
  }
  return lines;
}

/** The note drawn where a block this reader cannot draw sat, so a message is never mistaken for all of it. */
function notDrawnLine({ frame, what }: { frame: DraftLine["frame"]; what: string }): DraftLine {
  const note = `${what} not drawn here, open it in Slack`;
  return { frame, marker: undefined, runs: [{ bold: false, code: false, italic: true, kind: "text", text: note }] };
}

/**
 * Blocks as lines, each one this reader can draw in place and a note for each it cannot, so a block Slack
 * draws is never silently missing from the card.
 */
function foreignBlocksLines({ blocks, frame }: { blocks: readonly Bag[]; frame: DraftLine["frame"] }): {
  readonly lines: readonly DraftLine[];
  readonly undrawn: number;
} {
  const lines: DraftLine[] = [];
  let undrawn = 0;
  for (const block of blocks) {
    const read = foreignBlockLines({ block });
    if (read === undefined) {
      undrawn += 1;
      lines.push(notDrawnLine({ frame, what: `the ${String(str({ bag: block, key: "type" }))} block` }));
    } else {
      lines.push(...read.map((line) => ({ ...line, frame: line.frame ?? frame })));
    }
  }
  return { lines, undrawn };
}

/**
 * A message's own words: its blocks when every one of them reads, else its mrkdwn `text` — Slack's own summary
 * of the same message — with each block that could not be drawn named, never dropped silently.
 */
function bodyLines({ blocks, text }: { blocks: readonly Bag[]; text: string }): readonly DraftLine[] {
  if (blocks.length === 0) {
    return textLines({ frame: undefined, text });
  }
  const read = foreignBlocksLines({ blocks, frame: undefined });
  if (read.undrawn === 0) {
    return read.lines;
  }
  const summary = textLines({ frame: undefined, text });
  if (summary.length === 0) {
    return read.lines;
  }
  return [...summary, notDrawnLine({ frame: undefined, what: "the message's own layout" })];
}
