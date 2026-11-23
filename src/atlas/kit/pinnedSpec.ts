/**
 * Fetching one pinned vendor document and deciding whether the bytes are the ones that were reviewed.
 *
 * ## Why the digest is an OBSERVATION and never a gate — the measurement, once
 *
 * The first atlases to pin a vendor's published documents refused the whole sync on a digest mismatch, on
 * the reasoning that a vendor's release handle is permanent. **MEASURED on a vendor's pinned
 * OpenAPI releases: it is not.** Release `164586` was republished under the same id inside one hour, adding
 * a schema and renaming three response fields. Re-fetching all 323 pinned documents an hour after the lock was cut
 * found 322 identical and that one moved — rare, and real, which is exactly the combination a hard gate
 * handles worst. A gate built on the assumption would refuse the sync whenever the vendor shipped anything,
 * and an atlas nobody can build is not a safer atlas.
 *
 * So a moved document is COMPILED and the movement RECORDED, which is `docs/atlas-intent/04-corroboration.md`'s "a
 * disagreement is an OUTPUT, never a resolution" applied to the time axis. This module owns that decision
 * so the next atlas to pin a vendor's documents inherits it rather than rediscovering it.
 *
 * ## What the lock still guarantees, and what a platform still owns
 *
 * The read-only property is untouched: {@link fetchPinnedText} takes a URL from a reviewed lock, and no
 * caller assembles one. What each atlas still owns is its own typed error union and the words it puts in a
 * gap — the two vendors' failures are not interchangeable, and `.claude/rules/error-handling.md` is
 * explicit that a shared cross-domain error type is the thing not to build.
 */
import { createHash } from "node:crypto";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";

import { AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";

/**
 * The fields a pinned-document lock row must carry for this module to check it.
 * @internal
 */
export interface PinnedDocument {
  readonly byteLength: number;
  /** The lock's own id for this document — what a drift record and a gap are scoped to. */
  readonly id: string;
  readonly sha256: string;
  /** The ONLY address ever fetched. No caller supplies one. */
  readonly url: string;
}

/**
 * One document served under its pin whose bytes are not the reviewed ones.
 *
 * Not an error. The byte lengths sit beside the digests because "grew by 2 KB" is the shape of the change a
 * reader can act on before opening a diff.
 */
export interface SpecDrift {
  readonly actualByteLength: number;
  readonly actualSha256: string;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly specId: string;
}

/**
 * Whether the bytes that arrived are the ones the lock pinned.
 *
 * @param pin the lock row these bytes are supposed to satisfy
 * @param text the bytes that arrived, as UTF-8
 * @returns the drift record, or `null` when the digest matches
 */
export function digestDrift({ pin, text }: { pin: PinnedDocument; text: string }): SpecDrift | null {
  const actual = createHash("sha256").update(text).digest("hex");
  if (actual === pin.sha256) {
    return null;
  }
  return {
    actualByteLength: Buffer.byteLength(text),
    actualSha256: actual,
    expectedByteLength: pin.byteLength,
    expectedSha256: pin.sha256,
    specId: pin.id,
  };
}

/**
 * Fetch one pinned document over HTTP.
 *
 * Returns plain reasons rather than a typed error on purpose: each atlas maps this into its OWN union at
 * the boundary, because a shared cross-domain error type is exactly what `error-handling.md` bans. The one
 * reason this module authors is raised as an {@link AtlasCaptureErrors} variant and rendered to lines here.
 *
 * @param pin the lock row whose `url` is used verbatim and is never assembled from a caller's input
 * @returns the response body as UTF-8, or why it could not be fetched
 */
export async function fetchPinnedText({ pin }: { pin: PinnedDocument }): Promise<Result<string>> {
  try {
    const response = await fetch(pin.url, { redirect: "error" });
    if (!response.ok) {
      return err(atlasCaptureErrorLines({ error: AtlasCaptureErrors.pinnedHttpStatus({ status: response.status }) }));
    }
    return ok(await response.text());
  } catch (error: unknown) {
    return err([errorMessage({ error })]);
  }
}

/**
 * What compiling a whole pinned catalogue came back with.
 *
 * Generic over the platform's own surface and error types, because those are genuinely its own: the loop is
 * shared, the vocabulary is not.
 */
export interface CompiledCatalogue<TSurface, TError> {
  readonly drifts: readonly SpecDrift[];
  readonly failures: readonly TError[];
  readonly operationCount: number;
  readonly surfaces: readonly TSurface[];
}

/**
 * Fetch and compile every pinned document. **Nothing here stops the batch.**
 *
 * That is the rule rather than a detail: a document that could not be fetched is one blip among dozens, and
 * a sync that refused everything on one timeout would leave an install with no atlas rather than with a
 * slightly incomplete one. The caller reports the fraction in its coverage cell and raises a gap per
 * failure, so incompleteness is a number rather than a silence.
 *
 * @param pins the reviewed lock
 * @param transport how one document's bytes are obtained; a test supplies a deterministic fake
 * @param compile how one document's bytes become this platform's surface, plus any drift
 * @param countOperations how many operations one compiled surface declares
 * @returns every surface compiled, every document that could not be, and every one that has moved
 */
export async function compilePinnedCatalogue<TPin extends PinnedDocument, TSurface, TError>({
  pins,
  transport,
  compile,
  countOperations,
}: {
  pins: readonly TPin[];
  transport: (input: { pin: TPin }) => Promise<Result<string, TError>>;
  compile: (input: { pin: TPin; text: string }) => Result<{ drift: SpecDrift | null; surface: TSurface }, TError>;
  countOperations: (input: { surface: TSurface }) => number;
}): Promise<CompiledCatalogue<TSurface, TError>> {
  const surfaces: TSurface[] = [];
  const failures: TError[] = [];
  const drifts: SpecDrift[] = [];
  let operationCount = 0;
  for (const pin of pins) {
    const fetched = await transport({ pin });
    if (fetched.isErr()) {
      failures.push(fetched.error);
      continue;
    }
    const compiled = compile({ pin, text: fetched.value });
    if (compiled.isErr()) {
      failures.push(compiled.error);
      continue;
    }
    if (compiled.value.drift !== null) {
      drifts.push(compiled.value.drift);
    }
    surfaces.push(compiled.value.surface);
    operationCount += countOperations({ surface: compiled.value.surface });
  }
  return { drifts, failures, operationCount, surfaces };
}
