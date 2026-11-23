/**
 * Slack attachment bytes. The ONE place this program performs a raw authenticated HTTP GET.
 *
 * ## Why it is not an SDK call
 *
 * `@slack/web-api` v8 has no method that returns file bytes — its file surface is `files.info`,
 * `files.list`, `files.delete`, `files.comments.*` and the two upload methods. Bytes live behind
 * `url_private_download`, which needs an `Authorization: Bearer` header. So the house rule "official SDK,
 * never ad-hoc transport" cannot be satisfied literally here; what it CAN be held to is that the call still
 * goes through `safeProviderCall`, so it shares the 429 block, the attempt budget and the tier3 pacing that
 * every other Slack call obeys.
 *
 * ## Why HTTP 200 is not success
 *
 * An unauthorised Slack file URL does not reliably 401 — it can serve a 200 HTML sign-in page. Saved
 * blindly, that produces a file called `diagram.png` containing a login form, and the model then reports
 * an unreadable image instead of a failure. So a response is only accepted when it is a 2xx AND its
 * content type is not HTML AND, when Slack told us the size, the bytes received agree with it.
 *
 * ## Why the token is not forwarded on redirect
 *
 * `redirect: "manual"` and an explicit host allowlist: a redirect to a non-Slack host must never receive
 * the bearer token. That is a credential-exfiltration primitive, and `fetch`'s default follow behaviour
 * would replay the header.
 *
 * The hop is FOLLOWED, though, with the credential dropped when the target is not a Slack file host — and
 * that distinction is the whole point. Refusing to follow at all was the original behaviour and it was too
 * blunt: measured, `files.slack.com/files-pri/<team>-<file>/download/…` answers **302** for a
 * huddle transcript, so "never follow" meant "cannot read a huddle transcript at all". A signed
 * redirect target authenticates itself in its own query string; sending a bearer token there adds nothing
 * and risks everything, so the token is dropped rather than the hop.
 */

import { once } from "node:events";
import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";

import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackFileDownloadError, SlackFileDownloadErrors } from "./downloadErrors.js";

/** Where a downloaded attachment ended up, and how much of it arrived. */
export interface DownloadedBytes {
  readonly localPath: string;
  readonly bytes: number;
}

/** The injected download seam, so the orchestration is testable with a plain fake. */
export type DownloadFile = (args: {
  url: string;
  filename: string;
  destinationDir: string;
  token: string;
  expectedBytes: number | undefined;
  /** The most the caller will take: past it the transfer is cancelled mid-stream and nothing is kept. */
  maxBytes?: number;
}) => Promise<Result<DownloadedBytes, SlackFileDownloadError>>;

/** Only these hosts ever receive the bearer token. */
function isSlackFileHost({ url }: { url: URL }): boolean {
  return url.protocol === "https:" && (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"));
}

/**
 * Reject a response that is not actually the file: a non-2xx, a redirect we will not follow with a
 * credential, or an HTML page where bytes were expected.
 *
 * @param response the fetch response
 * @param hops the redirect trail already walked, named in the message so a wrong landing is visible
 * @returns the failure message, or undefined when the response carries real bytes
 */
function responseRejection({ response, hops }: { response: Response; hops: readonly string[] }): string | undefined {
  if (!response.ok) {
    return `Slack returned HTTP ${String(response.status)} for the file`;
  }
  const contentType = response.headers.get("content-type");
  // The sign-in page is the dangerous case: HTTP 200, HTML body, a filename that looks like an image.
  //
  // The final HOST is named rather than left to be guessed, because after a redirect walk "the token is
  // probably not authorised" is only one of two explanations and the other one — the walk ended somewhere
  // that was never going to serve bytes — is invisible without it.
  if (contentType?.includes("text/html") === true) {
    const trail = hops.length === 0 ? "" : ` after ${hops.join(", ")}`;
    return `Slack served HTML rather than file bytes from ${hostOf({ url: response.url })}${trail} (the token is probably not authorised for it)`;
  }
  return undefined;
}

/** The host of a URL string, or the string itself when it will not parse — a message helper, never a guard. */
function hostOf({ url }: { url: string }): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Download one Slack attachment to disk.
 *
 * @param url the `url_private_download` Slack supplied
 * @param filename the local basename (derived from the file id, never from the remote name)
 * @param destinationDir the directory to write into
 * @param token the Slack token authorised for the file
 * @param expectedBytes Slack's reported size, when known
 * @param maxBytes the ceiling past which the transfer is cancelled, when the caller sets one
 * @returns where it landed and how many bytes arrived, or `err` naming what went wrong
 */
export const downloadSlackFile: DownloadFile = async ({
  url,
  filename,
  destinationDir,
  token,
  expectedBytes,
  maxBytes,
}): Promise<Result<DownloadedBytes, SlackFileDownloadError>> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(SlackFileDownloadErrors.invalidUrl({ url }));
  }
  if (!isSlackFileHost({ url: parsed })) {
    return err(SlackFileDownloadErrors.untrustedHost({ hostname: parsed.hostname }));
  }
  const localPath = join(destinationDir, filename);
  const fetched = await fetchFollowingRedirects({ filename, token, url: parsed });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  return writeBody({
    expectedBytes,
    filename,
    hops: fetched.value.hops,
    localPath,
    maxBytes,
    response: fetched.value.response,
  });
};

