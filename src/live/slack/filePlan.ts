/**
 * Which attachments get fetched, and what they are called on disk. Pure — no I/O, so every rule here is
 * table-testable.
 *
 * ## Naming: the remote name is never a path component
 *
 * Slack's `name` is remote-controlled text. Joining it under a local directory is a directory-traversal
 * primitive (`name: "../../secrets/slack-user-token"`), and whether Slack currently permits such a name is
 * not something this code should depend on. So the local filename is built from the FILE ID — which Slack
 * constrains to `F` + uppercase alphanumerics — plus an extension drawn from a fixed allowlist. The
 * human-readable name still travels in the output as metadata; it just never touches the filesystem.
 *
 * ## What is fetched
 *
 * The owner's rule is "get the whole file and properly read it" — the point being that an image or a PDF
 * often carries the context the thread is about. What the model cannot read (video, audio, archives) is
 * NOT downloaded, because a 213 MB mp4 costs minutes to produce a line saying "this is a video". Measured
 * in the real corpus: 87 videos, and the largest single file is 213.7 MB.
 *
 * Every exclusion is REPORTED with its reason. Nothing is dropped silently — a skipped attachment the
 * reader never hears about is the same defect as a truncated thread.
 */
import type { BlockFileResolution } from "./blockFiles.js";
import type { FileSkipReason, VisibleSlackFile, VisibleSlackMessage } from "./types.js";

/**
 * The default per-file ceiling. The measured p99 attachment is 21.5 MB, so 25 MB fetches essentially
 * everything a person actually shares while still refusing the 213.7 MB outlier.
 */
export const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Slack file ids: `F` followed by uppercase alphanumerics. Anything else is not used to build a path. */
const FILE_ID = /^F[A-Z0-9]+$/;

/**
 * Slack canvases. MEASURED against the real workspace: a canvas carries a `url_private_download` like any
 * other file, but fetching it returns a 200 with an HTML sign-in page rather than the document — while a
 * PNG and a PDF in the same thread, on the same token, seconds apart, both downloaded fine. So this is
 * structural, not a permission problem: Slack does not serve canvas content as file bytes.
 *
 * It is therefore a planned SKIP rather than an attempted download. Attempting it made a single canvas
 * fail the ENTIRE thread read — the HTML guard fired, correctly, and the user got nothing at all for a
 * thread whose other six attachments were fine.
 */
const CANVAS_MIMETYPE = "application/vnd.slack-docs";

const READABLE_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/json": ".json",
  "application/pdf": ".pdf",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

/** An attachment scheduled for download. */
export interface PlannedDownload {
  readonly file: VisibleSlackFile;
  readonly messageTs: string;
  readonly url: string;
  /** The local basename, derived from the file id — never from Slack's `name`. */
  readonly filename: string;
}

/** An attachment deliberately not downloaded. */
export interface PlannedSkip {
  readonly file: VisibleSlackFile;
  readonly messageTs: string;
  readonly reason: FileSkipReason;
  /** The provider's own words, when the reason came from a failed call rather than a rule of ours. */
  readonly detail?: string;
}

/** The full attachment plan for a thread. */
export interface FilePlan {
  readonly downloads: readonly PlannedDownload[];
  readonly skips: readonly PlannedSkip[];
}

/**
 * Whether the model can actually read this type. `text/*` is readable generically; everything else must be
 * in the allowlist.
 *
 * @param mimetype the Slack-reported mimetype, when present
 * @returns the extension to write, or undefined when the type is not model-readable
 */
function readableExtension({ mimetype }: { mimetype: string | undefined }): string | undefined {
  if (mimetype === undefined) {
    return undefined;
  }
  const known = READABLE_EXTENSIONS[mimetype];
  if (known !== undefined) {
    return known;
  }
  return mimetype.startsWith("text/") ? ".txt" : undefined;
}

/**
 * Classify one attachment: fetch it, or skip it with a stated reason.
 *
 * @param file the projected attachment
 * @param messageTs the message it hangs off
 * @param maxBytes the per-file ceiling
 * @returns the planned download or the planned skip
 */
