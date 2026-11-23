/**
 * The attachment domain's own typed error union — `github attach`'s failures, and nothing else's.
 *
 * This domain earns a union rather than the default `readonly string[]` because callers genuinely branch:
 * an unreadable browser session is a setup fix, an EXPIRED one looks identical to a missing scrape target
 * until you know which it is, and an over-limit file is refused locally before any byte leaves the machine.
 * Three different corrections, so three different codes.
 *
 * The split between {@link WebSessionMissingError} and {@link WebSessionExpiredError} is the one worth
 * naming. Both point at the owner's own browser, but only the second one means the cookies were read and
 * SENT and GitHub still answered anonymously — which the upload path can learn no other way, because
 * cookies that parse fine still yield an unauthenticated HTML page once they lapse. Collapsing them would
 * make "you are signed out of github.com in Chrome" report as "this machine was never set up", which sends
 * the reader to a settings file instead of to a browser tab.
 */

import { doorRefusalLines } from "../../admit/doorRefusal.js";
import type { DoorDecision } from "../../admit/types.js";

/** There is no session to read — no Chrome profile is recorded, or the recorded one does not resolve. */
export interface WebSessionMissingError {
  readonly code: "WEB_SESSION_MISSING";
  readonly message: string;
  readonly path: string;
}

/** The browser was read but carries no usable github.com session cookie. */
export interface WebSessionUnreadableError {
  readonly code: "WEB_SESSION_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The session is signed in to GitHub but not SAML-authorised for the organisation that owns the repo. */
export interface OrgSsoRequiredError {
  readonly code: "ORG_SSO_REQUIRED";
  readonly message: string;
  readonly url: string;
}

/** The org sign-on was asked for and the grant never landed inside the wait. */
export interface OrgSsoNotGrantedError {
  readonly code: "ORG_SSO_NOT_GRANTED";
  readonly message: string;
  readonly org: string;
}

/** The browser's cookies were read and sent, and GitHub answered as an anonymous visitor. */
export interface WebSessionExpiredError {
  readonly code: "WEB_SESSION_EXPIRED";
  readonly message: string;
  readonly path: string;
  /** The page that answered anonymously. */
  readonly url: string;
}

/** The file's extension maps to no content type GitHub's own comment box accepts. */
export interface UnsupportedMediaError {
  readonly code: "UNSUPPORTED_MEDIA";
  readonly message: string;
  readonly extension: string;
}

/** The file is larger than the measured ceiling for its content type — refused before any network call. */
export interface FileTooLargeError {
  readonly code: "FILE_TOO_LARGE";
  readonly message: string;
  readonly byteLength: number;
  readonly limitBytes: number;
  readonly contentType: string;
}

/** The local file could not be read at all. */
export interface FileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A page this pipeline reads could not be fetched, or came back as something other than 200. */
export interface PageUnreadableError {
  readonly code: "PAGE_UNREADABLE";
  readonly message: string;
  readonly url: string;
  readonly status: number;
}

/** The page loaded but rendered no assets upload region — a changed GitHub page shape. */
export interface ScrapeFailedError {
  readonly code: "SCRAPE_FAILED";
  readonly message: string;
  readonly url: string;
  readonly missing: readonly string[];
}

/** GitHub's policy endpoint refused the upload — its own message is carried verbatim. */
export interface PolicyRefusedError {
  readonly code: "POLICY_REFUSED";
  readonly message: string;
  readonly status: number;
}

/** The presigned bucket refused the bytes. */
export interface BytesRefusedError {
  readonly code: "BYTES_REFUSED";
  readonly message: string;
  readonly status: number;
  readonly detail: string;
}

/** GitHub refused to finalize an asset whose bytes it had already accepted. */
export interface FinalizeRefusedError {
  readonly code: "FINALIZE_REFUSED";
  readonly message: string;
  readonly status: number;
  readonly assetId: number;
}

/** The file's bytes carry a dead Datadog console host (`../invalidDatadogHost.ts`) — refused before any call. */
export interface DeadDatadogHostError {
  readonly code: "DEAD_DATADOG_HOST";
  readonly message: string;
}

/** The admit door did not pass the write, so nothing was sent; `message` is the door's whole refusal. */
export interface DoorRefusedError {
  readonly code: "DOOR_REFUSED";
  readonly message: string;
  readonly decision: DoorDecision;
}

/** The door passed the write but its decision could not be recorded, so nothing was sent; `message` says why. */
export interface DoorRecordingRefusedError {
  readonly code: "DOOR_RECORDING_REFUSED";
  readonly message: string;
}

/** The request never completed — DNS, TLS, a socket, an abort. */
export interface AttachTransportError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly url: string;
  readonly cause?: unknown;
}

