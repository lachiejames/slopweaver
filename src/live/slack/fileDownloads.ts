/**
 * Fetch every planned attachment, and account for every one that has no bytes.
 *
 * ## A failed download is reported, not fatal
 *
 * Three outcomes, and they are three different claims:
 *
 *  - **retrieved** — the bytes are on disk.
 *  - **skipped** — a stated, reasoned exclusion this program chose (`filePlan.ts`).
 *  - **unretrievable** — meant to be fetched, and was not. The GET failed, or the scope preflight says the
 *    token cannot read files at all, so it was never attempted.
 *
 * The third used to be `err`, which killed the whole read: every message and every other attachment thrown
 * away to report one missing PDF. `completeness.ts` carries the full argument for the change; the short form
 * is that `blockFiles.ts` had already made this exact call for `files.info` and written down why, and the
 * original worry — a message whose PDF failed being summarised without its content — was about *silence*, not
 * about the read surviving. An unretrievable file is named in `unretrievableFiles`, in `limitations` and in
 * `warnings`, so nothing about it is silent.
 *
 * What stays FATAL is a refusal about the DESTINATION rather than about one file: a thread directory that is
 * not a real directory is a symlink-redirection attempt, it invalidates every write this stage would make,
 * and it is not evidence about any particular attachment.
 */
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { type PdfAttachment, pdfAttachmentAt } from "../../pdf/attachment.js";
import type { UnretrievableFile } from "./completeness.js";
import { describeUnretrievable } from "./completeness.js";
import type { DownloadedBytes, DownloadFile } from "./download.js";
import { type SlackFileDownloadError, SlackFileDownloadErrors } from "./downloadErrors.js";
import { describeSkips, type FilePlan, type FileScopePreflight } from "./filePlan.js";
import type { FileSkipReason, RetrievedFile, SkippedFile } from "./types.js";

/** The operation name reported against a failed byte fetch — the same string `download.ts` paces it under. */
const DOWNLOAD_OPERATION = "slack.files.download";

/** What the download stage produced. */
export interface FileOutcome {
  readonly retrieved: readonly RetrievedFile[];
  readonly skipped: readonly SkippedFile[];
  /** Attachments meant to be fetched that have no bytes, each naming the failing method and the reason. */
  readonly unretrievable: readonly UnretrievableFile[];
  /**
   * One sentence per skip class, one per unretrievable file, and one per attachment whose bytes arrived
   * but whose words could not be read — the honest account of what is missing.
   */
  readonly limitations: readonly string[];
}

/**
 * Group skips by reason so the output states "3 files not retrieved: …" rather than three separate lines.
 *
 * @param skipped every skipped attachment
 * @returns one sentence per distinct reason, in a stable order
 */
function limitationsFor({ skipped }: { skipped: readonly SkippedFile[] }): readonly string[] {
  const counts = new Map<FileSkipReason, number>();
  for (const skip of skipped) {
    // A reason's first sighting counts one; a later one adds one to what is held.
    const { reason } = skip;
    const held = counts.get(reason);
    counts.set(reason, held === undefined ? 1 : held + 1);
  }
  return [...counts.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => describeSkips({ count, reason }));
}

/**
 * Every planned skip, as the output reports it.
 *
 * `detail` is carried through rather than summarised away: `reason` names the CLASS and `detail` names what
 * actually happened, which is the difference between a scope the operator can grant and a file Slack has lost.
 *
 * @param plan the classified attachments
 * @returns one reported skip per planned skip, in plan order
 */
function reportedSkips({ plan }: { plan: FilePlan }): SkippedFile[] {
  return plan.skips.map((s) => ({
    fileId: s.file.id,
    messageTs: s.messageTs,
    reason: s.reason,
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
    ...(s.file.mimetype !== undefined ? { mimetype: s.file.mimetype } : {}),
    ...(s.file.name !== undefined ? { name: s.file.name } : {}),
    ...(s.file.size !== undefined ? { size: s.file.size } : {}),
  }));
}

