/**
 * The words inside a parked draft's attached document, as the queue card shows them — the pure half: which names
 * the card reads as text, how the answer from `/api/draft-media/<sha256>/text` is read, and how much of it the
 * collapsed card shows.
 *
 * The owner cannot react to an attachment whose text they cannot see, and images already draw as Slack
 * previews on the /queue, so other file types do too. A text attachment is shown the way Slack shows an uploaded
 * text file — the card, then the first lines as source, then the whole thing one click away — and the collapsed card always
 * says how much it is NOT showing, so a head is never mistaken for the whole document. Markdown is shown raw and
 * HTML as its source, never rendered: the words are what goes to the room.
 */

import { type Bag, bool, isBag, num, str } from "./bag";

/** How the card previews a file it draws no picture of: its decoded text, a PDF's extracted text, or nothing. */
export type FilePreview = "text" | "pdf";

/** Names whose bytes the card reads as text. */
const TEXT_NAME = /\.(?:md|markdown|txt|csv|json|log|html?)$/iu;

/** A PDF, whose text the card asks `slopweaver pdf read` for. */
const PDF_NAME = /\.pdf$/iu;

/**
 * Whether the card previews this file's words, by the name Slack shows.
 *
 * @param name the attached file's name
 * @returns `text`, `pdf`, or `undefined` for a file shown as its card alone
 */
export function filePreviewOf({ name }: { name: string }): FilePreview | undefined {
  if (TEXT_NAME.test(name)) {
    return "text";
  }
  if (PDF_NAME.test(name)) {
    return "pdf";
  }
  return undefined;
}

/** A reader's name for each previewed type, keyed by lowercase extension. */
const TYPE_NAMES: Readonly<Partial<Record<string, string>>> = {
  csv: "CSV",
  htm: "HTML",
  html: "HTML",
  json: "JSON",
  log: "Plain Text",
  markdown: "Markdown (raw)",
  md: "Markdown (raw)",
  pdf: "PDF",
  txt: "Plain Text",
};

/**
 * The type line a file card carries: a reader's name for the types the card previews, else the extension.
 *
 * @param name the attached file's name
 * @returns the type, or `File` for a name with no extension
 */
export function fileTypeLabel({ name }: { name: string }): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return "File";
  }
  const extension = name.slice(dot + 1).toLowerCase();
  const named = TYPE_NAMES[extension];
  if (named !== undefined) {
    return named;
  }
  return extension.toUpperCase();
}

/**
 * A byte count as a file card shows it: `812 B`, `9.4 KB`, `44 KB`, `3.1 MB`.
 *
 * @param bytes the file's exact size
 * @returns the size, binary units, one decimal below ten
 */
export function fileSizeLabel({ bytes }: { bytes: number }): string {
  const units = ["KB", "MB", "GB"];
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const shown = size < 10 ? size.toFixed(1) : String(Math.round(size));
  return `${shown} ${units[unit]}`;
}

/** What the text route answers for one blob. */
export type DraftMediaText =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "pdf";
      readonly text: string;
      /** Pages the document declares. */
      readonly pages: number;
      /** Pages the extractor read — fewer than {@link pages} when its page cap bit. */
      readonly pagesRead: number;
      /** Pages were read and none carried a glyph: a scan, not a blank document. */
      readonly glyphless: boolean;
    };

/**
 * Read the text route's answer.
 *
 * @param payload the parsed response body
 * @returns the text, or `undefined` when the body is not a whole answer
 */
export function draftMediaTextOf({ payload }: { payload: unknown }): DraftMediaText | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const text = str({ bag: payload, key: "text" });
  if (text === undefined) {
    return undefined;
  }
  const kind = payload["kind"];
  if (kind === "text") {
    return { kind, text };
  }
  if (kind !== "pdf") {
    return undefined;
  }
  return pdfAnswerOf({ payload, text });
}

/**
 * Read what `slopweaver pdf read --json` printed (`src/cli/commands/pdf/core.ts`, `pdfReadReport`) as the PDF answer.
 *
 * @param payload the verb's parsed stdout
 * @returns the answer, or `undefined` when the document is not a whole one
 */
export function pdfReadAnswerOf({
  payload,
}: {
  payload: unknown;
}): Extract<DraftMediaText, { kind: "pdf" }> | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const text = str({ bag: payload, key: "text" });
  if (text === undefined) {
    return undefined;
  }
  return pdfAnswerOf({ payload, text });
}

/** The PDF fields of an answer, once its text has read. */
function pdfAnswerOf({
  payload,
  text,
}: {
  payload: Bag;
  text: string;
}): Extract<DraftMediaText, { kind: "pdf" }> | undefined {
  const pages = num({ bag: payload, key: "pages" });
  const pagesRead = num({ bag: payload, key: "pagesRead" });
  const glyphless = bool({ bag: payload, key: "glyphless" });
  if (pages === undefined || pagesRead === undefined || glyphless === undefined) {
    return undefined;
  }
  return { glyphless, kind: "pdf", pages, pagesRead, text };
}

