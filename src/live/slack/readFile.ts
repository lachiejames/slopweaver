/**
 * `slack read-file` — the effectful orchestration behind reading ONE Slack file, and the huddle transcript
 * a huddle-notes canvas points at.
 *
 * ## Why this is not a branch inside `read-thread`
 *
 * `read-thread` starts from a MESSAGE and follows the attachments hanging off it. A huddle canvas hangs off
 * no message at all: it lives in the Files browser, its permalink is `/docs/<team>/<file>`, and the
 * transcript is a second file reachable only through the canvas's own `huddle_transcript_file_id`. Every
 * step of `read-thread`'s pipeline — permalink → channel + ts → `conversations.replies` — has nothing to
 * resolve here, which is why this is a sibling verb rather than a flag on that one.
 *
 * ## The read is two calls, and the second one is optional
 *
 * `files.info` on the reference gives the notes canvas. When Slack marks it a huddle canvas AND names a
 * transcript file id, a second `files.info` — with `include_transcription=true` — returns the transcript's
 * own metadata AND the words that were said. A huddle with no
 * transcript (nobody enabled it, or Slack has not finished generating it) returns the notes alone, said out
 * loud in the residue rather than reported as a failure — the same shape `read-thread` uses for an
 * attachment it could not fetch.
 *
 * The AI SUMMARY (`huddle_summary_id`) is reported and never followed. It is Slack's model's paraphrase of
 * the conversation, and this verb exists to hand a session the words that were actually said; a summary
 * silently concatenated to a transcript is indistinguishable from the transcript once it is in a prompt.
 *
 * ## The transcript's WORDS are not the transcript file's bytes
 *
 * A `huddle_transcript` file's bytes are cookie-only — `files-pri` 302s a bearer token to the workspace
 * root, measured — and that is still true. The words come back INLINE on the second
 * `files.info`, under Slack's undeclared `include_transcription=true`, so this verb asks for them there and
 * only falls back to the doomed download when a response carries none. `huddleTranscript.ts` holds the
 * measurement, the shape and the rendering.
 *
 * ## Bytes land on disk, not in a string
 *
 * A DOWNLOADED body comes through {@link downloadSlackFile}, the one hardened authenticated-GET path in this
 * program — host allowlist, no credential on a redirect, HTML-sign-in-page detection, size agreement.
 * Re-fetching those properties in a second, simpler downloader is exactly how a read verb starts saving a
 * login page and calling it a transcript. The file is then read back as UTF-8, so the download's guarantees
 * hold for every byte this verb prints. An INLINE transcript never touches that path — it arrived as JSON on
 * an already-authenticated API call — and is written to the same directory so every consumer still has a
 * local path to open.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SlackApi } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { pdfAttachmentAt } from "../../pdf/attachment.js";
import type { DownloadedBytes, DownloadFile } from "./download.js";
import type { SlackFileDownloadError } from "./downloadErrors.js";
import { type SlackFileDocumentError, type SlackFileReadError, SlackFileReadErrors } from "./fileErrors.js";
import { type SlackFileMeta, shapeSlackFileMeta } from "./fileMeta.js";
import { parseSlackFileReference } from "./fileReference.js";
import { renderHuddleTranscript } from "./huddleTranscript.js";

/**
 * Filetypes whose bytes this verb DECODES as UTF-8 and prints. Everything else is still downloaded — the
 * local path is reported so a caller can open it — but never decoded, because printing a PNG into a
 * terminal (or into a model's context) is worse than saying where it landed.
 */
const TEXT_FILETYPES: ReadonlySet<string> = new Set([
  "canvas",
  "quip",
  "text",
  "markdown",
  "post",
  "space",
  "vtt",
  "huddle_transcript",
]);

/** One file's bytes, on disk, and its text when this verb could read any — decoded or extracted. */
export interface SlackFileBody {
  /** Where the bytes landed. */
  readonly localPath: string;
  /** How many bytes arrived. */
  readonly bytes: number;
  /**
   * The file's words: decoded as UTF-8 for a filetype {@link TEXT_FILETYPES} admits, EXTRACTED for a PDF,
   * and `undefined` for everything else — including a PDF with no text layer, whose absence
   * {@link SlackFileBody.pdf} is what reports.
   */
  readonly text: string | undefined;
  /**
   * Present when the bytes were a PDF, whatever the uploader's mimetype claimed. `glyphless` is the field
   * that matters to a reader: it separates "this document is blank" from "nothing here read the pixels".
   */
  readonly pdf: { readonly pages: number; readonly pagesRead: number; readonly glyphless: boolean } | undefined;
  /**
   * Why {@link SlackFileBody.text} is absent when the bytes themselves ARRIVED — a PDF this reader could
   * not parse, or a decode that failed. The bytes are still on disk at {@link SlackFileBody.localPath},
   * and a read that threw that fact away told a caller nothing it could act on.
   */
  readonly unreadable: string | undefined;
}