/**
 * How many redirect hops to follow. Slack uses ONE today (`files-pri` → a signed edge URL); the budget is
 * three so a second hop Slack adds does not break every download, and finite so a redirect cycle terminates
 * as a named failure rather than as a hang.
 */
const MAX_REDIRECT_HOPS = 3;

/**
 * GET the file, following Slack's own redirect to wherever it actually serves the bytes from — carrying the
 * bearer token to a Slack file host and NEVER to anything else.
 *
 * @param url the already-validated Slack file URL
 * @param token the Slack token authorised for the file
 * @param filename the local basename, for messages
 * @returns the final response, or `err` naming what stopped the walk
 */
async function fetchFollowingRedirects({
  url,
  token,
  filename,
}: {
  url: URL;
  token: string;
  filename: string;
}): Promise<Result<{ response: Response; hops: readonly string[] }, SlackFileDownloadError>> {
  let target = url;
  const hops: string[] = [];
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    // The credential goes to a Slack file host and nowhere else. A signed redirect target carries its own
    // authorisation in its query string, so dropping the header costs nothing and closes the exfiltration.
    const authorised = isSlackFileHost({ url: target });
    const currentTarget = target;
    const fetched = await safeProviderCall({
      // devlint: raw-http -- Slack serves file bytes only over url_private; see the module header.
      execute: () =>
        fetch(currentTarget, {
          headers: authorised ? { authorization: `Bearer ${token}` } : {},
          redirect: "manual",
        }),
      operation: "slack.files.download",
      provider: "slack",
      retryMode: "transient",
      scopeId: scopeIdForToken({ token }),
    });
    if (fetched.isErr()) {
      return err(
        SlackFileDownloadErrors.transportFailed({ cause: fetched.error, filename, reason: fetched.error.message }),
      );
    }
    const response = fetched.value;
    if (response.status < 300 || response.status >= 400) {
      return ok({ hops, response });
    }
    const next = redirectTarget({ from: currentTarget, response });
    if (next === undefined) {
      return err(
        SlackFileDownloadErrors.redirectUnusable({
          filename,
          reason: `HTTP ${String(response.status)} with no usable https Location header`,
        }),
      );
    }
    hops.push(`${String(response.status)} → ${next.host}${next.pathname}`);
    target = next;
  }
  return err(
    SlackFileDownloadErrors.redirectUnusable({
      filename,
      reason: `more than ${String(MAX_REDIRECT_HOPS)} redirects`,
    }),
  );
}

/**
 * The next URL of a redirect response, resolved against the URL that produced it.
 *
 * @param response the 3xx response
 * @param from the URL that was requested, so a relative `Location` resolves
 * @returns the next https target, or undefined when there is no usable one
 *
 * @internal — exported for its own unit test; the download walk is the only caller.
 */
export function redirectTarget({ response, from }: { response: Response; from: URL }): URL | undefined {
  const location = response.headers.get("location");
  if (location === null || location.length === 0) {
    return undefined;
  }
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return undefined;
  }
  return next.protocol === "https:" ? next : undefined;
}