/** What the card says in place of a document's words, and whether it is a warning. */
export interface Unshown {
  readonly text: string;
  readonly warn: boolean;
}

/**
 * Why the card has no words to show for an answer it did get — never a blank box, which reads as an empty file.
 *
 * The card picks the route by the NAME and the route types the answer by the BYTES, so an answer of the other kind
 * (a `notes.md` whose bytes open `%PDF-`) is refused here rather than shown as words the send would not upload as.
 *
 * @param read the route's answer
 * @param expected what the file's name says it is
 * @returns the sentence, or `undefined` when there are words to show
 */
export function unshownWordsOf({
  read,
  expected,
}: {
  read: DraftMediaText;
  expected: FilePreview;
}): Unshown | undefined {
  if (read.kind !== expected) {
    return {
      text: `could not show this file's text: its bytes are a ${read.kind} file, not what its name says`,
      warn: true,
    };
  }
  if (read.kind === "pdf" && read.glyphless) {
    if (read.pagesRead < read.pages) {
      return {
        text: `the first ${String(read.pagesRead)} of ${String(read.pages)} pages carry no text layer; the rest were not read`,
        warn: true,
      };
    }
    return { text: "this PDF has no text layer: a scan or picture, not a blank document", warn: true };
  }
  if (read.text === "") {
    return { text: "this file is empty", warn: false };
  }
  if (read.text.trim() === "") {
    return { text: "this file holds only blank space", warn: false };
  }
  return undefined;
}

/**
 * The note a PDF the extractor stopped short on carries beside its words.
 *
 * @param read the route's answer
 * @returns the note, or `undefined` for a text file or a PDF read to its last page
 */
export function pdfShortfallOf({ read }: { read: DraftMediaText }): string | undefined {
  if (read.kind !== "pdf" || read.pagesRead >= read.pages) {
    return undefined;
  }
  return `text of the first ${String(read.pagesRead)} of ${String(read.pages)} pages; the rest were not read`;
}

/** Lines the collapsed card shows before "Show all". */
export const COLLAPSED_LINES = 12;

/** Characters the collapsed card shows at most, so one enormous line cannot fill the card. */
export const COLLAPSED_CHARS = 1500;

/** The opening of a text, and exactly how much of it that is. */
export interface TextHead {
  /** What the collapsed card shows: whole lines, or — only when the first line alone is over budget — part of it. */
  readonly head: string;
  /** The whole text as the expanded card shows it, every `\r\n` and lone `\r` drawn as the line break it is. */
  readonly body: string;
  /** WHOLE lines in the head; a cut first line is not counted. */
  readonly shownLines: number;
  /** True when the head is part of the first line, cut at the character budget. */
  readonly partLine: boolean;
  /** Lines in the whole text; a final line break ends a line rather than opening one. */
  readonly totalLines: number;
  /** True when the head IS the whole text, so there is nothing to expand. */
  readonly whole: boolean;
}

/**
 * The collapsed card's view of a text: whole lines, at most `lines` of them and `chars` characters, and how much that
 * leaves out. A line is never cut unless it is the first one and alone over budget, and then {@link TextHead.partLine}
 * says so — so a count on the card is never a cut line passed off as a whole one.
 *
 * @param text the whole text
 * @param lines the line budget
 * @param chars the character budget, counted in code points so a character is never split
 * @returns the head and its counts
 */
export function textHead({
  text,
  lines = COLLAPSED_LINES,
  chars = COLLAPSED_CHARS,
}: {
  text: string;
  lines?: number;
  chars?: number;
}): TextHead {
  const normal = text.replace(/\r\n?/gu, "\n");
  const body = normal.endsWith("\n") ? normal.slice(0, -1) : normal;
  if (body === "") {
    return { body, head: "", partLine: false, shownLines: 0, totalLines: 0, whole: true };
  }
  const all = body.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of all.slice(0, lines)) {
    const cost = Array.from(line).length + (kept.length > 0 ? 1 : 0);
    if (used + cost > chars) {
      break;
    }
    kept.push(line);
    used += cost;
  }
  if (kept.length === 0) {
    const head = Array.from(all[0]).slice(0, chars).join("");
    return { body, head, partLine: true, shownLines: 0, totalLines: all.length, whole: false };
  }
  return {
    body,
    head: kept.join("\n"),
    partLine: false,
    shownLines: kept.length,
    totalLines: all.length,
    whole: kept.length === all.length,
  };
}

/**
 * What the collapsed card says about how much of the text it is showing.
 *
 * @param head the collapsed view
 * @returns the sentence, naming lines or — for a cut first line — characters
 */
export function collapsedLabel({ head }: { head: TextHead }): string {
  const lines = `${String(head.totalLines)} ${head.totalLines === 1 ? "line" : "lines"}`;
  if (head.partLine) {
    return `the first ${String(Array.from(head.head).length)} characters of line 1, of ${lines}`;
  }
  return `first ${String(head.shownLines)} of ${lines}`;
}