export function planFile({
  file,
  messageTs,
  maxBytes,
}: {
  file: VisibleSlackFile;
  messageTs: string;
  maxBytes: number;
}): PlannedDownload | PlannedSkip {
  const skip = ({ reason }: { reason: FileSkipReason }): PlannedSkip => ({ file, messageTs, reason });
  // A deleted file comes back as `{id, mode: "tombstone"}` and nothing else. Reporting it as
  // "not a type the model can read" would be a lie about why it is missing — MEASURED on a real thread
  // where 12 tombstones were being described as unreadable video.
  if (file.mode === "tombstone") {
    return skip({ reason: "deleted-from-slack" });
  }
  if (file.isExternal) {
    return skip({ reason: "external-no-bytes" });
  }
  if (file.mimetype === CANVAS_MIMETYPE) {
    return skip({ reason: "canvas-not-downloadable" });
  }
  // Slack marks a file the token cannot read; downloading it would fetch a login page, not the bytes.
  if (file.fileAccess !== undefined && file.fileAccess !== "visible") {
    return skip({ reason: "access-denied" });
  }
  const extension = readableExtension({ mimetype: file.mimetype });
  if (extension === undefined) {
    return skip({ reason: "not-model-readable" });
  }
  if (file.size !== undefined && file.size > maxBytes) {
    return skip({ reason: "over-size-cap" });
  }
  if (file.urlPrivateDownload === undefined || !FILE_ID.test(file.id)) {
    return skip({ reason: "no-download-url" });
  }
  return { file, filename: `${file.id}${extension}`, messageTs, url: file.urlPrivateDownload };
}

/**
 * Plan every attachment across a thread, top-level and block-referenced alike.
 *
 * `blockFiles` is REQUIRED and has no default. A default of "empty" would mean a caller that forgot to run
 * the `files.info` step silently produced a plan in which every block-referenced image was unretrievable,
 * with the output stating a reason that was not the real one — a lie about why something is missing, which is
 * the same defect class as omitting it. Requiring the argument makes the omission a compile error.
 *
 * Any id in `blockFileRefs` that appears in NEITHER resolution lane is still reported, as
 * `block-referenced-only`. That reconciliation is the backstop: a resolution that silently covered only some
 * of the ids would otherwise drop the rest from `files`, `skippedFiles` and `limitations` at once.
 *
 * @param messages the projected thread
 * @param blockFiles what the `files.info` step made of each `slack_file`-only reference
 * @param maxBytes the per-file ceiling (defaults to {@link DEFAULT_MAX_FILE_BYTES})
 * @returns the downloads to perform and the skips to report
 */
export function planThreadFiles({
  messages,
  blockFiles,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
}: {
  messages: readonly VisibleSlackMessage[];
  blockFiles: BlockFileResolution;
  maxBytes?: number;
}): FilePlan {
  const downloads: PlannedDownload[] = [];
  const skips: PlannedSkip[] = [];
  const place = ({ planned }: { planned: PlannedDownload | PlannedSkip }): void => {
    if ("url" in planned) {
      downloads.push(planned);
    } else {
      skips.push(planned);
    }
  };
  for (const message of messages) {
    for (const file of message.files) {
      place({ planned: planFile({ file, maxBytes, messageTs: message.ts }) });
    }
    for (const id of message.blockFileRefs) {
      place({ planned: planBlockRef({ blockFiles, fileId: id, maxBytes, messageTs: message.ts }) });
    }
  }
  return { downloads, skips };
}

/**
 * Plan one `slack_file`-only reference, from whichever lane the resolution step put it in.
 *
 * A resolved reference goes through {@link planFile} unchanged — the size cap, the canvas rule and the
 * tombstone rule all apply, because a file discovered through a block is not a different kind of file.
 *
 * @param blockFiles the resolution step's output
 * @param fileId the referenced Slack file id
 * @param messageTs the message that referenced it
 * @param maxBytes the per-file ceiling
 * @returns the planned download, or the skip that accounts for it
 */
function planBlockRef({
  blockFiles,
  fileId,
  messageTs,
  maxBytes,
}: {
  blockFiles: BlockFileResolution;
  fileId: string;
  messageTs: string;
  maxBytes: number;
}): PlannedDownload | PlannedSkip {
  const resolved = blockFiles.resolved.find((entry) => entry.messageTs === messageTs && entry.file.id === fileId);
  if (resolved !== undefined) {
    return planFile({ file: resolved.file, maxBytes, messageTs });
  }
  const failed = blockFiles.unresolved.find((entry) => entry.messageTs === messageTs && entry.fileId === fileId);
  if (failed !== undefined) {
    return { detail: failed.detail, file: { id: fileId, isExternal: false }, messageTs, reason: failed.reason };
  }
  return { file: { id: fileId, isExternal: false }, messageTs, reason: "block-referenced-only" };
}

/**
 * The scope the file lane cannot work without. `files:read` authorises both `files.info` (the Block Kit
 * resolution step) and the authenticated GET for the bytes, so one scope covers the whole attachment path.
 *
 * A list rather than a bare string because the failure this guards against is a scope set that shifts
 * underneath the code, and a list is what a diff shows changing.
 */
export const THREAD_FILE_SCOPES: readonly string[] = ["files:read"] as const;