/** The uploaded asset could not be fetched back from GitHub, so what GitHub serves is unverified. */
export interface ReadBackFailedError {
  readonly code: "READ_BACK_FAILED";
  readonly message: string;
  readonly href: string;
}

/** GitHub served back bytes that are not the bytes sent, so the asset is not safe to embed. */
export interface ReadBackMismatchError {
  readonly code: "READ_BACK_MISMATCH";
  readonly message: string;
  readonly href: string;
  readonly sentDigest: string;
  readonly servedDigest: string;
}

/** The upload was verified but its receipt could not be written, so no description can cite it. */
export interface UploadReceiptFailedError {
  readonly code: "UPLOAD_RECEIPT_FAILED";
  readonly message: string;
  readonly href: string;
}

/** An upload receipt a description cites could not be read or believed. */
export interface UploadReceiptUnreadableError {
  readonly code: "UPLOAD_RECEIPT_UNREADABLE";
  readonly message: string;
  readonly uploadReceiptId: string;
}

/** Every way `github attach` can fail. */
export type GithubAttachError =
  | WebSessionMissingError
  | WebSessionUnreadableError
  | WebSessionExpiredError
  | OrgSsoRequiredError
  | OrgSsoNotGrantedError
  | UnsupportedMediaError
  | FileTooLargeError
  | FileUnreadableError
  | PageUnreadableError
  | ScrapeFailedError
  | PolicyRefusedError
  | BytesRefusedError
  | FinalizeRefusedError
  | DoorRefusedError
  | DoorRecordingRefusedError
  | DeadDatadogHostError
  | AttachTransportError
  | ReadBackFailedError
  | ReadBackMismatchError
  | UploadReceiptFailedError
  | UploadReceiptUnreadableError;

/** Render a byte count the way the measured limits read, so a refusal and its ceiling are comparable. */
function mib({ bytes }: { bytes: number }): string {
  return `${(bytes / 1048576).toFixed(2)} MiB`;
}

