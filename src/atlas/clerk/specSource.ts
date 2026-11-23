/**
 * Getting the four pinned Clerk documents onto disk, and refusing anything that is not them.
 *
 * ## Four URLs, and no caller can supply one
 *
 * The addresses are `CLERK_SPEC_PINS`, constants addressing an immutable `clerk/openapi-specs` COMMIT.
 * Nothing here takes a URL, a host or a version, so there is no argument that reaches an unreviewed origin
 * — the same property the sibling Microsoft 365 and JumpCloud atlases give their own origins, for the same
 * reason.
 *
 * ## The cache is a convenience; the DIGEST is the contract
 *
 * The bytes are cached under the atlas root and never trusted on their own: each is hashed on every read
 * and discarded when it does not match its pin, so a truncated download, a half-written file and a
 * hand-edit all fail closed. This is deliberately not a freshness cache — the pin is immutable, so a
 * matching digest means the cache IS the pinned document, and no expiry could say anything a hash does not.
 *
 * ## Why this is not routed through the admit door
 *
 * The door governs the doored providers (`AGENTS.md` rule 3) and writes to a person's account. This reads
 * four public, commit-addressed documents from a source-code host and writes only under
 * `$SLOPWEAVER_HOME` — the same posture as `atlas microsoft365 sync`, which is `local-state` rather than
 * `external-write`. It reaches no Clerk account and carries no credential.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import type { SpecFetchLike } from "../kit/specFetch.js";

export type { SpecFetchLike };

import { ClerkAtlasErrors, clerkAtlasErrorLines } from "./errors.js";
import { CLERK_SPEC_PINS, type ClerkSpecDocument, type ClerkSpecPin } from "./specLock.js";

/** How long one fetch may take. The largest document is 738 KB, so this is generous by design. */
const FETCH_TIMEOUT_MS = 120_000;

/**
 * One pinned document's bytes, and where they came from.
 *
 * @internal
 */
export interface ClerkSpecBytes {
  readonly document: ClerkSpecDocument;
  readonly text: string;
  readonly sha256: string;
  /** `cache` when the pinned bytes were already on disk, `fetch` when they had to be downloaded. */
  readonly origin: "cache" | "fetch";
  readonly path: string;
}

/**
 * Where one pinned document is cached, named by the commit it came from.
 *
 * Named by COMMIT rather than by digest so a reader can see which pin a file belongs to without hashing it,
 * and so bumping the pin leaves the old documents in place rather than overwriting them — the same
 * accumulate-never-replace posture the generations themselves have.
 *
 * @param root the atlas's own directory under `$SLOPWEAVER_HOME`
 * @param pin the document whose cache path is wanted
 * @returns the absolute path
 *
 * @internal
 */
export function clerkSpecCachePath({ root, pin }: { root: string; pin: ClerkSpecPin }): string {
  // `split` always yields at least one element, so the last one is always there.
  return join(root, "spec", `${pin.document}-${pin.repositoryPath.split("/").at(-1)!}`);
}

/** The hex SHA-256 of some text, which is the only thing that decides whether bytes are the pinned ones. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Read one cached document, when a cache exists AND its bytes are the pinned ones.
 *
 * @param path where the cache would be
 * @param pin the document being read back
 * @returns the verified text, or `null` when there is nothing trustworthy there
 */
function readVerifiedCache({ path, pin }: { path: string; pin: ClerkSpecPin }): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return digestOf({ text }) === pin.sha256 ? text : null;
}

/**
 * Load every pinned document, fetching only the ones the cache does not already hold.
 *
 * @param root the atlas's own directory, under which the cache lives
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns every document's verified bytes in pin order, or the first reason one could not be obtained
 */
export async function loadClerkSpecs({
  root,
  fetchImpl = globalThis.fetch,
}: {
  root: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<readonly ClerkSpecBytes[]>> {
  const loaded: ClerkSpecBytes[] = [];
  for (const pin of CLERK_SPEC_PINS) {
    const one = await loadOneSpec({ fetchImpl, pin, root });
    if (one.isErr()) {
      return err(one.error);
    }
    loaded.push(one.value);
  }
  return ok(loaded);
}

/**
 * Load one pinned document: the cache when it genuinely holds it, otherwise a fetch that must match.
 *
 * @param pin the document to load
 * @param root the atlas's own directory
 * @param fetchImpl the HTTP seam
 * @returns the verified bytes, or every reason this document could not be obtained
 */
async function loadOneSpec({
  pin,
  root,
  fetchImpl,
}: {
  pin: ClerkSpecPin;
  root: string;
  fetchImpl: SpecFetchLike;
}): Promise<Result<ClerkSpecBytes>> {
  const path = clerkSpecCachePath({ pin, root });
  const cached = readVerifiedCache({ path, pin });
  if (cached !== null) {
    return ok({ document: pin.document, origin: "cache", path, sha256: pin.sha256, text: cached });
  }
  const download = await fetchSpec({ fetchImpl, pin });
  if (download.isErr()) {
    return err(download.error);
  }
  const text = download.value;
  const sha256 = digestOf({ text });
  if (sha256 !== pin.sha256) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.digestMismatch({ got: sha256, pin }) }));
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength !== pin.byteLength) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.byteLengthMismatch({ byteLength, pin }) }));
  }
  const written = writeCache({ path, pin, text });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ document: pin.document, origin: "fetch", path, sha256, text });
}

/** One GET of one pinned URL, bounded by a timeout and never following a caller-supplied address. */
async function fetchSpec({ pin, fetchImpl }: { pin: ClerkSpecPin; fetchImpl: SpecFetchLike }): Promise<Result<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(pin.url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.fetchRefused({ pin, status: response.status }) }));
    }
    return ok(await response.text());
  } catch (cause: unknown) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.fetchFailed({ cause, pin }) }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write one cache atomically, so an interrupted write never leaves a half document behind.
 *
 * `writeFileAtomic` rather than a hand-rolled temp-plus-rename: `renameSync` is atomic for VISIBILITY but
 * not for DURABILITY, and without an fsync of the file and of its directory a crash can leave the renamed
 * path truncated — which fails the digest check and is silently re-downloaded, a cost the shared primitive
 * already prevents.
 */
function writeCache({ path, text, pin }: { path: string; text: string; pin: ClerkSpecPin }): Result<null> {
  try {
    writeFileAtomic({ contents: text, fileMode: 0o600, path });
    return ok(null);
  } catch (cause: unknown) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.cacheUnwritable({ cause, path, pin }) }));
  }
}
