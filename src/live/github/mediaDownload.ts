/**
 * Download the attachments `./media.ts` named and write them where the caller asked — the effectful half.
 *
 * Every effect is a seam: the HTTP request, the fetch built over it and the write. So every property this module
 * owns — what is refused, what is named where, that a signed address never reaches a message — is pinned by a
 * unit test with plain fakes, and the request seam takes an address and NOTHING ELSE, so no credential can be
 * handed to an attachment host by construction. The signed address carries its own token; replaying the API
 * token to an asset host is what `../linear/assetFetch.ts` was written to avoid too.
 *
 * A redirect is refused, never followed: an attachment host that answered somewhere else would be asking this
 * process to carry a signed request to a host nobody chose.
 *
 * Candidates are fetched in document order and the first failure stops the run. Files written before it stay on
 * disk: this is not a multi-file transaction, and the failure names which one stopped it.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import type { ProviderReadMedia } from "../providerRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import {
  bareContentType,
  GITHUB_ATTACHMENT_HOSTS,
  type GithubRenderedMediaCandidate,
  githubMediaFileName,
} from "./media.js";

/**
 * The most bytes one attachment may be. GitHub's own ceiling for an uploaded video
 * (`../../outbound/github/attachment.ts`, `limitBytes: 104857600`), so nothing GitHub serves as an attachment is
 * refused while a runaway response still is. Exactly this many bytes is allowed.
 */
const GITHUB_MEDIA_BYTES_MAX = 104_857_600;

/** What an attachment host answered: the body's bytes and the content type it named them as. */
interface GithubFetchedMedia {
  readonly bytes: Buffer;
  readonly contentType: string | undefined;
}

/** The raw request seam. It is given the address alone, so it has nowhere to put a credential. */
export type GithubMediaHttpRequest = (args: { url: string }) => Promise<Response>;

/** The fetch seam: one attachment's bytes, or a failure that never carries its signing query. */
export type GithubMediaFetch = (args: { url: string }) => Promise<Result<GithubFetchedMedia, GithubLiveError>>;

/** The write seam: one attachment's bytes to one path. */
export type GithubMediaWrite = (args: { path: string; bytes: Buffer }) => Result<true, GithubLiveError>;

/** The whole download, as `readGithubObject` is handed it. */
export type GithubMediaDownload = (args: {
  candidates: readonly GithubRenderedMediaCandidate[];
}) => Promise<Result<readonly ProviderReadMedia[], GithubLiveError>>;