/** What one `slack read-file` invocation resolved. */
export interface SlackFileReadDocument {
  /** The file the caller named. */
  readonly file: SlackFileMeta;
  /** The named file's own bytes, when they could be fetched. */
  readonly body: SlackFileBody | undefined;
  /**
   * The huddle transcript file the notes canvas points at — its metadata always, its body when Slack served
   * one. Present whenever the named file named a transcript and `followTranscript` was on.
   */
  readonly transcript: { readonly file: SlackFileMeta; readonly body: SlackFileBody | undefined } | undefined;
  /** Everything this read could NOT establish, said out loud rather than left as a silent absence. */
  readonly residue: readonly string[];
  /** When the read ran. */
  readonly readAtIso: string;
}

/** The injected edges, so the orchestration is testable without a token or a network. *
 * @internal — the injected edges, named so a test can build them; production wires them once.
 */
export interface ReadSlackFileDeps {
  readonly api: Pick<SlackApi, "filesInfo">;
  readonly downloadFile: DownloadFile;
  readonly nowIso: () => string;
}

/**
 * `files.info` on one id, shaped, with the call's own throw turned into this domain's error.
 *
 * @param deps the injected edges
 * @param fileId the file to look up
 * @param includeTranscription ask Slack for a huddle transcript's words inline, not just its metadata
 * @returns the shaped metadata, or `err` naming what stopped the lookup
 */
async function fileMeta({
  deps,
  fileId,
  includeTranscription = false,
}: {
  deps: ReadSlackFileDeps;
  fileId: string;
  includeTranscription?: boolean;
}): Promise<Result<SlackFileMeta, SlackFileReadError>> {
  let raw: { file: unknown };
  try {
    raw = await deps.api.filesInfo({ fileId, includeTranscription });
  } catch (error: unknown) {
    return err(SlackFileReadErrors.lookupFailed({ cause: error, fileId }));
  }
  return shapeSlackFileMeta({ file: raw.file });
}

/**
 * Fetch one file's bytes to disk, decoding them as UTF-8 only when the filetype says they are text.
 *
 * @param deps the injected edges
 * @param meta the file whose bytes to fetch
 * @param destinationDir where the bytes land, keyed by file id
 * @param token the Slack token authorised for the file
 * @returns the downloaded body, or `err` naming what stopped it
 */
async function fetchBody({
  deps,
  meta,
  destinationDir,
  token,
}: {
  deps: ReadSlackFileDeps;
  meta: SlackFileMeta;
  destinationDir: string;
  token: string;
}): Promise<Result<SlackFileBody, SlackFileDocumentError>> {
  // Both URLs are tried, download-first, because Slack does not serve every filetype from both. An ordinary
  // upload answers on `url_private_download`; a huddle transcript's download URL 302s to the workspace root
  // — Slack's "not for you" bounce. Trying one and reporting a permission problem would have been wrong
  // about the cause as well as the outcome.
  const candidates = [meta.urlPrivateDownload, meta.urlPrivate].filter((url): url is string => url !== undefined);
  if (candidates.length === 0) {
    return err(SlackFileReadErrors.noBodyUrl({ fileId: meta.id }));
  }
  const made = safeFs({
    execute: () => mkdirSync(destinationDir, { mode: 0o700, recursive: true }),
    operation: "slack.readFile.mkdir",
    path: destinationDir,
  });
  if (made.isErr()) {
    return err(SlackFileReadErrors.unusableFile({ reason: made.error.message }));
  }
  const downloaded = await firstUrlThatServes({ candidates, deps, destinationDir, meta, token });
  if (downloaded.isErr()) {
    return err(downloaded.error);
  }
  return readBodyText({ downloaded: downloaded.value, meta });
}

/**
 * Try each candidate URL in order, keeping the LAST failure when none of them serves bytes.
 *
 * @param candidates the URLs to try, most-likely first
 * @param deps the injected edges
 * @param destinationDir where the bytes land
 * @param meta the file being fetched
 * @param token the Slack token
 * @returns the first successful download, or the last failure
 */
