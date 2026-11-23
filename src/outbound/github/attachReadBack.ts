/**
 * Fetch an uploaded attachment back from GitHub and require it to be the bytes that were sent.
 *
 * ## Why an upload is not done when GitHub says 200
 *
 * The finalize call answers with an asset address, and nothing in that answer proves what the address SERVES. A
 * re-encode, a truncated upload, a policy that swapped the object — each would leave a description embedding
 * something other than the picture that was checked. So the asset is fetched back and its digest compared with the
 * digest of the bytes sent, and only a match earns an upload receipt (`./attachReceipt.ts`).
 *
 * ## Two hops, and the cookie goes only to the first
 *
 * `github.com/user-attachments/assets/<id>` answers the signed-in owner with a redirect to a signed address on an
 * asset host. The cookie is sent to github.com and NOWHERE else: the first address must be exactly that shape before
 * anything is fetched, the redirect is read by hand rather than followed, its host must be one of
 * `GITHUB_READ_BACK_REDIRECT_HOSTS`, and the second request carries no cookie. The signed address carries a token, so
 * a refusal names its host, never the address.
 *
 * The redirect GitHub actually answers an upload's read-back with goes to its own S3 asset bucket, MEASURED on
 * a PRIVATE repository: the read-back of a real upload was refused naming
 * `https://github-production-user-asset-6210df.s3.amazonaws.com`, and once that host was trusted a real upload read
 * back through it served the sent bytes. Repro: `slopweaver github attach upload --file <capture.png> --repo
 * <owner/name> --number <n> --proves "<line>"`. The signed `githubusercontent.com` hosts the rendered-media reader
 * (`../../live/github/media.ts`) sees in a body stay trusted too, and so does a direct 200 from the asset address,
 * neither of which this measurement saw.
 */
import { err, ok, type Result } from "#lib/result.js";
import { imageDigestOf } from "../../visualEvidence/imageIo.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";
import { isUserAttachmentUrl } from "./formHosting.js";

/**
 * GitHub's own S3 bucket for user attachments, the host an uploaded asset's address redirected its read-back to.
 * Pinned exactly, as the redirect named it: never a pattern over `amazonaws.com`, because any bucket there can be
 * anybody's.
 */
export const GITHUB_USER_ASSET_BUCKET_HOST = "github-production-user-asset-6210df.s3.amazonaws.com";

/**
 * Every host the asset address may redirect a read-back to, exactly: the signed attachment hosts a rendered body
 * serves an attachment from, and GitHub's own asset bucket the measured redirect named. Spelled out rather than built
 * from `GITHUB_ATTACHMENT_HOSTS` (`../../live/github/media.ts`), which decides which `<img src>` in a RENDERED body is
 * an attachment: a widening there must never widen what a read-back trusts.
 */
const GITHUB_READ_BACK_REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  GITHUB_USER_ASSET_BUCKET_HOST,
]);

