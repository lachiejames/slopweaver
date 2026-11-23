/**
 * The typed failures the pass bound and the Claude fallback documents author themselves: a `--bound-seconds`
 * that is not a usable bound, a fallback document field that is not what it must be, a document whose
 * accumulated problems refuse it, a receipt or request that is not JSON, and a request read by id that is not
 * the kind the caller asked for. Whether a document could be READ at all is the store's to say
 * (`./fallbackStoreErrors.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory. It is distinct from
 * `./pricingErrors.ts` and `./drawdownErrors.ts`, which stay the narrower unions they were. A document parser
 * reports EVERY reason a document is refused, so the list variant carries them as `reasons` and
 * {@link codexErrorLines} prints them one line each, as the `readonly string[]` it replaced did.
 */

/** `--bound-seconds` is not a whole, positive number of seconds within the 24h ceiling. */
export interface CodexPassBoundInvalidError {
  readonly code: "PASS_BOUND_INVALID";
  readonly message: string;
  readonly boundSeconds: number;
}

/** One field of a fallback document is absent or not the shape it must be; `field` names it. */
export interface CodexFallbackFieldInvalidError {
  readonly code: "FALLBACK_FIELD_INVALID";
  readonly message: string;
  readonly field: string;
}

/** A fallback document is refused for every reason in `reasons`, each its own line. */
export interface CodexFallbackDocumentInvalidError {
  readonly code: "FALLBACK_DOCUMENT_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A receipt was read and is not JSON. */
export interface CodexFallbackDocumentNotJsonError {
  readonly code: "FALLBACK_DOCUMENT_NOT_JSON";
  readonly message: string;
  readonly label: string;
  readonly cause: unknown;
}

/** A stored request was read and is not JSON. */
export interface CodexFallbackRequestNotJsonError {
  readonly code: "FALLBACK_REQUEST_NOT_JSON";
  readonly message: string;
  readonly requestId: string;
  readonly cause: unknown;
}

/** A request read by id declares a kind other than the one the caller asked for. */
export interface CodexFallbackRequestKindMismatchError {
  readonly code: "FALLBACK_REQUEST_KIND_MISMATCH";
  readonly message: string;
  readonly requestId: string;
  readonly declared: string | undefined;
  readonly wanted: "review" | "plan";
}

/** Every failure this directory authors outside the pricing and drawdown unions. */
export type CodexError =
  | CodexPassBoundInvalidError
  | CodexFallbackFieldInvalidError
  | CodexFallbackDocumentInvalidError
  | CodexFallbackDocumentNotJsonError
  | CodexFallbackRequestNotJsonError
  | CodexFallbackRequestKindMismatchError;

/** An error's message, for a reason line. */
function describe({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Why a request read by id is not the kind the caller asked for, named rather than left to the wrong
 * parser's field-by-field complaint. Reading a plan request through the review parser reports
 * `baseRef must be a string`, which describes the reader's expectation and never the document.
 */
function kindMismatchMessage({
  declared,
  requestId,
  wanted,
}: {
  declared: string | undefined;
  requestId: string;
  wanted: "review" | "plan";
}): string {
  if (declared === undefined) {
    return `fallback request ${requestId} is a review request, not a ${wanted} one`;
  }
  if (declared === "plan" || declared === "review") {
    return `fallback request ${requestId} is a ${declared} request, not a ${wanted} one`;
  }
  return `fallback request ${requestId} declares kind "${declared}", which this build has no parser for — the checkout that wrote it is ahead of this one`;
}

/** A field failure, named. */
function fieldInvalid({ field, message }: { field: string; message: string }): CodexFallbackFieldInvalidError {
  return { code: "FALLBACK_FIELD_INVALID", field, message };
}

/** A document refused for every reason it carries, joined for a one-line display. */
function documentInvalid({ reasons }: { reasons: readonly string[] }): CodexFallbackDocumentInvalidError {
  return { code: "FALLBACK_DOCUMENT_INVALID", message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CodexErrors = {
  boundNotPositive: ({ boundSeconds }: { boundSeconds: number }): CodexPassBoundInvalidError => ({
    boundSeconds,
    code: "PASS_BOUND_INVALID",
    message: `--bound-seconds must be greater than zero, got ${String(boundSeconds)}`,
  }),
  boundNotWhole: ({ boundSeconds }: { boundSeconds: number }): CodexPassBoundInvalidError => ({
    boundSeconds,
    code: "PASS_BOUND_INVALID",
    message: `--bound-seconds must be a whole number of seconds, got ${String(boundSeconds)}`,
  }),
  boundTooLarge: ({ boundSeconds, max }: { boundSeconds: number; max: number }): CodexPassBoundInvalidError => ({
    boundSeconds,
    code: "PASS_BOUND_INVALID",
    message: `--bound-seconds must be at most ${String(max)} (24h), got ${String(boundSeconds)}`,
  }),
  capEvidenceIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({
      field: "capEvidence",
      message: "capEvidence must carry blockedBy, observedAtIso, reachedType and limitId",
    }),
  documentInvalid,
  documentNotJson: ({ label, cause }: { label: string; cause: unknown }): CodexFallbackDocumentNotJsonError => ({
    cause,
    code: "FALLBACK_DOCUMENT_NOT_JSON",
    label,
    message: `${label}: not JSON: ${describe({ cause })}`,
  }),
  groundIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({
      field: "ground",
      message: "ground must carry kind cyber-policy, artifactId, initialFinishedAtIso and retryFinishedAtIso",
    }),
  modeUnknown: ({ groundModes }: { groundModes: readonly string[] }): CodexFallbackFieldInvalidError =>
    fieldInvalid({ field: "mode", message: `mode must be absent, review or ${groundModes.join(" or ")}` }),
  unregisteredGroundIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({
      field: "ground",
      message: "ground must carry kind codex-provider-unregistered, observedAtIso and why",
    }),
  notAnObject: ({ field }: { field: string }): CodexFallbackFieldInvalidError =>
    fieldInvalid({ field, message: `${field} must be an object` }),
  propertyIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({ field: "property", message: "property must carry a non-empty id and statement" }),
  requestInvalid: ({
    kind,
    reasons,
    requestId,
  }: {
    kind: "review" | "plan";
    reasons: readonly string[];
    requestId: string;
  }): CodexFallbackDocumentInvalidError => {
    const lead = kind === "plan" ? "fallback plan request" : "fallback request";
    return documentInvalid({ reasons: reasons.map((reason) => `${lead} ${requestId}: ${reason}`) });
  },
  requestKindMismatch: ({
    declared,
    requestId,
    wanted,
  }: {
    declared: string | undefined;
    requestId: string;
    wanted: "review" | "plan";
  }): CodexFallbackRequestKindMismatchError => ({
    code: "FALLBACK_REQUEST_KIND_MISMATCH",
    declared,
    message: kindMismatchMessage({ declared, requestId, wanted }),
    requestId,
    wanted,
  }),
  requestNotJson: ({ requestId, cause }: { requestId: string; cause: unknown }): CodexFallbackRequestNotJsonError => ({
    cause,
    code: "FALLBACK_REQUEST_NOT_JSON",
    message: `fallback request ${requestId} is not JSON: ${describe({ cause })}`,
    requestId,
  }),
  reviewerIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({
      field: "reviewer",
      message: "reviewer must carry host claude-code, workspace and model (each a string or null)",
    }),
  treeIncomplete: (): CodexFallbackFieldInvalidError =>
    fieldInvalid({ field: "tree", message: "tree must carry branch, fingerprint, headSha and dirtyBytes" }),
} as const;

/**
 * The lines a {@link CodexError} prints, one per problem. The list variant gives each reason its own line, as
 * the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function codexErrorLines({ error }: { error: CodexError }): readonly string[] {
  if (error.code === "FALLBACK_DOCUMENT_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
