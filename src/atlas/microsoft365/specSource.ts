/**
 * Getting the pinned Microsoft Graph specification onto disk, and refusing anything that is not it.
 *
 * ## One URL, and no caller can supply it
 *
 * The address is `MICROSOFT365_SPEC_PIN.url`, a constant addressing an immutable `msgraph-metadata` COMMIT.
 * Nothing here takes a URL, a host or a version, so there is no argument that reaches an unreviewed origin —
 * the same property `jumpcloud/generated/specLock.ts` gives its two origins, arrived at for the same reason.
 *
 * ## The cache is a convenience; the DIGEST is the contract
 *
 * A 44 MB fetch per sync would be the whole cost of the verb, so the bytes are cached under the atlas root.
 * The cache is never trusted on its own: it is hashed on every read and discarded when it does not match the
 * pin, so a truncated download, a half-written file or a hand-edit all fail closed. This is deliberately not
 * a freshness cache — the pin is immutable, so a matching digest means the cache IS the pinned document, and
 * no expiry could ever say anything a hash does not.
 *
 * ## Why this is not routed through the admit door
 *
 * The door governs the doored providers (`AGENTS.md` rule 3) and writes to a person's account. This reads one
 * public, versioned document from a source-code host and writes only under `$SLOPWEAVER_HOME` — the same
 * posture as `atlas vanta sync`, which is `local-state` rather than `external-write`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import type { SpecFetchLike } from "../kit/specFetch.js";

export type { SpecFetchLike };

import { Microsoft365AtlasErrors, microsoft365AtlasErrorLines } from "./errors.js";
import { MICROSOFT365_SPEC_PIN } from "./specLock.js";

/** How long the one fetch may take. The document is 44 MB, so this is generous by design. */
const FETCH_TIMEOUT_MS = 300_000;

/**
 * Where the cached specification lives, and where it came from.
 *
 * @internal
 */
export interface Microsoft365SpecBytes {
  readonly text: string;
  readonly sha256: string;
  /** `cache` when the pinned bytes were already on disk, `fetch` when they had to be downloaded. */
  readonly origin: "cache" | "fetch";
  readonly path: string;
}

/**
 * The path the pinned document is cached at, named by the commit it came from.
 *
 * Named by COMMIT rather than by digest so a reader can see which pin a file belongs to without hashing it,
 * and so bumping the pin leaves the old document in place rather than overwriting it — the same
 * accumulate-never-replace posture the generations themselves have.
 *
 * @param root the atlas's own directory under `$SLOPWEAVER_HOME`
 * @returns the absolute path
 */
export function microsoft365SpecCachePath({ root }: { root: string }): string {
  return join(root, "spec", `graph-v1.0-${MICROSOFT365_SPEC_PIN.commit}.yaml`);
}

/** The hex SHA-256 of some text, which is the only thing that decides whether bytes are the pinned ones. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Read the cached document, when a cache exists AND its bytes are the pinned ones.
 *
 * @param path where the cache would be
 * @returns the verified text, or `null` when there is nothing trustworthy there
 */
function readVerifiedCache({ path }: { path: string }): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return digestOf({ text }) === MICROSOFT365_SPEC_PIN.sha256 ? text : null;
}

/**
 * Fetch the pinned specification, or read it from the cache when the cache genuinely holds it.
 *
 * @param root the atlas's own directory, under which the cache lives
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns the verified bytes and where they came from, or why the pinned document could not be obtained
 */
export async function loadMicrosoft365Spec({
  root,
  fetchImpl = globalThis.fetch,
}: {
  root: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<Microsoft365SpecBytes>> {
  const path = microsoft365SpecCachePath({ root });
  const cached = readVerifiedCache({ path });
  if (cached !== null) {
    return ok({ origin: "cache", path, sha256: MICROSOFT365_SPEC_PIN.sha256, text: cached });
  }
  const download = await fetchSpec({ fetchImpl });
  if (download.isErr()) {
    return err(download.error);
  }
  const text = download.value;
  const sha256 = digestOf({ text });
  if (sha256 !== MICROSOFT365_SPEC_PIN.sha256) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.digestMismatch({ got: sha256 }) }));
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength !== MICROSOFT365_SPEC_PIN.byteLength) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.byteLengthMismatch({ got: byteLength }) }));
  }
  const written = writeCache({ path, text });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ origin: "fetch", path, sha256, text });
}

/** One GET of the pinned URL, bounded by a timeout and never following a caller-supplied address. */
async function fetchSpec({ fetchImpl }: { fetchImpl: SpecFetchLike }): Promise<Result<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MICROSOFT365_SPEC_PIN.url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      return err(
        microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.fetchRefused({ status: response.status }) }),
      );
    }
    return ok(await response.text());
  } catch (cause: unknown) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.fetchFailed({ cause }) }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write the cache atomically, so an interrupted write never leaves a half document behind.
 *
 * `writeFileAtomic` rather than a hand-rolled temp-plus-rename: `renameSync` is atomic for VISIBILITY but not
 * for DURABILITY, and without an fsync of the file AND of its directory a crash can leave the renamed path
 * truncated. That matters more here than in most places — a truncated cache fails the digest check and is
 * re-downloaded, and 44 MB is an expensive way to rediscover what the shared primitive already prevents.
 */
function writeCache({ path, text }: { path: string; text: string }): Result<null> {
  try {
    writeFileAtomic({ contents: text, fileMode: 0o600, path });
    return ok(null);
  } catch (cause: unknown) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.cacheUnwritable({ cause, path }) }));
  }
}
