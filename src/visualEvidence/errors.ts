/**
 * The typed failures of IMAGE ADMISSION — the question "may these bytes be attached to an outbound
 * message at all", asked of every upload lane before any of them reaches Slack.
 *
 * ## Why this domain has its own union rather than `readonly string[]`
 *
 * Per `.claude/rules/error-handling.md`, a union earns its place when callers BRANCH on the failure kind,
 * and here three callers do, differently:
 *
 * - a **missing** record is a policy refusal with a working hatch, so its caller renders four lines through
 *   `hatchRefusal` and names `slopweaver hatch open unread-image`;
 * - a **known-bad** record is a `hold` with no hatch at all, so its caller renders door findings and must
 *   NOT offer an override;
 * - **invalid** evidence and a **failed store** are facts rather than policy, so their caller says what it
 *   could not read and never claims a rule caught anything.
 *
 * Collapsing those into one message list is what would let a hold be rendered with a hatch line, which is
 * the single thing the owner asked to be made impossible.
 */

import type { DoorFinding } from "../admit/types.js";

/** No local record says anybody has looked at these bytes. Policy: hatchable. */
export interface ImageRecordMissingError {
  readonly code: "IMAGE_RECORD_MISSING";
  readonly message: string;
  /** The artifact digests with no record, so a caller can name exactly which images to look at. */
  readonly digests: readonly string[];
}

/**
 * A record EXISTS for these bytes and it says they are unloaded, empty-panelled, illegible or
 * context-lost. There is no hatch: this is the act the owner named.
 */
export interface ImageKnownBadError {
  readonly code: "IMAGE_KNOWN_BAD";
  readonly message: string;
  /** One `hold` finding per bad artifact, already carrying its reason and correction. */
  readonly findings: readonly DoorFinding[];
}

/** A record was found and could not be believed — malformed, stale, or bound to different bytes. */
export interface ImageEvidenceInvalidError {
  readonly code: "IMAGE_EVIDENCE_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** The evidence store itself could not be read or written. A fact, never a refusal. */
export interface ImageStoreFailedError {
  readonly code: "IMAGE_STORE_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Every way image admission can fail. */
export type ImageAdmissionError =
  ImageRecordMissingError | ImageKnownBadError | ImageEvidenceInvalidError | ImageStoreFailedError;

/** The factories the real code calls, so a test fixture is built the same way production builds one. */
export const ImageAdmissionErrors = {
  evidenceInvalid: ({ issues }: { issues: readonly string[] }): ImageEvidenceInvalidError => ({
    code: "IMAGE_EVIDENCE_INVALID",
    issues,
    message:
      issues.length === 1
        ? `the read-back record for this image cannot be believed: ${issues[0]!}`
        : `${String(issues.length)} read-back records cannot be believed`,
  }),
  knownBad: ({ findings }: { findings: readonly DoorFinding[] }): ImageKnownBadError => ({
    code: "IMAGE_KNOWN_BAD",
    findings,
    message:
      findings.length === 1
        ? "an image on this message was looked at and recorded as unfit to send"
        : `${String(findings.length)} images on this message were looked at and recorded as unfit to send`,
  }),
  recordMissing: ({ digests }: { digests: readonly string[] }): ImageRecordMissingError => ({
    code: "IMAGE_RECORD_MISSING",
    digests,
    message:
      digests.length === 1
        ? "an image on this message has no recorded read-back, so nothing has established that anybody looked at it"
        : `${String(digests.length)} images on this message have no recorded read-back`,
  }),
  storeFailed: ({ cause }: { cause: unknown }): ImageStoreFailedError => ({
    cause,
    code: "IMAGE_STORE_FAILED",
    message: cause instanceof Error ? cause.message : "the image evidence store could not be read",
  }),
} as const;