/** One planned download that has no bytes, as the evidence model records it. */
function unretrievableFor({
  planned,
  reason,
  detail,
}: {
  planned: FilePlan["downloads"][number];
  reason: UnretrievableFile["reason"];
  detail: string;
}): UnretrievableFile {
  return {
    detail,
    fileId: planned.file.id,
    messageTs: planned.messageTs,
    method: DOWNLOAD_OPERATION,
    reason,
    ...(planned.file.mimetype !== undefined ? { mimetype: planned.file.mimetype } : {}),
    ...(planned.file.name !== undefined ? { name: planned.file.name } : {}),
    ...(planned.file.size !== undefined ? { size: planned.file.size } : {}),
  };
}

/**
 * Assemble the stage's output, with `limitations` covering both classes of absence.
 *
 * Skips first, then unretrievables: policy before failure, so a reader scanning the tail meets the
 * "this is fine and here is why" lines before the "this went wrong" ones.
 */
function outcomeOf({
  retrieved,
  skipped,
  unretrievable,
  unreadable = [],
}: {
  retrieved: readonly RetrievedFile[];
  skipped: readonly SkippedFile[];
  unretrievable: readonly UnretrievableFile[];
  unreadable?: readonly string[];
}): FileOutcome {
  return {
    limitations: [...limitationsFor({ skipped }), ...describeUnretrievable({ files: unretrievable }), ...unreadable],
    retrieved,
    skipped,
    unretrievable,
  };
}

/**
 * Download every planned attachment into a per-thread directory.
 *
 * When `preflight` says the token lacks the file scope, NO download is attempted and every planned attachment
 * is recorded as `scope-missing`. Trying anyway would spend a tier3 request per file to be told the same thing
 * Slack has already said, and on an unauthorised file URL the answer arrives as a 200 HTML sign-in page — a
 * failure mode `download.ts` catches but should not have to.
 *
 * @param plan the classified attachments
 * @param preflight the scope verdict for the file lane
 * @param rootDir the `live/slack/thread-files` root
 * @param threadKey a filesystem-safe key for this thread (channel + thread ts)
 * @param token the Slack token authorised for the files
 * @param downloadFile the injected download seam
 * @returns what was retrieved, deliberately skipped and unretrievable, or `err` only if the destination is unusable
 */
export async function downloadThreadFiles({
  plan,
  preflight,
  rootDir,
  threadKey,
  token,
  downloadFile,
}: {
  plan: FilePlan;
  preflight: FileScopePreflight;
  rootDir: string;
  threadKey: string;
  token: string;
  downloadFile: DownloadFile;
}): Promise<Result<FileOutcome, SlackFileDownloadError>> {
  const skipped = reportedSkips({ plan });
  if (preflight.verdict === "insufficient") {
    const detail = `token lacks ${preflight.missing.join(", ")}; the download was not attempted`;
    const unretrievable = plan.downloads.map((planned) =>
      unretrievableFor({ detail, planned, reason: "scope-missing" }),
    );
    return ok(outcomeOf({ retrieved: [], skipped, unretrievable }));
  }
  if (plan.downloads.length === 0) {
    return ok(outcomeOf({ retrieved: [], skipped, unretrievable: [] }));
  }
  const destinationDir = join(rootDir, threadKey);
  await mkdir(destinationDir, { mode: 0o700, recursive: true });
  // `O_NOFOLLOW` on the file protects the last path component only. If the thread DIRECTORY is itself a
  // symlink, `mkdir -p` succeeds against the link target and every attachment lands outside the tree with
  // no flag able to notice. `lstat` is the only thing that distinguishes the two.
  const dir = await lstat(destinationDir);
  if (!dir.isDirectory()) {
    return err(SlackFileDownloadErrors.destinationUnusable({ destinationDir }));
  }
  const fetched = await fetchEachPlanned({ destinationDir, downloadFile, downloads: plan.downloads, token });
  return ok(outcomeOf({ ...fetched, skipped }));
}

/**
 * Fetch each planned attachment in turn, partitioning them into what arrived and what did not.
 *
 * Serial on purpose: these share the workspace quota and are paced as tier3, so firing 33 at once would just
 * queue behind the same block while making the failure mode harder to read.
 *
 * @param downloads the planned downloads, in plan order
 * @param destinationDir the verified thread directory to write into
 * @param token the Slack token authorised for the files
 * @param downloadFile the injected download seam
 * @returns the attachments whose bytes landed, and those that have none
 */
