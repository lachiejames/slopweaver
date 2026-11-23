/**
 * What a parked as-me draft must carry for the queue card to draw it exactly as Slack will — checked before the
 * draft is parked, so a card the owner opens never shows them less than the room will see.
 *
 * A card with no citations, or images the reader cannot identify, cannot be judged: what the owner sees must look
 * the same as it would in Slack. Two things a card cannot make faithful by drawing harder, so the form refuses them:
 *
 * - **A bare citation marker.** `[2]`, `[1, 2]`, `[1-3]` or `[^1]` in prose reads as a source and resolves to
 *   nothing — in Slack it is the literal characters, with no link behind them. A citation is a link whose label
 *   is the words a reader clicks. A code run or a preformatted block is not prose, so `items[0]` there is left.
 * - **An attachment the card would not draw as what it is.** The card picks picture, video or file card by the
 *   NAME (`site/lib/slackDraftLayout.ts`, `drawnAs`) and serves the bytes only when they open as one of the
 *   pictures or videos a browser draws inline (`site/lib/draftMediaServe.ts`, `inlineMediaTypeOf`). So an
 *   attachment is refused unless the two agree: bytes a browser draws, under a name that draws them, and a
 *   name that promises no picture over bytes that are one — and a TIFF under any name, since admission decodes
 *   it as a picture and no browser draws one. A signature alone proves nothing — admission carries text that
 *   happens to open `GIF89a` or `BM` as a text document — so bytes that open like a picture must also be ones
 *   admission decoded, and a video one it identified by its whole `ftyp` box (`attachmentKindOf`), as review
 *   showed with five such files. The signature table below restates the route's,
 *   because `src/` cannot import the console; `draftFidelity.test.ts` holds the two to the same inputs. An
 *   ALLOWLIST, not a TIFF denylist: a fallback review showed a BigTIFF header (`MM\0+`) over a
 *   classic body passing admission, passing a two-signature denylist, and drawing as a broken picture.
 *
 * Pure: the payload and the admitted bytes in, the problems out, in the order met.
 */

import { isRecord } from "../../lib/parsers.js";
import { attachmentKindOf } from "../../visualEvidence/attachmentKind.js";
import type { SlackDripMessagePayload } from "./types.js";

/** One reason the card could not draw a draft as Slack will. */
export interface DraftFidelityProblem {
  readonly code: "BARE_CITATION" | "UNDRAWABLE_ATTACHMENT";
  readonly message: string;
}

/**
 * `[1]`, `[ 1 ]`, `[1, 2]`, `[1; 2]`, `[1-3]`, `[1—3]`, `[^1]`, `[^note]`, `【1】`, `［１］` and a plain draft's
 * mrkdwn-styled `[*2*]` — a citation marker standing where a linked label belongs. A bracketed word (`[draft]`)
 * and a four-digit year are not one. Spacing and mrkdwn styling share ONE character class on each side, and a
 * footnote name, whose `\w` already takes `_`, closes without it, so no two quantifiers can split the same run (the
 * `redos-check` gate).
 */
const BARE_CITATION =
  /[[【［][\s*_~]*(?:\^[\w-]+[\s*~]*|[0-9０-９]{1,3}(?:[:：][0-9０-９]{1,3})?(?:\s*[,;–—-]\s*[0-9０-９]{1,3})*[\s*_~]*)[\]】］]/u;

/**
 * Any bracketed token carrying a dagger — Codex's `【F:README.md†L5-L14】` and `【a1b2c3†L1-L4】`, a model's
 * file-search `【4:0†source】` and `[1†source]` among them. A `†` inside brackets is a tool's citation syntax and
 * never prose, so the shape before it is not enumerated.
 */
const DAGGER_CITATION = /[[【［][^\]】］\n]{1,200}†[^\]】］\n]*[\]】］]/u;