async function firstUrlThatServes({
  candidates,
  deps,
  destinationDir,
  meta,
  token,
}: {
  candidates: readonly string[];
  deps: ReadSlackFileDeps;
  destinationDir: string;
  meta: SlackFileMeta;
  token: string;
}): Promise<Result<DownloadedBytes, SlackFileDownloadError>> {
  let last = await deps.downloadFile({
    destinationDir,
    expectedBytes: meta.size,
    filename: `${meta.id}.body`,
    token,
    url: candidates[0]!,
  });
  for (const url of candidates.slice(1)) {
    if (last.isOk()) {
      return last;
    }
    last = await deps.downloadFile({
      destinationDir,
      expectedBytes: meta.size,
      filename: `${meta.id}.body`,
      token,
      url,
    });
  }
  return last;
}

/**
 * Read a downloaded file's words: extracted when the bytes are a PDF, decoded when the filetype is one this
 * verb prints, and neither otherwise.
 *
 * The PDF arm is tried FIRST and judged on the file's own magic, because Slack reports the mimetype an
 * uploader chose. MEASURED: a 321,706-byte pentest report came back with `text` undefined and
 * a local path, so a session that had asked what the report said got told where it was instead.
 *
 * A failure HERE is never a failed read. The GET already succeeded, so the bytes are on disk whatever the
 * parser made of them, and answering `err` threw the one fact a caller could act on — the local path — away
 * with the reason. It comes back on `unreadable` instead, exactly as `./fileDownloads.ts` does it for a
 * thread.
 *
 * @param downloaded where the bytes landed and how many arrived
 * @param meta the file's metadata, whose `filetype` decides the UTF-8 arm
 * @returns the body, with `text` present for a PDF with a text layer or a decodable filetype
 */
async function readBodyText({
  downloaded,
  meta,
}: {
  downloaded: DownloadedBytes;
  meta: SlackFileMeta;
}): Promise<Result<SlackFileBody, SlackFileDocumentError>> {
  const { bytes, localPath } = downloaded;
  const attachment = await pdfAttachmentAt({ localPath });
  if (attachment.isErr()) {
    return ok({ bytes, localPath, pdf: undefined, text: undefined, unreadable: attachment.error.join("; ") });
  }
  const pdf = attachment.value;
  if (pdf !== undefined) {
    const { glyphless, pages, pagesRead, text } = pdf;
    return ok({ bytes, localPath, pdf: { glyphless, pages, pagesRead }, text, unreadable: undefined });
  }
  if (meta.filetype !== undefined && !TEXT_FILETYPES.has(meta.filetype)) {
    return ok({ bytes, localPath, pdf: undefined, text: undefined, unreadable: undefined });
  }
  const read = safeFs({
    execute: () => readFileSync(localPath, "utf8"),
    operation: "slack.readFile.read",
    path: localPath,
  });
  if (read.isErr()) {
    return ok({ bytes, localPath, pdf: undefined, text: undefined, unreadable: read.error.message });
  }
  return ok({ bytes, localPath, pdf: undefined, text: read.value, unreadable: undefined });
}

/**
 * Read one Slack file, following a huddle canvas to its transcript.
 *
 * @param deps the injected edges
 * @param reference whatever the caller pasted — a bare `F…` id or any Slack file link
 * @param filesRoot the directory downloaded bodies land in
 * @param token the Slack token to read and download with
 * @param followTranscript false to read the notes canvas alone, leaving the transcript unfetched
 * @returns the resolved document, or `err` naming why nothing could be read
 */
export async function readSlackFile({
  deps,
  reference,
  filesRoot,
  token,
  followTranscript,
}: {
  deps: ReadSlackFileDeps;
  reference: string;
  filesRoot: string;
  token: string;
  followTranscript: boolean;
}): Promise<Result<SlackFileReadDocument, SlackFileDocumentError>> {
  const fileId = parseSlackFileReference({ reference });
  if (fileId.isErr()) {
    return err(fileId.error);
  }
  const meta = await fileMeta({ deps, fileId: fileId.value });
  if (meta.isErr()) {
    return err(meta.error);
  }
  const file = meta.value;
  const residue: string[] = [];
  const body = await fetchBody({ deps, destinationDir: filesRoot, meta: file, token });
  if (body.isErr()) {
    residue.push(body.error.message);
  }
  if (body.isOk() && body.value.unreadable !== undefined) {
    residue.push(`${file.id}: bytes retrieved to ${body.value.localPath}, text not — ${body.value.unreadable}`);
  }
  const transcript = followTranscript
    ? await huddleTranscriptFor({ deps, file, filesRoot, residue, token })
    : undefined;
  if (!followTranscript && file.huddleTranscriptFileId !== undefined) {
    residue.push(`--no-transcript: huddle transcript ${file.huddleTranscriptFileId} was not read`);
  }
  return ok({
    body: body.isOk() ? body.value : undefined,
    file,
    readAtIso: deps.nowIso(),
    residue,
    transcript,
  });
}