/** The authority exactly as a `Location` spells it, before URL parsing lowercases it and drops a default port. */
const RAW_HTTPS_AUTHORITY = /^https:\/\/([^/?#]*)/;

/** One response to an asset fetch: the status, the redirect target when there is one, and the body on demand. */
export interface AttachAssetResponse {
  readonly status: number;
  readonly location: string | null;
  readonly bytes: () => Promise<Uint8Array>;
}

/** The read-back transport: one GET, redirects NOT followed, the cookie only when given. */
export type AttachAssetFetch = (args: {
  readonly url: string;
  readonly cookieHeader: string | undefined;
}) => Promise<AttachAssetResponse>;

/**
 * The production read-back transport over the platform's `fetch`, with redirects left to the caller.
 *
 * @returns the transport
 */
export function productionAttachAssetFetch(): AttachAssetFetch {
  return async ({ url, cookieHeader }) => {
    const response = await fetch(url, {
      headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
      method: "GET",
      redirect: "manual",
    });
    return {
      bytes: async () => new Uint8Array(await response.arrayBuffer()),
      location: response.headers.get("location"),
      status: response.status,
    };
  };
}

/**
 * Why a redirect target is not an attachment host this module will fetch from, or `null` when it is.
 *
 * The host is judged twice: parsed, against the exact list, and as SPELLED, because parsing lowercases a host and
 * erases userinfo's separator, a default `:443` and surrounding whitespace. Only a `Location` whose raw authority is
 * the bare lowercase host passes, so nothing normalisation hides can reach the second fetch.
 *
 * @param location the `Location` header GitHub answered with
 * @returns the reason, naming only the host, or `null`
 */
export function readBackRedirectProblem({ location }: { location: string | null }): string | null {
  if (location === null) {
    return "the redirect carried no Location";
  }
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return "the redirect's Location is not an absolute address";
  }
  if (parsed.protocol !== "https:" || !GITHUB_READ_BACK_REDIRECT_HOSTS.has(parsed.hostname)) {
    return `the redirect points at ${parsed.protocol}//${parsed.hostname}, not a GitHub attachment host`;
  }
  if (RAW_HTTPS_AUTHORITY.exec(location)?.[1] !== parsed.hostname) {
    return `the redirect to ${parsed.hostname} is not spelled as the bare host, so it is not a GitHub asset address`;
  }
  return null;
}

/** Run one fetch, turning a throw into the read-back failure it is. */
async function fetchOnce({
  fetchAsset,
  url,
  cookieHeader,
  href,
}: {
  fetchAsset: AttachAssetFetch;
  url: string;
  cookieHeader: string | undefined;
  href: string;
}): Promise<Result<AttachAssetResponse, GithubAttachError>> {
  try {
    return ok(await fetchAsset({ cookieHeader, url }));
  } catch (cause) {
    return err(
      GithubAttachErrors.readBackFailed({ detail: cause instanceof Error ? cause.message : String(cause), href }),
    );
  }
}

/**
 * Fetch an uploaded asset back, cookie to github.com only, and hand back the bytes it serves.
 *
 * @param href the asset address the finalize call returned
 * @param cookieHeader the owner's github.com session, sent to the first hop alone
 * @param fetchAsset the read-back transport
 * @returns the served bytes, or why they could not be fetched
 */
export async function readBackAsset({
  href,
  cookieHeader,
  fetchAsset,
}: {
  href: string;
  cookieHeader: string;
  fetchAsset: AttachAssetFetch;
}): Promise<Result<Uint8Array, GithubAttachError>> {
  if (!isUserAttachmentUrl({ url: href })) {
    const detail = "the asset address is not https://github.com/user-attachments/assets/<id>, so no cookie goes to it";
    return err(GithubAttachErrors.readBackFailed({ detail, href }));
  }
  const first = await fetchOnce({ cookieHeader, fetchAsset, href, url: href });
  if (first.isErr()) {
    return err(first.error);
  }
  let served = first.value;
  if (served.status >= 300 && served.status < 400) {
    const problem = readBackRedirectProblem({ location: served.location });
    if (problem !== null) {
      return err(GithubAttachErrors.readBackFailed({ detail: problem, href }));
    }
    const second = await fetchOnce({ cookieHeader: undefined, fetchAsset, href, url: served.location! });
    if (second.isErr()) {
      return err(second.error);
    }
    served = second.value;
  }
  if (served.status !== 200) {
    return err(GithubAttachErrors.readBackFailed({ detail: `HTTP ${String(served.status)}`, href }));
  }
  try {
    return ok(await served.bytes());
  } catch (cause) {
    return err(
      GithubAttachErrors.readBackFailed({ detail: cause instanceof Error ? cause.message : String(cause), href }),
    );
  }
}

/**
 * Whether the served bytes are the sent bytes, as the refusal when they are not.
 *
 * @param href the asset address, for the refusal
 * @param sentDigest the digest of the bytes uploaded
 * @param served the bytes GitHub served back
 * @returns the served bytes' digest, or the mismatch refusal
 */
export function readBackVerdict({
  href,
  sentDigest,
  served,
}: {
  href: string;
  sentDigest: string;
  served: Uint8Array;
}): Result<string, GithubAttachError> {
  const servedDigest = imageDigestOf({ bytes: served });
  if (servedDigest !== sentDigest) {
    return err(GithubAttachErrors.readBackMismatch({ href, sentDigest, servedDigest }));
  }
  return ok(servedDigest);
}