/** True when `url` is absolute https on an exact attachment host — checked again right before a request. */
function onAttachmentHost({ url }: { url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return parsed.protocol === "https:" && GITHUB_ATTACHMENT_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Read a response body chunk by chunk, stopping as soon as it passes `maxBytes`, so a runaway body is never
 * held whole. Undefined when it passed.
 */
async function boundedBody({
  response,
  maxBytes,
}: {
  response: Response;
  maxBytes: number;
}): Promise<Buffer | undefined> {
  if (response.body === null) {
    return Buffer.alloc(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks, total);
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
}

/**
 * Build the fetch over a raw request seam: host checked before any request, redirect refused, declared and
 * actual size both held to `maxBytes`, and every failure worded here rather than quoted from the provider.
 *
 * @param request the raw request, handed the address alone
 * @param maxBytes the most bytes one attachment may be
 * @returns the fetch seam
 */
export function makeGithubMediaFetch({
  request,
  maxBytes,
}: {
  request: GithubMediaHttpRequest;
  maxBytes: number;
}): GithubMediaFetch {
  return async ({ url }) => {
    if (!onAttachmentHost({ url })) {
      return err(GithubLiveErrors.mediaDownloadFailed({ reason: "it is not on a GitHub attachment host", url }));
    }
    const called = await safeProviderCall({
      execute: async (): Promise<Result<GithubFetchedMedia, string>> => {
        const response = await request({ url });
        if (response.status >= 300 && response.status < 400) {
          return err(`the host answered HTTP ${String(response.status)}, a redirect, which is refused`);
        }
        if (!response.ok) {
          return err(`the host answered HTTP ${String(response.status)}`);
        }
        const declared = Number(response.headers.get("content-length"));
        if (response.headers.has("content-length") && Number.isFinite(declared) && declared > maxBytes) {
          return err(`it declares ${String(declared)} bytes, past the ${String(maxBytes)}-byte ceiling`);
        }
        const bytes = await boundedBody({ maxBytes, response });
        if (bytes === undefined) {
          return err(`its body ran past the ${String(maxBytes)}-byte ceiling`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType === null) {
          return ok({ bytes, contentType: undefined });
        }
        return ok({ bytes, contentType });
      },
      operation: "github.media.download",
      provider: "github",
      retryMode: "transient",
      scopeId: "github-attachment-host",
    });
    if (called.isErr()) {
      // The thrown text can quote the signed address, so only the failure's KIND and status are carried.
      const status = called.error.status === undefined ? "" : ` (HTTP ${String(called.error.status)})`;
      return err(
        GithubLiveErrors.mediaDownloadFailed({ reason: `the request failed: ${called.error.kind}${status}`, url }),
      );
    }
    return called.value.mapErr((reason) => GithubLiveErrors.mediaDownloadFailed({ reason, url }));
  };
}

/**
 * Write one attachment atomically.
 *
 * @param path where it goes
 * @param bytes what goes there
 * @returns true, or a failure naming the path
 */
export const writeGithubMedia: GithubMediaWrite = ({ bytes, path }) => {
  try {
    writeFileAtomicBytes({ bytes, path });
    return ok(true);
  } catch (error) {
    return err(
      GithubLiveErrors.mediaWriteFailed({ path, reason: error instanceof Error ? error.message : String(error) }),
    );
  }
};

/**
 * Fetch every candidate, in order, and write each under a name its position and content type decide.
 *
 * @param candidates the attachments `githubRenderedMedia` named
 * @param outDir the directory the files are written into
 * @param fetchMedia how one attachment is fetched
 * @param writeMedia how one attachment is written
 * @param maxBytes the most bytes one attachment may be, held again here whatever the fetch did
 * @returns what was written, in the candidates' order, or the first failure
 */
export async function downloadGithubRenderedMedia({
  candidates,
  fetchMedia,
  maxBytes,
  outDir,
  writeMedia,
}: {
  candidates: readonly GithubRenderedMediaCandidate[];
  fetchMedia: GithubMediaFetch;
  maxBytes: number;
  outDir: string;
  writeMedia: GithubMediaWrite;
}): Promise<Result<readonly ProviderReadMedia[], GithubLiveError>> {
  const written: ProviderReadMedia[] = [];
  for (const candidate of candidates) {
    const fetched = await fetchMedia({ url: candidate.url });
    if (fetched.isErr()) {
      return err(fetched.error);
    }
    const { bytes, contentType } = fetched.value;
    if (bytes.byteLength > maxBytes) {
      return err(
        GithubLiveErrors.mediaDownloadFailed({
          reason: `it is ${String(bytes.byteLength)} bytes, past the ${String(maxBytes)}-byte ceiling`,
          url: candidate.url,
        }),
      );
    }
    const name = githubMediaFileName({ contentType, index: candidate.index });
    if (name === undefined) {
      // Only a validated bare type is printed: the header is provider text and could reflect the signed address.
      const named = bareContentType({ contentType });
      const said = named === undefined ? "no recognisable content type" : `content type ${named}`;
      return err(
        GithubLiveErrors.mediaDownloadFailed({
          reason: `the host named ${said}, not a picture or video this verb writes`,
          url: candidate.url,
        }),
      );
    }
    const path = join(outDir, name);
    const wrote = writeMedia({ bytes, path });
    if (wrote.isErr()) {
      return err(wrote.error);
    }
    written.push({
      bytes: bytes.byteLength,
      kind: candidate.kind,
      name,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return ok(written);
}

/**
 * The production download: a credential-free `fetch` that never follows a redirect, the atomic writer and the
 * ceiling, bound to one output directory.
 *
 * @param outDir the directory the files are written into
 * @returns the download `readGithubObject` is handed
 */
export function githubMediaDownload({ outDir }: { outDir: string }): GithubMediaDownload {
  const fetchMedia = makeGithubMediaFetch({
    maxBytes: GITHUB_MEDIA_BYTES_MAX,
    request: ({ url }) => fetch(url, { redirect: "manual" }),
  });
  return ({ candidates }) =>
    downloadGithubRenderedMedia({
      candidates,
      fetchMedia,
      maxBytes: GITHUB_MEDIA_BYTES_MAX,
      outDir,
      writeMedia: writeGithubMedia,
    });
}