/** A fenced or inline code span in plain mrkdwn — Slack draws its contents literally, as code. */
const PLAIN_CODE = /```[\s\S]*?```|`[^`\n]*`/gu;

/** How the card draws one attachment. */
type Drawn = "image" | "video" | "file";

/** Each kind as a message names it. */
const A_DRAWN: Readonly<Record<Drawn, string>> = { file: "a file", image: "an image", video: "a video" };

/** Leading bytes → what a browser draws inline, matched at offset 0 — the route's own table. */
const INLINE_SIGNATURES: readonly { readonly drawn: Drawn; readonly magic: readonly number[] }[] = [
  { drawn: "image", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { drawn: "image", magic: [0xff, 0xd8, 0xff] },
  { drawn: "image", magic: [0x47, 0x49, 0x46, 0x38] },
  { drawn: "image", magic: [0x42, 0x4d] },
];

/** The four characters at `at`, as a RIFF or ISO-BMFF box field. */
function fourCc({ bytes, at }: { bytes: Uint8Array; at: number }): string {
  return String.fromCodePoint(...bytes.subarray(at, at + 4));
}

/** What the route would serve these bytes as, or `"file"` when it serves nothing. */
function drawnByBytes({ bytes }: { bytes: Uint8Array }): Drawn {
  const opens = INLINE_SIGNATURES.find(({ magic }) => magic.every((byte, at) => bytes[at] === byte));
  if (opens !== undefined) {
    return opens.drawn;
  }
  if (fourCc({ at: 0, bytes }) === "RIFF" && fourCc({ at: 8, bytes }) === "WEBP") {
    return "image";
  }
  if (fourCc({ at: 4, bytes }) === "ftyp") {
    return "video";
  }
  return "file";
}

/** What the card draws by the name — `drawnAs` in `site/lib/slackDraftLayout.ts`. */
function drawnByName({ name }: { name: string }): Drawn {
  if (/\.(?:png|jpe?g|gif|webp|bmp)$/iu.test(name)) {
    return "image";
  }
  if (/\.(?:mp4|mov|m4v)$/iu.test(name)) {
    return "video";
  }
  return "file";
}

/** Whether one rich-text element is a run a reader sees inline — a text run or a link's label. */
function isInlineRun(element: unknown): element is Record<string, unknown> & { text: string } {
  return (
    isRecord(element) &&
    (element["type"] === "text" || element["type"] === "link") &&
    typeof element["text"] === "string"
  );
}

/** Whether an inline run is styled as code, which Slack draws literally rather than as prose. */
function isCodeRun({ run }: { run: Record<string, unknown> }): boolean {
  const style = run["style"];
  return isRecord(style) && style["code"] === true;
}

/**
 * Every string a reader of the rendered message sees as prose. Adjacent inline runs of one section are JOINED
 * before they are read, so a marker split across styles (`[`, a bold `2`, `]`) reads as the `[2]` it draws; a
 * code-styled run joins as one space, and a preformatted block is skipped. Walked rather than typed, because a
 * quote or a list nests its sections one level deeper and a missed level is a missed citation.
 */
function proseTexts({ value, into }: { value: unknown; into: string[] }): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      proseTexts({ into, value: item });
    }
    return;
  }
  if (!isRecord(value) || value["type"] === "rich_text_preformatted") {
    return;
  }
  for (const [key, field] of Object.entries(value)) {
    fieldProse({ field, into, key });
  }
}

/** The prose one field of a block contributes — an `elements` run list, a mrkdwn `text`, or anything nested. */
function fieldProse({ key, field, into }: { key: string; field: unknown; into: string[] }): void {
  if (key === "elements" && Array.isArray(field)) {
    elementsProse({ elements: field, into });
    return;
  }
  if (key === "text" && typeof field === "string") {
    // A mrkdwn section's text carries its own backtick code, which Slack draws literally.
    into.push(field.replace(PLAIN_CODE, " "));
    return;
  }
  proseTexts({ into, value: field });
}

/** One `elements` list's prose: each stretch of adjacent inline runs joined into one string, the rest walked. */
function elementsProse({ elements, into }: { elements: readonly unknown[]; into: string[] }): void {
  let joined = "";
  for (const element of elements) {
    if (isInlineRun(element)) {
      joined += isCodeRun({ run: element }) ? " " : element.text;
      continue;
    }
    into.push(joined);
    joined = "";
    proseTexts({ into, value: element });
  }
  into.push(joined);
}

/**
 * A TIFF in any of its four headers — classic and BigTIFF, either byte order. Admission decodes one as a picture,
 * so Slack is taken to show it as one, and no browser draws it: refused whatever it is named.
 */
function isTiff({ bytes }: { bytes: Uint8Array }): boolean {
  const order = fourCc({ at: 0, bytes }).slice(0, 2);
  const version = order === "II" ? bytes[2] : bytes[3];
  const pad = order === "II" ? bytes[3] : bytes[2];
  return (order === "II" || order === "MM") && pad === 0 && (version === 0x2a || version === 0x2b);
}

/** Why one attachment would not draw as Slack draws it, or `undefined` when it would. */
function undrawable({ filename, bytes }: { filename: string; bytes: Uint8Array }): string | undefined {
  if (isTiff({ bytes })) {
    return `${filename} is a TIFF, which the queue card cannot draw inline — attach it as a PNG or JPEG so the card shows the picture Slack will`;
  }
  const byBytes = drawnByBytes({ bytes });
  // A signature is a first-bytes claim, and the route serves on it alone; what admission decided is the proof.
  // A picture is admitted only by decoding, so bytes this door names as a document were never decoded; a video
  // is admitted only as a well-formed ftyp naming a video brand.
  const admittedAs = attachmentKindOf({ bytes, filename });
  const decodedPicture = byBytes === "image" && admittedAs === undefined;
  const provenVideo = byBytes === "video" && admittedAs === "iso-bmff-video";
  if (byBytes !== "file" && !decodedPicture && !provenVideo) {
    return `${filename} opens like ${A_DRAWN[byBytes]} but is not one admission proved — the card would draw a broken ${byBytes} where Slack shows a file; attach the real ${byBytes}`;
  }
  const byName = drawnByName({ name: filename });
  if (byBytes === byName) {
    return undefined;
  }
  if (byName === "file") {
    return `${filename} is ${A_DRAWN[byBytes]} whose name does not say so — the card would draw a file card where Slack shows the ${byBytes}; name it with its own extension`;
  }
  if (byBytes === "file") {
    return `${filename} is named as ${A_DRAWN[byName]} but its bytes are not one a browser draws inline — the card would show a broken ${byName}; attach it as a PNG or JPEG`;
  }
  return `${filename} is named as ${A_DRAWN[byName]} but its bytes are ${A_DRAWN[byBytes]} — name it with its own extension`;
}

/**
 * What stops the card drawing this draft as Slack will.
 *
 * @param payload the exact message the draft would post
 * @param uploads the admitted attachments, bytes and the filename Slack shows
 * @returns every problem, empty when the card can draw it faithfully
 */
export function draftFidelityProblems({
  payload,
  uploads,
}: {
  payload: SlackDripMessagePayload;
  uploads: readonly { readonly filename: string; readonly bytes: Uint8Array }[];
}): readonly DraftFidelityProblem[] {
  const texts: string[] = [];
  if (payload.form === "plain") {
    texts.push(payload.text.replace(PLAIN_CODE, " "));
  } else {
    proseTexts({ into: texts, value: payload.blocks });
  }
  const problems: DraftFidelityProblem[] = [];
  for (const text of texts) {
    const marker = [BARE_CITATION, DAGGER_CITATION]
      .map((pattern) => pattern.exec(text))
      .find((found) => found !== null);
    if (marker !== undefined) {
      problems.push({
        code: "BARE_CITATION",
        message: `"${marker[0]}" is a bare citation marker — Slack shows it as those characters with nothing behind them; write the source as a link whose label is the words a reader clicks`,
      });
    }
  }
  for (const upload of uploads) {
    const why = undrawable({ bytes: upload.bytes, filename: upload.filename });
    if (why !== undefined) {
      problems.push({ code: "UNDRAWABLE_ATTACHMENT", message: why });
    }
  }
  return problems;
}
