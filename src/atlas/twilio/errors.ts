/**
 * The failure kinds a Twilio definition read can genuinely produce, as a typed union — and the DRIFT
 * record, which is deliberately not one of them.
 *
 * Per `.claude/rules/error-handling.md` this domain earns a union rather than `readonly string[]`, because
 * callers BRANCH on these: a `SPEC_UNREACHABLE` on one document among sixty is a transport blip whose right
 * answer is a partial generation with a named gap, while a `SPEC_UNPARSABLE` is a defect in this
 * repository's own reader rather than anything about the network.
 *
 * ## Why a moved digest is a FINDING rather than a failure
 *
 * The pins address a release TAG, and a tag is a mutable pointer: `twilio-oai` could retarget `2.8.1` at a
 * different commit, or publish different bytes under the same path. That has NOT been observed here — no
 * re-fetch has been run against this lock, so nothing below is a measurement and this file does not claim
 * one. What decided the design is the measurement `kit/pinnedSpec.ts` carries, which IS one: a vendor
 * release was republished under a pinned id inside an hour, and the first cut of that atlas refused the
 * whole sync over it.
 *
 * The lesson generalises whether or not Twilio ever moves a tag. Refusing the sync on a digest mismatch
 * makes the atlas unbuildable the day the vendor ships, which is worse than the risk it guards against —
 * an atlas nobody can build is not a safer atlas. So the digest is an OBSERVATION: the document is
 * compiled, and the movement is recorded as a gap naming what was pinned against what was served. That is
 * `docs/atlas-intent/04-corroboration.md`'s "a disagreement is an OUTPUT, never a resolution" applied to the time axis.
 *
 * The read-only property the lock actually carries is untouched by this: `pin.url` is the only address ever
 * fetched, and no caller supplies one.
 */

/**
 * The pinned document could not be fetched at all.
 * @internal
 */
export interface SpecUnreachableError {
  readonly code: "SPEC_UNREACHABLE";
  readonly message: string;
  readonly specId: string;
  readonly cause?: unknown;
}

/**
 * The document arrived and is not something this reader can compile.
 * @internal
 */
export interface SpecUnparsableError {
  readonly code: "SPEC_UNPARSABLE";
  readonly message: string;
  readonly specId: string;
  readonly detail: string;
}

/**
 * Every way reading one pinned definition can fail.
 * @internal
 */
export type TwilioSpecError = SpecUnreachableError | SpecUnparsableError;

/**
 * One document served under a pinned tag whose bytes are not the reviewed ones.
 *
 * Not an error — see this file's header. It is carried alongside the compiled surface so the sync can raise
 * a gap for it, and the byte lengths are kept beside the digests because "grew by 2 KB" is the shape of the
 * change a reader can act on before opening a diff.
 */
export interface TwilioSpecDrift {
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
export const TwilioSpecErrors = {
  unparsable: ({ specId, detail }: { specId: string; detail: string }): SpecUnparsableError => ({
    code: "SPEC_UNPARSABLE",
    detail,
    message: `${specId} could not be compiled into operations: ${detail}`,
    specId,
  }),
  unreachable: ({ specId, cause }: { specId: string; cause: unknown }): SpecUnreachableError => ({
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
export function describeTwilioDrift({ drift }: { drift: TwilioSpecDrift }): string {
  return (
    `${drift.specId} was served under the pinned tag with bytes that are not the reviewed ones: pinned ` +
    `${drift.expectedSha256} at ${String(drift.expectedByteLength)} bytes, served ${drift.actualSha256} at ` +
    `${String(drift.actualByteLength)} bytes. The atlas compiled what was served rather than refusing it — a ` +
    "release tag is a mutable pointer, so this records that the published definition moved. Regenerate the " +
    "lock with `yarn tsx tools/generateTwilioSpecLock.ts <spec-dir>` and read the diff to see what changed"
  );
}
