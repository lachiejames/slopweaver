/**
 * The links a reader can SEE on a rendered Slack message, read along Slack's documented message, attachment and block
 * structure. Split from `./draftReceipts.ts`, whose `receiptLinks` reads every link a payload carries for the receipt
 * bar; a finding's proof (`./findingProof.ts`) owes a link the reader is actually shown.
 *
 * Pure: no network, no clock, no filesystem.
 */
import { isRecord } from "../../lib/parsers.js";

/** A link a reader can open: an http(s) URL. */
const URL_PREFIX = /^https?:\/\//iu;

/**
 * Every distinct link a reader can SEE on the rendered message: the same two shapes as `./draftReceipts.ts`'s `receiptLinks`, read only
 * through the fields Slack draws (message and attachment text, blocks, their elements, fields and accessory, a title
 * link). A link parked in metadata nobody is shown, a `block_id` or a notification `fallback`, is no link to the
 * reader, so a finding's proof never rests on one. Nor is the message's own `text` once it has blocks: Slack
 * draws the blocks and keeps `text` for the notification, the same precedence `./findingProof.ts`'s first line reads.
 *
 * @param payload the exact bytes a release would post
 * @returns the visible links
 */
export function renderedReceiptLinks({ payload }: { payload: unknown }): readonly string[] {
  const seen = new Set<string>();
  if (!isRecord(payload)) {
    return [];
  }
  const blocks = arrayOf({ value: payload["blocks"] });
  if (blocks.length === 0) {
    linksInText({ seen, value: payload["text"] });
  }
  for (const block of blocks) {
    walkBlock({ seen, value: block });
  }
  for (const attachment of arrayOf({ value: payload["attachments"] })) {
    walkAttachment({ seen, value: attachment });
  }
  return [...seen];
}

/** A JSON value as an array, or none when it is not one. */
function arrayOf({ value }: { value: unknown }): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A `<url>` or `<url|label>` with its label captured, so a blank one can be told apart from none. */
const SLACK_LINK_LABELLED = /<(https?:\/\/[^|>\s]+)(?:\|([^>]*))?>/giu;

/**
 * Collect the `<url|label>` links in one string into `seen`; anything but a string carries none. A link whose label is
 * blank draws nothing to click, so it is no link to the reader.
 */
function linksInText({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (typeof value !== "string") {
    return;
  }
  // A token inside a code span or block is drawn as code, never a link.
  const prose = value.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`\n]*`/gu, " ");
  for (const match of prose.matchAll(SLACK_LINK_LABELLED)) {
    // A bare `<url>` has no label and shows its address; only a label that is there and blank draws nothing.
    if (match[2] === undefined || !visiblyBlank({ text: match[2] })) {
      seen.add(match[1]!);
    }
  }
}

/**
 * Whether a label draws nothing a reader can see or click: only whitespace and default-ignorable code points (a zero
 * width space, a joiner, a direction mark), which `trim()` alone leaves in place.
 */
function visiblyBlank({ text }: { text: string }): boolean {
  return text.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, "") === "";
}

