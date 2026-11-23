/**
 * Getting Google's published discovery documents onto disk, and refusing anything that is not one.
 *
 * ## Three URLs, and no caller can supply one
 *
 * The addresses are computed by {@link geminiAiStudioDiscoveryUrl} from
 * {@link GEMINI_AI_STUDIO_API_ORIGIN}, a constant. Nothing here takes a URL or a host, so there is no
 * argument that reaches an unreviewed origin — the same property `microsoft365/specSource.ts` and
 * `jumpcloud/generated/specLock.ts` have, arrived at for the same reason.
 *
 * ## Google's own bytes are NOT stable, so everything here hashes the CANONICAL form
 *
 * MEASURED, and it is the reason this module is shaped the way it is. Reproduce it:
 *
 * ```bash
 * for i in 1 2; do curl -fsSL 'https://generativelanguage.googleapis.com/$discovery/rest?version=v1' | shasum -a 256; done
 * ```
 *
 * Two fetches seconds apart returned 245,003 bytes each and TWO DIFFERENT SHA-256 digests. The content is
 * identical; the object key ORDER is not, which is exactly the signature of a server serialising a map. A
 * digest taken over the raw bytes therefore pins nothing — it never matches twice — so both the cache and
 * `specLock.ts` hash the document with its keys recursively sorted instead. That is a stable identity for
 * the same document, and it is the honest version of the check rather than a check quietly dropped because
 * it kept failing.
 *
 * It also fixes a defect the raw form had: a cache keyed by an unstable digest never hits, so every sync
 * re-downloaded a megabyte AND left another file behind. The canonical key hits.
 *
 * ## The cache is keyed by the REVIEWED digest, which is why drift costs a fetch
 *
 * A document is cached under its canonical digest, and a run looks for the digest `specLock.ts` reviewed. So
 * while Google is serving what was reviewed, a sync makes no request at all; once Google moves, every sync
 * fetches again — three documents, about a megabyte in total. That is the deliberate trade: the alternative
 * is a cache that answers with a stale document forever and an atlas that quietly stops tracking the
 * platform. The old document is never deleted, so a reader can diff what was reviewed against what arrived.
 *
 * ## Why this is not routed through the admit door
 *
 * The door governs the doored providers (`AGENTS.md` rule 3) and writes to a person's account. This reads
 * three public, unauthenticated documents and writes only under `$SLOPWEAVER_HOME` — the same `local-state`
 * posture as `atlas microsoft365 sync`. No Google credential is sent and no project is reached.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import type { SpecFetchLike } from "../kit/specFetch.js";

export type { SpecFetchLike };

import { GeminiAiStudioAtlasErrors, geminiAiStudioAtlasErrorLines } from "./errors.js";
import { geminiAiStudioDiscoveryUrl, geminiAiStudioSpecPin, isGeminiAiStudioSpecVersion } from "./specLock.js";

/** How long one fetch may take. The documents are under 400 KB each, so this is generous by design. */
const FETCH_TIMEOUT_MS = 60_000;

/** How much of a digest names a cached file. Enough that a collision is not a practical concern. */
const DIGEST_FILENAME_LENGTH = 12;

/**
 * One discovery document as it was obtained.
 *
 * @internal
 */
export interface GeminiAiStudioSpecBytes {
  readonly version: string;
  /** The document in its CANONICAL form — key-sorted, so it is stable across fetches. */
  readonly text: string;
  /** The digest of {@link GeminiAiStudioSpecBytes.text}, never of Google's own byte order. */
  readonly sha256: string;
  /** `cache` when the reviewed bytes were already on disk, `fetch` when they had to be downloaded. */
  readonly origin: "cache" | "fetch";
  readonly path: string;
  /** Whether these bytes are the ones `specLock.ts` reviewed. */
  readonly matchesPin: boolean;
}

/**
 * Where one document is cached, named by the version it describes and its CANONICAL digest.
 *
 * Named by digest rather than by revision so a file can be verified without trusting its name, and so a
 * moved document lands beside the reviewed one rather than overwriting it — the same accumulate-never-replace
 * posture the generations themselves have.
 *
 * @param root the atlas's own directory under `$SLOPWEAVER_HOME`
 * @param version the published version segment
 * @param sha256 the canonical digest of the document this path holds
 * @returns the absolute path
 */
export function geminiAiStudioSpecCachePath({
  root,
  version,
  sha256,
}: {
  root: string;
  version: string;
  sha256: string;
}): string {
  return join(root, "spec", `generativelanguage-${version}-${sha256.slice(0, DIGEST_FILENAME_LENGTH)}.json`);
}