/** What a scope check concluded about this token's ability to read attachments at all. */
export interface FileScopePreflight {
  /**
   * The scopes Slack itself reported, or `null` when they could not be established. `null` is a THIRD state,
   * never an empty list: "Slack says this token holds nothing" and "we could not ask" demand different
   * responses, and an empty array would quietly become the first.
   */
  readonly granted: readonly string[] | null;
  /** Required scopes absent from `granted`. Always empty when `granted` is null — absence of evidence is not evidence. */
  readonly missing: readonly string[];
  readonly verdict: "sufficient" | "insufficient" | "undetermined";
  /** Planned downloads this verdict puts in doubt. Zero unless the verdict is `insufficient`. */
  readonly downloadsAtRisk: number;
}

/**
 * Decide, before any byte is fetched, whether this token can read the thread's attachments. Pure.
 *
 * ## Why a preflight and not just a failure
 *
 * Without it, a token short of `files:read` produces a read that got every message and silently lost every
 * file — the exact symptom this verb exists to make impossible. Slack hands the granted set over in
 * `auth.test`'s `x-oauth-scopes` header (`corpus/slack/responseMetadata.ts#slackScopesFromMetadata` lifts it off `response_metadata.scopes`),
 * so establishing it costs one cheap call and never a speculative download.
 *
 * ## `undetermined` is not `sufficient`
 *
 * The header can lag behind a reinstall, and the call that reads it can fail. When the granted set is unknown
 * this returns `undetermined` and the downloads still go ahead — refusing to read a thread because a
 * diagnostic header was unavailable would be the worse failure. What it must not do is report that silence as
 * a clean bill of health, which is why the arm exists at all and why the renderer prints it.
 *
 * @param grantedScopes the scopes Slack reported, or undefined when they could not be established
 * @param plan the classified attachments, for the count this verdict puts at risk
 * @returns the verdict, the missing scopes, and how many planned downloads it casts doubt on
 */
export function scopePreflight({
  grantedScopes,
  plan,
}: {
  grantedScopes: readonly string[] | undefined;
  plan: FilePlan;
}): FileScopePreflight {
  if (grantedScopes === undefined) {
    return { downloadsAtRisk: 0, granted: null, missing: [], verdict: "undetermined" };
  }
  const held = new Set(grantedScopes);
  const missing = THREAD_FILE_SCOPES.filter((scope) => !held.has(scope));
  if (missing.length === 0) {
    return { downloadsAtRisk: 0, granted: grantedScopes, missing: [], verdict: "sufficient" };
  }
  return { downloadsAtRisk: plan.downloads.length, granted: grantedScopes, missing, verdict: "insufficient" };
}

/**
 * The preflight as a sentence for the `warnings` output, when it has something to say.
 *
 * @param preflight the derived verdict
 * @returns the warning, or undefined when the token demonstrably holds what the file lane needs
 */
export function describeScopePreflight({ preflight }: { preflight: FileScopePreflight }): string | undefined {
  switch (preflight.verdict) {
    case "sufficient":
      return undefined;
    case "undetermined":
      return (
        "the Slack scope set for this token could not be established, so whether attachments are readable " +
        "was NOT verified before this read; a file lost to a missing scope would look the same as no file"
      );
    case "insufficient":
      return (
        `this token is missing the Slack scope(s) ${preflight.missing.join(", ")}, which the file lane needs; ` +
        `${String(preflight.downloadsAtRisk)} attachment(s) were NOT downloaded for that reason. ` +
        "Grant the scope through the install flow and re-read — do not paste an app manifest, which applies " +
        "whole and would revoke every scope it omits"
      );
  }
}

/**
 * A human sentence for one skip class, used in the `limitations` output.
 *
 * @param reason the skip class
 * @param count how many attachments fell into it
 * @returns the sentence to print
 */
export function describeSkips({ reason, count }: { reason: FileSkipReason; count: number }): string {
  const n = String(count);
  const plural = count === 1 ? "file" : "files";
  const reasons: Readonly<Record<FileSkipReason, string>> = {
    "access-denied": `${n} ${plural} not retrieved: this token cannot read them`,
    "block-lookup-failed": `${n} ${plural} referenced only inside Block Kit not retrieved: files.info could not resolve the id to a download URL (see \`detail\`)`,
    "block-referenced-only": `${n} ${plural} referenced only inside Block Kit not retrieved: nothing was looked up for the id, so no reason can be given`,
    "canvas-not-downloadable": `${n} Slack canvas${count === 1 ? "" : "es"} not retrieved: Slack does not serve canvas content as file bytes`,
    "deleted-from-slack": `${n} ${plural} not retrieved: deleted from Slack, so no bytes exist any more`,
    "external-no-bytes": `${n} ${plural} not retrieved: externally hosted, no Slack bytes exist`,
    "no-download-url": `${n} ${plural} not retrieved: Slack supplied no download URL`,
    "not-model-readable": `${n} ${plural} not retrieved: not a type the model can read (video/audio/binary)`,
    "over-size-cap": `${n} ${plural} not retrieved: larger than the per-file size cap`,
  };
  return reasons[reason];
}
