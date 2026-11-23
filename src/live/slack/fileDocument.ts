/**
 * Pure renderers for one `slack read-file` result — the markdown a session reads, and the JSON a machine
 * consumes. No I/O.
 *
 * The markdown leads with what the file IS, then the transcript, then the residue. That order is the
 * outbound-message doctrine applied to a local read: the thing the caller asked for above the fold, the
 * provenance and the gaps below it.
 */
import { GLYPHLESS_LINE } from "../../pdf/limits.js";
import type { SlackFileBody, SlackFileReadDocument } from "./readFile.js";

/** One `key: value` line, dropped entirely when the value is absent. */
function line({ key, value }: { key: string; value: string | undefined }): readonly string[] {
  return value === undefined ? [] : [`- ${key}: ${value}`];
}

/**
 * What kind of file this is: a huddle canvas by name, else Slack's `filetype`, else its older `mode` — the
 * second signal for the same question `SlackFileMeta` documents. Both are optional, so a file carrying
 * neither prints no kind line at all.
 */
function fileKind({ file }: { file: SlackFileReadDocument["file"] }): string | undefined {
  if (file.isHuddleCanvas) {
    return "huddle notes (canvas)";
  }
  const { filetype } = file;
  if (filetype === undefined) {
    return file.mode;
  }
  return filetype;
}

/**
 * How big a body is and where it landed — with the page counts when the bytes were a PDF.
 *
 * The page count is part of the SCALE line rather than the text, because "3 pages" answers a different
 * question from what the pages say, and a reader deciding whether to open the file needs the first one.
 *
 * @param body the fetched body
 * @returns one parenthetical, without its brackets
 */
function bodyScale({ body }: { body: SlackFileBody }): string {
  const landed = `${String(body.bytes)} bytes → ${body.localPath}`;
  if (body.pdf === undefined) {
    return landed;
  }
  if (body.pdf.pagesRead < body.pdf.pages) {
    return `${String(body.bytes)} bytes, ${String(body.pdf.pages)} page(s), ${String(body.pdf.pagesRead)} read → ${body.localPath}`;
  }
  return `${String(body.bytes)} bytes, ${String(body.pdf.pages)} page(s) → ${body.localPath}`;
}

/**
 * A body's words, or the one line that says why there are none.
 *
 * A glyphless PDF prints {@link GLYPHLESS_LINE} rather than nothing at all: a heading with no body under it
 * reads as a document that said nothing, which is exactly the claim this read cannot make. A body whose
 * bytes arrived and whose parse FAILED says that instead, for the same reason.
 *
 * @param body the fetched body
 * @returns the lines to append under the heading, blank-line separator included
 */
function bodyText({ body }: { body: SlackFileBody }): readonly string[] {
  if (body.pdf?.glyphless === true) {
    return ["", GLYPHLESS_LINE];
  }
  // Same argument one step along: the bytes are on disk, the parse is what failed, and a heading with
  // nothing under it reads as a document that said nothing. The residue names it too; this puts it where
  // the reader is already looking.
  if (body.unreadable !== undefined) {
    return ["", `could not read this file's text — ${body.unreadable}`];
  }
  if (body.text === undefined) {
    return [];
  }
  return ["", body.text.trimEnd()];
}

/**
 * Render the human-readable markdown for one read.
 *
 * @param document the resolved read
 * @returns the markdown block written to stdout
 */
export function renderFileText({ document }: { document: SlackFileReadDocument }): string {
  const { file, transcript } = document;
  const head = [
    `# ${file.title}`,
    "",
    ...line({ key: "file", value: file.id }),
    ...line({ key: "kind", value: fileKind({ file }) }),
    ...line({ key: "permalink", value: file.permalink }),
    ...line({ key: "huddle started", value: file.huddleStartIso }),
    ...line({ key: "huddle ended", value: file.huddleEndIso }),
    ...line({ key: "created", value: file.createdIso }),
    ...line({ key: "shared into", value: file.channels.length > 0 ? file.channels.join(", ") : undefined }),
    `- read at: ${document.readAtIso}`,
  ];
  const notes =
    document.body === undefined
      ? []
      : ["", `## Body (${bodyScale({ body: document.body })})`, ...bodyText({ body: document.body })];
  const spoken =
    transcript === undefined
      ? []
      : [
          "",
          `## Transcript (${transcript.file.id}${transcript.body === undefined ? ", body unavailable" : `, ${bodyScale({ body: transcript.body })}`})`,
          ...(transcript.body === undefined ? [] : bodyText({ body: transcript.body })),
        ];
  const residue =
    document.residue.length === 0
      ? ["", "Residue: none — everything this read set out to fetch, it fetched."]
      : ["", "## Residue", "", ...document.residue.map((item) => `- ${item}`)];
  return [...head, ...notes, ...spoken, ...residue].join("\n");
}

/**
 * Render the machine-readable document.
 *
 * @param document the resolved read
 * @returns exactly one JSON document, so `… --json | jq` works
 */
export function renderFileJson({ document }: { document: SlackFileReadDocument }): string {
  return JSON.stringify(document, null, 2);
}