/** The factory every construction site uses — the real code's own path, so a test built on it stays true. */
export const GithubAttachErrors = {
  bytesRefused: ({ status, detail }: { status: number; detail: string }): BytesRefusedError => ({
    code: "BYTES_REFUSED",
    detail,
    message: `the presigned bucket refused the bytes with HTTP ${String(status)} (expected 204): ${detail}`,
    status,
  }),
  deadDatadogHost: ({ refusal }: { refusal: readonly string[] }): DeadDatadogHostError => ({
    code: "DEAD_DATADOG_HOST",
    message: refusal.join("\n"),
  }),
  doorRecordingRefused: ({ message }: { message: string }): DoorRecordingRefusedError => ({
    code: "DOOR_RECORDING_REFUSED",
    message: `slopweaver github attach upload not performed: ${message}`,
  }),
  doorRefused: ({ decision }: { decision: DoorDecision }): DoorRefusedError => ({
    code: "DOOR_REFUSED",
    decision,
    message: doorRefusalLines({ command: "slopweaver github attach upload", decision }).join("\n"),
  }),
  fileTooLarge: ({
    byteLength,
    limitBytes,
    contentType,
  }: {
    byteLength: number;
    limitBytes: number;
    contentType: string;
  }): FileTooLargeError => ({
    byteLength,
    code: "FILE_TOO_LARGE",
    contentType,
    limitBytes,
    message:
      `${mib({ bytes: byteLength })} exceeds GitHub's measured ceiling of ${mib({ bytes: limitBytes })} ` +
      `for ${contentType} — refused locally, nothing was uploaded`,
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: unknown }): FileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  finalizeRefused: ({ status, assetId }: { status: number; assetId: number }): FinalizeRefusedError => ({
    assetId,
    code: "FINALIZE_REFUSED",
    message:
      `GitHub accepted the bytes but refused to finalize asset ${String(assetId)} with HTTP ` +
      `${String(status)} — the asset URL is not safe to embed`,
    status,
  }),
  orgSsoRequired: ({ url }: { url: string }): OrgSsoRequiredError => ({
    code: "ORG_SSO_REQUIRED",
    message:
      `${url} answered with GitHub's single-sign-on wall — the saved session is signed in but NOT ` +
      `SAML-authorised for this organisation. Org SSO is a separate grant, not a shorter clock on the ` +
      `session, so signing in again may not fix it. Authorise the org in your own Chrome, then confirm the ` +
      `grant with \`slopweaver github attach status --org <org>\` before uploading again`,
    url,
  }),
  orgSsoNotGranted: ({ org, waitedMs }: { org: string; waitedMs: number }): OrgSsoNotGrantedError => ({
    code: "ORG_SSO_NOT_GRANTED",
    message:
      `the sign-on for ${org} was opened in a visible browser and did not complete within ` +
      `${String(Math.round(waitedMs / 60000))} minute(s) — the session is still NOT authorised for that ` +
      `organisation, so uploads to its repositories will keep hitting the wall. Finish the sign-on in the ` +
      `browser and confirm it with \`slopweaver github attach status --org ${org}\``,
    org,
  }),
  pageUnreadable: ({ url, status }: { url: string; status: number }): PageUnreadableError => ({
    code: "PAGE_UNREADABLE",
    message: `${url} answered HTTP ${String(status)} — check the repository and number are right`,
    status,
    url,
  }),
  tokenPageUnreadable: ({
    url,
    status,
    pullPage,
  }: {
    url: string;
    status: number;
    pullPage: string;
  }): PageUnreadableError => ({
    code: "PAGE_UNREADABLE",
    message:
      `${url} answered HTTP ${String(status)} — ${pullPage} rendered no upload region (an issue never ` +
      `does), so the token was sought on the repository's new-release form. GitHub answers 404 there ` +
      `both for a wrong repository and for an account that cannot push to it; pass a pull-request number, ` +
      `or check the repository and this account's write access`,
    status,
    url,
  }),
  readBackFailed: ({ href, detail }: { href: string; detail: string }): ReadBackFailedError => ({
    code: "READ_BACK_FAILED",
    href,
    message: `${href} was uploaded but could not be fetched back (${detail}), so it is unverified — do not embed it`,
  }),
  readBackMismatch: (found: { href: string; sentDigest: string; servedDigest: string }): ReadBackMismatchError => ({
    ...found,
    code: "READ_BACK_MISMATCH",
    message: `${found.href} serves ${found.servedDigest}, not the ${found.sentDigest} that was sent — do not embed it`,
  }),
  uploadReceiptFailed: ({ href, cause }: { href: string; cause: unknown }): UploadReceiptFailedError => ({
    code: "UPLOAD_RECEIPT_FAILED",
    href,
    message:
      `${href} was uploaded and verified, but its receipt could not be written ` +
      `(${cause instanceof Error ? cause.message : String(cause)}) — a description cannot cite it`,
  }),
  uploadReceiptUnreadable: (found: { uploadReceiptId: string; detail: string }): UploadReceiptUnreadableError => ({
    code: "UPLOAD_RECEIPT_UNREADABLE",
    message: `upload receipt ${found.uploadReceiptId} cannot be believed: ${found.detail}`,
    uploadReceiptId: found.uploadReceiptId,
  }),
  policyRefused: ({ status, detail }: { status: number; detail: string }): PolicyRefusedError => ({
    code: "POLICY_REFUSED",
    message: `GitHub refused the upload policy (HTTP ${String(status)}): ${detail}`,
    status,
  }),
  scrapeFailed: ({ url, missing }: { url: string; missing: readonly string[] }): ScrapeFailedError => ({
    code: "SCRAPE_FAILED",
    message:
      `${url} rendered no assets upload region — missing ${missing.join(" and ")}. GitHub has changed ` +
      `the page's shape: find a page that still renders <file-attachment data-upload-policy-url=` +
      `"/upload/policies/assets"> and add it to uploadTokenPageUrls`,
    missing,
    url,
  }),
  transportFailed: ({ url, cause }: { url: string; cause: unknown }): AttachTransportError => ({
    cause,
    code: "TRANSPORT_FAILED",
    message: `request to ${url} did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
    url,
  }),
  unsupportedMedia: ({ extension }: { extension: string }): UnsupportedMediaError => ({
    code: "UNSUPPORTED_MEDIA",
    extension,
    message:
      `${extension === "" ? "a file with no extension" : extension} is not a media type GitHub's comment ` +
      `box accepts — attach a png, jpg, gif, webp, svg, mp4, mov or webm`,
  }),
  webSessionExpired: ({ path, url }: { path: string; url: string }): WebSessionExpiredError => ({
    code: "WEB_SESSION_EXPIRED",
    message: `${url} answered the cookies from ${path} as an anonymous visitor — sign in to github.com in your own Chrome`,
    path,
    url,
  }),
  webSessionMissing: ({ path }: { path: string }): WebSessionMissingError => ({
    code: "WEB_SESSION_MISSING",
    message: `there is no GitHub session to read: ${path}`,
    path,
  }),
  webSessionUnreadable: ({ path, detail }: { path: string; detail: string }): WebSessionUnreadableError => ({
    code: "WEB_SESSION_UNREADABLE",
    message: `the GitHub session in ${path} is unusable: ${detail}`,
    path,
  }),
} as const;
