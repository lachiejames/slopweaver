/**
 * Typed failures for the distil digest contract and brief protocol — {@link ./distil} (validating a
 * composed digest) and {@link ./distilBrief} (reading/rebuilding a distil brief). Modeled on
 * an earlier codebase's `<domain>/errors.ts` pattern (discriminated union + a factory object keyed by
 * variant), re-skinned rather than ported verbatim; see `AGENTS.md`'s "Porting from private sources".
 *
 * One union for both files: they are one bounded domain (the distil handoff), and every caller here only
 * ever displays `.message` — there is no per-kind branch to justify splitting it.
 */

/** The composed digest is not a JSON object with a string `summary` and a `points` array. */
export interface DistilDigestShapeInvalidError {
  readonly code: "DISTIL_DIGEST_SHAPE_INVALID";
  readonly message: string;
}

/** The digest survived validation with neither a summary nor any cited point. */
export interface DistilDigestEmptyError {
  readonly code: "DISTIL_DIGEST_EMPTY";
  readonly message: string;
}

/** The decoded brief is not a JSON object at all. */
export interface DistilBriefNotObjectError {
  readonly code: "DISTIL_BRIEF_NOT_OBJECT";
  readonly message: string;
}

/** The brief was written under a version this build no longer reads. */
export interface DistilBriefVersionMismatchError {
  readonly code: "DISTIL_BRIEF_VERSION_MISMATCH";
  readonly message: string;
}

/** One or more required brief fields are missing or malformed, named together. */
export interface DistilBriefInvalidError {
  readonly code: "DISTIL_BRIEF_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** The distil CONTRACT (prompt + schema + batching scheme) changed since the brief was written. */
export interface DistilContractChangedError {
  readonly code: "DISTIL_CONTRACT_CHANGED";
  readonly message: string;
  readonly briefFingerprint: string;
  readonly currentFingerprint: string;
}

/** The brief's pinned record refs no longer resolve to exactly one record each. */
export interface DistilPinnedRefsInvalidError {
  readonly code: "DISTIL_PINNED_REFS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The rebuilt batch's content hash no longer matches the one the brief stored. */
export interface DistilBatchHashMismatchError {
  readonly code: "DISTIL_BATCH_HASH_MISMATCH";
  readonly message: string;
}

/** The recomputed prompt differs from what the brief stored, even though the hash still matched. */
export interface DistilPromptDriftError {
  readonly code: "DISTIL_PROMPT_DRIFT";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every way the distil digest contract or brief protocol can refuse. */
export type DistilError =
  | DistilDigestShapeInvalidError
  | DistilDigestEmptyError
  | DistilBriefNotObjectError
  | DistilBriefVersionMismatchError
  | DistilBriefInvalidError
  | DistilContractChangedError
  | DistilPinnedRefsInvalidError
  | DistilBatchHashMismatchError
  | DistilPromptDriftError;

/** Factories for {@link DistilError} — the one place its message text is composed. */
export const DistilErrors = {
  /** @returns a {@link DistilBatchHashMismatchError} */
  batchHashMismatch: (): DistilBatchHashMismatchError => ({
    code: "DISTIL_BATCH_HASH_MISMATCH",
    message:
      "the batch's content hash no longer matches the brief — the corpus changed since it was written; " +
      "regenerate with `slopweaver distil brief`",
  }),

  /**
   * Build a {@link DistilBriefInvalidError} from every problem found at once.
   *
   * @param problems every reason the brief was refused
   * @returns the typed error
   */
  briefInvalid: ({ problems }: { problems: readonly string[] }): DistilBriefInvalidError => ({
    code: "DISTIL_BRIEF_INVALID",
    message: problems.join("; "),
    problems,
  }),

  /** @returns a {@link DistilBriefNotObjectError} */
  briefNotObject: (): DistilBriefNotObjectError => ({
    code: "DISTIL_BRIEF_NOT_OBJECT",
    message: "the brief is not a JSON object",
  }),

  /**
   * Build a {@link DistilBriefVersionMismatchError}.
   *
   * @param found the version the brief file actually carries
   * @param expected the version this build writes and reads
   * @returns the typed error
   */
  briefVersionMismatch: ({
    found,
    expected,
  }: {
    found: unknown;
    expected: number;
  }): DistilBriefVersionMismatchError => ({
    code: "DISTIL_BRIEF_VERSION_MISMATCH",
    message:
      `the brief is version ${String(found)}, but this build writes version ${String(expected)} — ` +
      "regenerate it with `slopweaver distil brief`",
  }),

  /**
   * Build a {@link DistilContractChangedError}.
   *
   * @param briefFingerprint the contract fingerprint the brief was written under
   * @param currentFingerprint the contract fingerprint this build runs under
   * @returns the typed error
   */
  contractChanged: ({
    briefFingerprint,
    currentFingerprint,
  }: {
    briefFingerprint: string;
    currentFingerprint: string;
  }): DistilContractChangedError => ({
    briefFingerprint,
    code: "DISTIL_CONTRACT_CHANGED",
    currentFingerprint,
    message:
      `the distil contract changed since this brief was written (${briefFingerprint} → ${currentFingerprint}) ` +
      "— regenerate with `slopweaver distil brief`",
  }),

  /** @returns a {@link DistilDigestEmptyError} */
  digestEmpty: (): DistilDigestEmptyError => ({
    code: "DISTIL_DIGEST_EMPTY",
    message: "digest had neither a summary nor any cited point",
  }),
  /** @returns a {@link DistilDigestShapeInvalidError} */
  digestShapeInvalid: (): DistilDigestShapeInvalidError => ({
    code: "DISTIL_DIGEST_SHAPE_INVALID",
    message: "digest must have a string summary and a points array",
  }),

  /**
   * Build a {@link DistilPinnedRefsInvalidError} wrapping the pinned-slice resolution failure.
   *
   * @param reasons every reason a pinned ref no longer resolves
   * @returns the typed error
   */
  pinnedRefsInvalid: ({ reasons }: { reasons: readonly string[] }): DistilPinnedRefsInvalidError => ({
    code: "DISTIL_PINNED_REFS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),

  /**
   * Build a {@link DistilPromptDriftError} from every drift reason found at once.
   *
   * @param reasons every reason the recomputed prompt differs from what the brief stored
   * @returns the typed error
   */
  promptDrift: ({ reasons }: { reasons: readonly string[] }): DistilPromptDriftError => ({
    code: "DISTIL_PROMPT_DRIFT",
    message: reasons.join("; "),
    reasons,
  }),
} as const;