async function fetchEachPlanned({
  downloads,
  destinationDir,
  token,
  downloadFile,
}: {
  downloads: FilePlan["downloads"];
  destinationDir: string;
  token: string;
  downloadFile: DownloadFile;
}): Promise<{
  retrieved: readonly RetrievedFile[];
  unretrievable: readonly UnretrievableFile[];
  unreadable: readonly string[];
}> {
  const retrieved: RetrievedFile[] = [];
  const unretrievable: UnretrievableFile[] = [];
  const unreadable: string[] = [];
  for (const planned of downloads) {
    const result = await downloadFile({
      destinationDir,
      expectedBytes: planned.file.size,
      filename: planned.filename,
      token,
      url: planned.url,
    });
    if (result.isErr()) {
      // The loop CONTINUES. One file Slack would not serve is not evidence about the next one, and the
      // reader gets the six attachments that worked plus a named account of the one that did not.
      unretrievable.push(unretrievableFor({ detail: result.error.message, planned, reason: "download-failed" }));
      continue;
    }
    const words = await wordsOf({ localPath: result.value.localPath, planned });
    if (words.unreadable !== undefined) {
      unreadable.push(words.unreadable);
    }
    retrieved.push(retrievedFor({ download: result.value, pdf: words.pdf, planned }));
  }
  return { retrieved, unreadable, unretrievable };
}

/**
 * The name a reader recognises this attachment by, or its id when Slack reported none.
 *
 * Written as a returning `if` rather than a fallback operator: the substitution is said out loud, which is
 * what `.claude/rules/typescript-patterns.md` § "No silent fallback" asks of exactly this shape.
 *
 * @param file the planned attachment's own metadata
 * @returns the filename, or the file id
 */
function labelOf({ file }: { file: FilePlan["downloads"][number]["file"] }): string {
  if (file.name === undefined) {
    return file.id;
  }
  return file.name;
}

/**
 * Read one downloaded attachment's words, when its bytes turn out to be a PDF.
 *
 * The bytes ARRIVED, so a failed extraction is never a failed download: the caller keeps the file retrieved
 * with its local path, and what comes back here is the sentence saying why its words are missing.
 *
 * @param planned the download these bytes came from
 * @param localPath where the bytes landed
 * @returns the PDF facts when the bytes were one, and the limitation sentence when they could not be read
 */
async function wordsOf({
  planned,
  localPath,
}: {
  planned: FilePlan["downloads"][number];
  localPath: string;
}): Promise<{ readonly pdf: PdfAttachment | undefined; readonly unreadable: string | undefined }> {
  const attachment = await pdfAttachmentAt({ localPath });
  if (attachment.isErr()) {
    const why = attachment.error.join("; ");
    return { pdf: undefined, unreadable: `${labelOf({ file: planned.file })}: bytes retrieved, text not — ${why}` };
  }
  return { pdf: attachment.value, unreadable: undefined };
}

/**
 * One attachment whose bytes landed, as the evidence model records it.
 *
 * @param planned the download it came from
 * @param download where the bytes landed and how many arrived
 * @param pdf what the extractor read, absent when the bytes were not a PDF
 * @returns the retrieved row
 */
function retrievedFor({
  planned,
  download,
  pdf,
}: {
  planned: FilePlan["downloads"][number];
  download: DownloadedBytes;
  pdf: PdfAttachment | undefined;
}): RetrievedFile {
  return {
    bytes: download.bytes,
    fileId: planned.file.id,
    localPath: download.localPath,
    messageTs: planned.messageTs,
    ...(planned.file.mimetype !== undefined ? { mimetype: planned.file.mimetype } : {}),
    ...(planned.file.name !== undefined ? { name: planned.file.name } : {}),
    ...(pdf === undefined ? {} : { pdf: { glyphless: pdf.glyphless, pages: pdf.pages, pagesRead: pdf.pagesRead } }),
    ...(pdf?.text === undefined ? {} : { text: pdf.text }),
  };
}
