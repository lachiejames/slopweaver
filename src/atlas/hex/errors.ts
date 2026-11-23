/**
 * The failure kinds a Hex evidence read can genuinely produce, as a typed union — and the DRIFT record,
 * which is deliberately not one of them.
 *
 * Per `.claude/rules/error-handling.md` this domain earns a union rather than `readonly string[]`, because
 * callers BRANCH on these: a `SPEC_UNREACHABLE` is a transport blip whose right answer is a partial
 * generation with a named gap, while a `SPEC_UNPARSABLE` is a defect in this repository's own reader rather
 * than anything about the network.
 *
 * ## Why a moved digest is a FINDING rather than a failure
 *
 * Hex serves its OpenAPI document from a CDN path with no version in it, so the bytes at that address are a
 * MUTABLE pointer by construction — a released change lands under the same URL. MEASURED: the
 * document is served with a `last-modified` header, alongside a web
 * client stamped `data-web-client-build-time` of the same instant. So the two ship together and the digest
 * will move on an ordinary release.
 *
 * Refusing the sync on a digest mismatch would therefore make the atlas unbuildable the day Hex ships,
 * which is worse than the risk it guards against — an atlas nobody can build is not a safer atlas. So the
 * digest is an OBSERVATION: the document is compiled, and the movement is recorded as a gap naming what was
 * pinned against what was served. That is `docs/atlas-intent/04-corroboration.md`'s "a disagreement is an OUTPUT, never a
 * resolution" applied to the time axis, and it follows the sibling Twilio atlas rather than re-deciding it.
 *
 * The read-only property the lock actually carries is untouched by this: `pin.url` is the only address ever
 * fetched, and no caller supplies one.
 */

/**
 * The pinned document could not be fetched at all.
 * @internal
 */
export interface HexSpecUnreachableError {
  readonly code: "SPEC_UNREACHABLE";
  readonly message: string;
  readonly specId: string;
  readonly cause?: unknown;
}

/**
 * The document arrived and is not something this reader can compile.
 * @internal
 */
export interface HexSpecUnparsableError {
  readonly code: "SPEC_UNPARSABLE";
  readonly message: string;
  readonly specId: string;
  readonly detail: string;
}

/**
 * Every way reading one pinned evidence body can fail.
 * @internal
 */
export type HexSpecError = HexSpecUnreachableError | HexSpecUnparsableError;

/**
 * One document served at a pinned address whose bytes are not the reviewed ones.
 *
 * Not an error — see this file's header. The byte lengths are kept beside the digests because "grew by 2 KB"
 * is the shape of the change a reader can act on before opening a diff.
 */
export interface HexSpecDrift {
  readonly specId: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly expectedByteLength: number;
  readonly actualByteLength: number;
}

/**
 * Construct each failure the same way the real code does, so a test built from these catches a factory that
 * stops matching its own type.
 * @internal
 */
export const HexSpecErrors = {
  unparsable: ({ specId, detail }: { specId: string; detail: string }): HexSpecUnparsableError => ({
    code: "SPEC_UNPARSABLE",
    detail,
    message: `${specId} could not be compiled into operations: ${detail}`,
    specId,
  }),
  unreachable: ({ specId, cause }: { specId: string; cause: unknown }): HexSpecUnreachableError => ({
    cause,
    code: "SPEC_UNREACHABLE",
    message: `${specId} could not be fetched: ${cause instanceof Error ? cause.message : String(cause)}`,
    specId,
  }),
} as const;

/**
 * Describe one moved document in the words a gap carries.
 *
 * @param drift what was pinned against what was served
 * @returns a sentence naming both digests and the size change, ready to store
 */
export function describeHexDrift({ drift }: { drift: HexSpecDrift }): string {
  return (
    `${drift.specId} was served at its pinned address with bytes that are not the reviewed ones: pinned ` +
    `${drift.expectedSha256} at ${String(drift.expectedByteLength)} bytes, served ${drift.actualSha256} at ` +
    `${String(drift.actualByteLength)} bytes. The atlas compiled what was served rather than refusing it — ` +
    "Hex publishes this document at an unversioned CDN path, so a release moves it. Regenerate the lock " +
    "with `yarn tsx tools/generateHexSpecLock.ts` and read the diff to see what changed"
  );
}