/** The hex SHA-256 of some text. Only ever applied to a CANONICAL document — see this file's header. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Order two object keys by code point, so the canonical form does not depend on anyone's locale. */
function byCodePoint({ left, right }: { left: string; right: string }): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** One value with every object key beneath it recursively sorted. Arrays keep their order, which is data. */
function sortedValue({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sortedValue({ value: item }));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const entries = Object.entries(value).toSorted(([left], [right]) => byCodePoint({ left, right }));
  return Object.fromEntries(entries.map(([key, held]: [string, unknown]) => [key, sortedValue({ value: held })]));
}

/**
 * The document in its canonical form: the same JSON with every object key recursively sorted.
 *
 * This is what is hashed, cached and compared to the pin, because Google's own byte order is not stable
 * between two fetches of the same document — see this file's header for the measurement.
 *
 * @param text the document's bytes as served
 * @param version the version, named in a failure
 * @returns the canonical text, or why the bytes are not JSON at all
 *
 * @internal
 */
export function canonicaliseGeminiSpec({ text, version }: { text: string; version: string }): Result<string> {
  try {
    const value = safeJsonParse({ label: `gemini ${version} discovery document`, text });
    return ok(safeJsonStringify({ label: `gemini ${version} discovery document`, value: sortedValue({ value }) }));
  } catch (cause: unknown) {
    return err(geminiAiStudioAtlasErrorLines({ error: GeminiAiStudioAtlasErrors.documentNotJson({ cause, version }) }));
  }
}

/**
 * Read the reviewed document from cache, when a cache holds exactly those bytes.
 *
 * @param path where the cache would be
 * @param sha256 the digest those bytes must have
 * @returns the verified text, or `null` when there is nothing trustworthy there
 */
function readVerifiedCache({ path, sha256 }: { path: string; sha256: string }): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return digestOf({ text }) === sha256 ? text : null;
}

/**
 * Obtain one version's discovery document, from cache when it holds the reviewed bytes and from Google
 * otherwise.
 *
 * @param root the atlas's own directory, under which the cache lives
 * @param version the published version segment
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns the canonical text and where it came from, or why the document could not be obtained
 */
export async function loadGeminiAiStudioSpec({
  root,
  version,
  fetchImpl = globalThis.fetch,
}: {
  root: string;
  version: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<GeminiAiStudioSpecBytes>> {
  if (!isGeminiAiStudioSpecVersion(version)) {
    return err(geminiAiStudioAtlasErrorLines({ error: GeminiAiStudioAtlasErrors.versionUncompiled({ version }) }));
  }
  const pin = geminiAiStudioSpecPin({ version });
  const pinnedPath = geminiAiStudioSpecCachePath({ root, sha256: pin.sha256, version });
  const cached = readVerifiedCache({ path: pinnedPath, sha256: pin.sha256 });
  if (cached !== null) {
    return ok({ matchesPin: true, origin: "cache", path: pinnedPath, sha256: pin.sha256, text: cached, version });
  }
  const download = await fetchSpec({ fetchImpl, version });
  if (download.isErr()) {
    return err(download.error);
  }
  const canonical = canonicaliseGeminiSpec({ text: download.value, version });
  if (canonical.isErr()) {
    return err(canonical.error);
  }
  const text = canonical.value;
  const sha256 = digestOf({ text });
  const path = geminiAiStudioSpecCachePath({ root, sha256, version });
  const written = writeCache({ path, text, version });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ matchesPin: sha256 === pin.sha256, origin: "fetch", path, sha256, text, version });
}

/** One GET of a computed, constant-rooted address, bounded by a timeout. */
async function fetchSpec({
  fetchImpl,
  version,
}: {
  fetchImpl: SpecFetchLike;
  version: string;
}): Promise<Result<string>> {
  const url = geminiAiStudioDiscoveryUrl({ version });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      return err(
        geminiAiStudioAtlasErrorLines({
          error: GeminiAiStudioAtlasErrors.fetchRefused({ status: response.status, url, version }),
        }),
      );
    }
    return ok(await response.text());
  } catch (cause: unknown) {
    return err(geminiAiStudioAtlasErrorLines({ error: GeminiAiStudioAtlasErrors.fetchFailed({ cause, version }) }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write the cache atomically, so an interrupted write never leaves a half document behind.
 *
 * `writeFileAtomic` rather than a hand-rolled temp-plus-rename: `renameSync` is atomic for VISIBILITY but
 * not for DURABILITY, and without an fsync of the file and of its directory a crash can leave the renamed
 * path truncated. A truncated cache here fails its digest-named lookup silently forever, which is worse than
 * the 44 MB re-download the same primitive prevents in the Microsoft 365 atlas.
 */
function writeCache({ path, text, version }: { path: string; text: string; version: string }): Result<null> {
  try {
    writeFileAtomic({ contents: text, fileMode: 0o600, path });
    return ok(null);
  } catch (cause: unknown) {
    return err(
      geminiAiStudioAtlasErrorLines({ error: GeminiAiStudioAtlasErrors.cacheUnwritable({ cause, path, version }) }),
    );
  }
}