/**
 * Resolve the transcript a huddle canvas points at, appending to the residue rather than failing when it
 * cannot be reached — the notes alone are still worth returning.
 *
 * @param deps the injected edges
 * @param file the already-shaped notes canvas
 * @param filesRoot where bodies land
 * @param residue the accumulating list of things this read could not establish
 * @param token the Slack token
 * @returns the transcript file and its body, or undefined when the canvas names no transcript
 */
async function huddleTranscriptFor({
  deps,
  file,
  filesRoot,
  residue,
  token,
}: {
  deps: ReadSlackFileDeps;
  file: SlackFileMeta;
  filesRoot: string;
  residue: string[];
  token: string;
}): Promise<{ file: SlackFileMeta; body: SlackFileBody | undefined } | undefined> {
  if (file.huddleSummaryId !== undefined) {
    residue.push(
      `this huddle also has an AI SUMMARY (${file.huddleSummaryId}); it is not read — read it explicitly if you want Slack's paraphrase rather than the words said`,
    );
  }
  const transcriptId = file.huddleTranscriptFileId;
  if (transcriptId === undefined) {
    if (file.isHuddleCanvas) {
      residue.push(`${file.id} is a huddle canvas but names no transcript file — Slack generated none`);
    }
    return undefined;
  }
  const meta = await fileMeta({ deps, fileId: transcriptId, includeTranscription: true });
  if (meta.isErr()) {
    residue.push(meta.error.message);
    return undefined;
  }
  const inline = writeInlineTranscript({ destinationDir: filesRoot, meta: meta.value });
  if (inline !== undefined) {
    if (inline.isErr()) {
      residue.push(inline.error.message);
      return { body: undefined, file: meta.value };
    }
    return { body: inline.value, file: meta.value };
  }
  residue.push(
    `${meta.value.id} returned no inline transcription — falling back to its bytes, which Slack serves to a browser session and not to a token`,
  );
  const body = await fetchBody({ deps, destinationDir: filesRoot, meta: meta.value, token });
  if (body.isErr()) {
    residue.push(body.error.message);
    return { body: undefined, file: meta.value };
  }
  if (body.value.unreadable !== undefined) {
    residue.push(`${meta.value.id}: bytes retrieved to ${body.value.localPath}, text not — ${body.value.unreadable}`);
  }
  return { body: body.value, file: meta.value };
}

/**
 * Render an inline `huddle_transcription` to text and land it on disk, so the words a `files.info` response
 * carried are reported through the same {@link SlackFileBody} shape a downloaded body is.
 *
 * The file is WRITTEN rather than only returned as a string because every consumer of this verb — the human
 * rendering, `--json`, and anything that wants to reread it later — was built around a local path, and a
 * transcript that exists only in one process's memory is the one body a caller cannot open. Speakers stay
 * `<@U…>`: this verb holds no name map, and `huddleTranscript.ts` says why a placeholder would be worse.
 *
 * @param destinationDir where the rendered transcript lands, keyed by file id
 * @param meta the transcript file's metadata, carrying the inline transcription when Slack sent one
 * @returns undefined when the response carried no transcription; else the body, or why it could not be written
 */
function writeInlineTranscript({
  destinationDir,
  meta,
}: {
  destinationDir: string;
  meta: SlackFileMeta;
}): Result<SlackFileBody, SlackFileDocumentError> | undefined {
  const transcript = meta.huddleTranscript;
  if (transcript === undefined) {
    return undefined;
  }
  const text = renderHuddleTranscript({ transcript });
  const localPath = join(destinationDir, `${meta.id}.body`);
  const written = safeFs({
    execute: () => {
      mkdirSync(destinationDir, { mode: 0o700, recursive: true });
      writeFileSync(localPath, text, { encoding: "utf8", mode: 0o600 });
    },
    operation: "slack.readFile.writeTranscript",
    path: localPath,
  });
  return written.isErr()
    ? err(SlackFileReadErrors.unusableFile({ reason: written.error.message }))
    : ok({ bytes: Buffer.byteLength(text, "utf8"), localPath, pdf: undefined, text, unreadable: undefined });
}