/**
 * Stream the response body to disk chunk by chunk, honouring backpressure and counting bytes as they
 * land. Streaming rather than buffering matters at this size: the largest measured attachment in the real
 * workspace is 213.7 MB, and holding one in memory to write it out is how a read verb causes an OOM.
 *
 * With a `maxBytes`, the chunk that would carry the file past it is never written: the body is cancelled there, so
 * a huge or endless response costs at most that many bytes on disk, and the count returned exceeds the ceiling so
 * the caller can tell.
 *
 * @param body the response stream
 * @param localPath the absolute destination
 * @param maxBytes the ceiling past which the body is cancelled rather than written
 * @returns the number of bytes received, which is more than `maxBytes` exactly when the body was cancelled
 */
export async function streamToFile({
  body,
  localPath,
  maxBytes,
}: {
  body: ReadableStream<Uint8Array>;
  localPath: string;
  maxBytes?: number;
}): Promise<number> {
  // 0600: these are unredacted Slack attachments, owner-only like every other private artefact here.
  //
  // O_NOFOLLOW is the load-bearing flag, not decoration. The basename is derived from a Slack-controlled
  // file id, and `createWriteStream`'s default open FOLLOWS a symlink — so a pre-placed symlink at
  // `<thread-dir>/<id>.<ext>` would redirect the write anywhere the process can reach, truncating the
  // target. Opening with O_NOFOLLOW fails with ELOOP instead. O_TRUNC keeps a re-read of the same thread
  // idempotent, which a plain `wx` would not.
  const handle = await open(
    localPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  const sink = handle.createWriteStream();
  const reader = body.getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      written += value.byteLength;
      if (maxBytes !== undefined && written > maxBytes) {
        await reader.cancel();
        break;
      }
      if (!sink.write(value)) {
        await once(sink, "drain");
      }
    }
  } finally {
    sink.end();
  }
  await once(sink, "finish");
  return written;
}

/**
 * Stream a validated response to disk, removing a partial file rather than leaving a truncated one.
 *
 * @param response the validated fetch response
 * @param localPath the absolute destination
 * @param filename the basename, for messages
 * @param expectedBytes Slack's reported size, when known
 * @param hops the redirect trail walked to reach this response
 * @param maxBytes the ceiling past which nothing is kept, when the caller sets one
 * @returns the written size, or `err`
 */
async function writeBody({
  response,
  localPath,
  filename,
  expectedBytes,
  hops,
  maxBytes,
}: {
  response: Response;
  localPath: string;
  filename: string;
  expectedBytes: number | undefined;
  hops: readonly string[];
  maxBytes: number | undefined;
}): Promise<Result<DownloadedBytes, SlackFileDownloadError>> {
  const rejection = responseRejection({ hops, response });
  if (rejection !== undefined) {
    return err(SlackFileDownloadErrors.responseRejected({ filename, reason: rejection }));
  }
  if (response.body === null) {
    return err(SlackFileDownloadErrors.emptyBody({ filename }));
  }
  // A declared length past the ceiling is refused before a byte is written; an undeclared or lying one is caught
  // mid-stream below.
  const declared = Number(response.headers.get("content-length"));
  if (maxBytes !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    return err(SlackFileDownloadErrors.tooLarge({ filename, maxBytes }));
  }
  let written = 0;
  try {
    written = await streamToFile({ body: response.body, localPath, ...(maxBytes === undefined ? {} : { maxBytes }) });
  } catch (error: unknown) {
    await rm(localPath, { force: true });
    return err(SlackFileDownloadErrors.writeFailed({ cause: error, filename }));
  }
  if (maxBytes !== undefined && written > maxBytes) {
    await rm(localPath, { force: true });
    return err(SlackFileDownloadErrors.tooLarge({ filename, maxBytes }));
  }
  if (expectedBytes !== undefined && written !== expectedBytes) {
    // A short read that still "succeeded" is exactly the silent truncation this verb must never do.
    await rm(localPath, { force: true });
    return err(SlackFileDownloadErrors.sizeMismatch({ expectedBytes, filename, receivedBytes: written }));
  }
  return ok({ bytes: written, localPath });
}