/** Collect one absolute url into `seen` when the value is one. */
function addUrl({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (typeof value === "string" && URL_PREFIX.test(value)) {
    seen.add(value);
  }
}

/**
 * One attachment as Slack draws it: `<url>` tokens in its text, pretext and legacy fields' values where its `mrkdwn_in`
 * names them, a `title_link` only
 * under a title that is not blank, and its blocks. A title, its own or a field's, is plain text, so a token typed in one
 * is drawn as characters, not a link. Nothing else on it reaches the reader, the notification `fallback`
 * included.
 */
function walkAttachment({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (!isRecord(value)) {
    return;
  }
  // A legacy attachment formats only the fields its `mrkdwn_in` names; read a token anywhere else as characters.
  const formatted = arrayOf({ value: value["mrkdwn_in"] });
  for (const key of ["text", "pretext"] as const) {
    if (formatted.includes(key)) {
      linksInText({ seen, value: value[key] });
    }
  }
  const { title } = value;
  if (typeof title === "string" && !visiblyBlank({ text: title })) {
    addUrl({ seen, value: value["title_link"] });
  }
  for (const field of formatted.includes("fields") ? arrayOf({ value: value["fields"] }) : []) {
    if (isRecord(field)) {
      linksInText({ seen, value: field["value"] });
    }
  }
  for (const block of arrayOf({ value: value["blocks"] })) {
    walkBlock({ seen, value: block });
  }
}

/**
 * One block as Slack draws it, read only along the fields its documented TYPE draws: a section's text,
 * fields and accessory, a context's elements, an actions block's elements and a rich text block's sections. A key a
 * type does not draw (an `accessory` on a rich text block, a `url` on a section, a `block_id`, nested `blocks`) and a
 * block of any other type carry no link the reader sees.
 */
function walkBlock({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (!isRecord(value)) {
    return;
  }
  switch (value["type"]) {
    case "section":
      walkTextObject({ seen, value: value["text"] });
      for (const field of arrayOf({ value: value["fields"] })) {
        walkTextObject({ seen, value: field });
      }
      walkButton({ seen, value: value["accessory"] });
      return;
    case "context":
      for (const element of arrayOf({ value: value["elements"] })) {
        walkTextObject({ seen, value: element });
      }
      return;
    case "actions":
      for (const element of arrayOf({ value: value["elements"] })) {
        walkButton({ seen, value: element });
      }
      return;
    case "rich_text":
      for (const element of arrayOf({ value: value["elements"] })) {
        walkRichContainer({ seen, value: element });
      }
      return;
    default:
      return;
  }
}

/**
 * A text object's `<url>` tokens, read only when it is `mrkdwn`: a `plain_text` object draws a token as literal
 * characters.
 */
function walkTextObject({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (isRecord(value) && value["type"] === "mrkdwn") {
    linksInText({ seen, value: value["text"] });
  }
}

/**
 * A button's `url`, drawn as a link only on a button Slack's documented structure draws — an `action_id` and a
 * `plain_text` label — and only under a label the reader can see. No renderer here emits a button, so this
 * reads only a hand-written row, and one short of that structure is no link.
 */
function walkButton({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (!isRecord(value) || value["type"] !== "button" || !isRecord(value["text"])) {
    return;
  }
  const actionId = value["action_id"];
  if (typeof actionId !== "string" || actionId === "" || value["text"]["type"] !== "plain_text") {
    return;
  }
  const label = value["text"]["text"];
  if (typeof label === "string" && !visiblyBlank({ text: label })) {
    addUrl({ seen, value: value["url"] });
  }
}

/** The rich text containers whose elements are runs Slack draws inline. */
const RICH_RUN_CONTAINERS = ["rich_text_section", "rich_text_quote", "rich_text_preformatted"] as const;

/** A rich text block element: a section, quote or preformatted run of inline elements, or a list of sections. */
function walkRichContainer({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (!isRecord(value)) {
    return;
  }
  if (value["type"] === "rich_text_list") {
    for (const section of arrayOf({ value: value["elements"] })) {
      walkRichContainer({ seen, value: section });
    }
    return;
  }
  if (!RICH_RUN_CONTAINERS.some((type) => type === value["type"])) {
    return;
  }
  for (const run of arrayOf({ value: value["elements"] })) {
    walkRichLink({ seen, value: run });
  }
}

/**
 * A rich text `link` run's `url`. It shows its address when it has no label, draws nothing to click under a blank one,
 * and draws its label as plain text when styled `unlink`; a `text` run, code-styled or not, draws a `<url>`
 * token as literal characters.
 */
function walkRichLink({ seen, value }: { seen: Set<string>; value: unknown }): void {
  if (!isRecord(value) || value["type"] !== "link") {
    return;
  }
  const { style, text } = value;
  const labelBlank = typeof text === "string" && visiblyBlank({ text });
  const unlinked = isRecord(style) && style["unlink"] === true;
  if (!labelBlank && !unlinked) {
    addUrl({ seen, value: value["url"] });
  }
}
