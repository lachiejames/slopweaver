/**
 * Decoding a Claude fallback review's documents off disk — the request, its tree, its cap or refusal ground,
 * the visible session, and the receipt — each into its type or every reason it is not one.
 *
 * Split out of `./fallbackReview.ts` along the seam between what a fallback review MEANS (there: validation,
 * binding, the ledger fold) and how its JSON is READ (here). `./fallbackPlan.ts` shares the tree, cap-evidence
 * and visible-session parsers, so the two receipts cannot disagree about what any of those are.
 *
 * Pure. Every function here takes values and returns values.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { type CodexError, CodexErrors, codexErrorLines } from "./errors.js";
import type {
  ClaudeFallbackReviewReceipt,
  ClaudeFallbackReviewRequest,
  FallbackCapEvidence,
  FallbackReviewGround,
  FallbackReviewRequestCore,
  VisibleClaudeReviewer,
} from "./fallbackReview.js";
import { originRepositoryField } from "./originBinding.js";
import { parseReviewAnswer } from "./output.js";
import { POLICY_REFUSAL_REVIEW_MODE, type PolicyRefusalEvidence } from "./policyFallback.js";
import { CODEX_UNREGISTERED_REVIEW_MODE, parseProviderUnregisteredEvidence } from "./providerUnregistered.js";
import type { CodexPassTree, ReviewAnswer, ReviewPassId, ReviewProperty } from "./types.js";

/** A string field of a record, or `undefined`. */
function stringAt({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** A finite number field of a record, or `undefined`. */
function numberAt({ record, key }: { record: Record<string, unknown>; key: string }): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A `string | null` field, or `undefined` when it is neither. */
function nullableStringAt({
  record,
  key,
}: {
  record: Record<string, unknown>;
  key: string;
}): string | null | undefined {
  const value = record[key];
  if (value === null || typeof value === "string") {
    return value;
  }
  return undefined;
}

/** The review passes a request may stand in for. */
const REVIEW_PASSES: ReadonlySet<string> = new Set<ReviewPassId>(["r1", "r2", "r3"]);

/** Narrow a value to a review pass id. A predicate, so TS1230 rules out destructuring. */
function isReviewPassId(value: unknown): value is ReviewPassId {
  return typeof value === "string" && REVIEW_PASSES.has(value);
}

/**
 * Decode the tree a request captured, refusing anything that is not a complete provenance triple.
 *
 * @param value the `tree` field as parsed off disk
 * @returns the tree, or why it is not one
 */
export function parseFallbackTree({ value }: { value: unknown }): Result<CodexPassTree, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "tree" });
  }
  const branch = nullableStringAt({ key: "branch", record: value });
  const fingerprint = stringAt({ key: "fingerprint", record: value });
  const headSha = stringAt({ key: "headSha", record: value });
  const treeSha = stringAt({ key: "treeSha", record: value });
  const dirtyBytes = numberAt({ key: "dirtyBytes", record: value });
  if (branch === undefined || fingerprint === undefined || headSha === undefined || dirtyBytes === undefined) {
    return err(CodexErrors.treeIncomplete());
  }
  return ok({ branch, dirtyBytes, fingerprint, headSha, ...(treeSha === undefined ? {} : { treeSha }) });
}

/**
 * Decode a request off disk, refusing any shape a receipt could not honestly bind to.
 *
 * Full validation rather than the shallow cast `ledgerStore.ts` uses for pass records, because a request
 * is read by a verb that will WRITE evidence against it: a half-shaped request would let a receipt claim a
 * property or a diff it never named.
 *
 * @param value the parsed JSON
 * @returns the request, or every reason it is not one
 */
export function parseFallbackRequest({ value }: { value: unknown }): Result<ClaudeFallbackReviewRequest, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "request" });
  }
  const scalars = parseRequestScalars({ value });
  const property = parseProperty({ value: value["property"] });
  const tree = parseFallbackTree({ value: value["tree"] });
  const ground = parseRequestGround({ value });
  const errors = [
    ...(scalars.isErr() ? codexErrorLines({ error: scalars.error }) : []),
    ...(property.isErr() ? codexErrorLines({ error: property.error }) : []),
    ...(tree.isErr() ? codexErrorLines({ error: tree.error }) : []),
    ...(ground.isErr() ? codexErrorLines({ error: ground.error }) : []),
  ];
  if (errors.length > 0 || scalars.isErr() || property.isErr() || tree.isErr() || ground.isErr()) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({
    ...scalars.value,
    ...ground.value,
    property: property.value,
    schemaVersion: 1,
    tree: tree.value,
  });
}

/**
 * Decode what grounded the request: cap evidence when it declares no mode (or `review`), refusal evidence when
 * it declares the refusal mode, provider-absence evidence on the unregistered mode. Any other mode is not a
 * review request this parser can read.
 *
 * @returns the ground arm, or why it is not one
 */
function parseRequestGround({ value }: { value: Record<string, unknown> }): Result<FallbackReviewGround, CodexError> {
  const mode = value["mode"];
  if (mode === POLICY_REFUSAL_REVIEW_MODE) {
    return parsePolicyRefusalEvidence({ value: value["ground"] }).map((ground): FallbackReviewGround => ({
      ground,
      mode,
    }));
  }
  if (mode === CODEX_UNREGISTERED_REVIEW_MODE) {
    return parseProviderUnregisteredEvidence({ value: value["ground"] }).map((ground): FallbackReviewGround => ({
      ground,
      mode,
    }));
  }
  if (mode !== undefined && mode !== "review") {
    return err(CodexErrors.modeUnknown({ groundModes: [POLICY_REFUSAL_REVIEW_MODE, CODEX_UNREGISTERED_REVIEW_MODE] }));
  }
  return parseFallbackCapEvidence({ value: value["capEvidence"] }).map((capEvidence): FallbackReviewGround => ({
    capEvidence,
  }));
}

/** The request's flat fields — every string, the pass, and the byte count — or every reason one is missing. */
function parseRequestScalars({
  value,
}: {
  value: Record<string, unknown>;
}): Result<Omit<FallbackReviewRequestCore, "schemaVersion" | "property" | "tree">, CodexError> {
  const errors: string[] = [];
  const strings = {
    baseRef: stringAt({ key: "baseRef", record: value }),
    baseSha: stringAt({ key: "baseSha", record: value }),
    createdAtIso: stringAt({ key: "createdAtIso", record: value }),
    diffSha256: stringAt({ key: "diffSha256", record: value }),
    headSha: stringAt({ key: "headSha", record: value }),
    repoRoot: stringAt({ key: "repoRoot", record: value }),
    requestId: stringAt({ key: "requestId", record: value }),
  };
  const pass = value["pass"];
  const diffBytes = numberAt({ key: "diffBytes", record: value });
  if (value["schemaVersion"] !== 1) {
    errors.push("schemaVersion must be 1");
  }
  for (const [key, present] of Object.entries(strings)) {
    if (present === undefined) {
      errors.push(`${key} must be a string`);
    }
  }
  if (!isReviewPassId(pass)) {
    errors.push("pass must be r1, r2 or r3");
  }
  if (diffBytes === undefined) {
    errors.push("diffBytes must be a number");
  }
  const { baseRef, baseSha, createdAtIso, diffSha256, headSha, repoRoot, requestId } = strings;
  if (
    errors.length > 0 ||
    baseRef === undefined ||
    baseSha === undefined ||
    createdAtIso === undefined ||
    diffSha256 === undefined ||
    headSha === undefined ||
    repoRoot === undefined ||
    requestId === undefined ||
    !isReviewPassId(pass) ||
    diffBytes === undefined
  ) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({
    baseRef,
    baseSha,
    createdAtIso,
    diffBytes,
    diffSha256,
    headSha,
    // Validated as `owner/name`; a malformed value reads as absent, never as a binding (`./originBinding.ts`).
    ...originRepositoryField({ value: value["originRepository"] }),
    pass,
    repoRoot,
    requestId,
  });
}

/** Decode the single property a request names. */
function parseProperty({ value }: { value: unknown }): Result<ReviewProperty, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "property" });
  }
  const id = stringAt({ key: "id", record: value });
  const statement = stringAt({ key: "statement", record: value });
  if (id === undefined || id.trim().length === 0 || statement === undefined || statement.trim().length === 0) {
    return err(CodexErrors.propertyIncomplete());
  }
  return ok({ id, statement });
}

/**
 * Decode the cap evidence a request captured.
 *
 * @param value the `capEvidence` field as parsed off disk
 * @returns the evidence, or why it is not complete
 */
export function parseFallbackCapEvidence({ value }: { value: unknown }): Result<FallbackCapEvidence, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "capEvidence" });
  }
  const blockedBy = stringAt({ key: "blockedBy", record: value });
  const observedAtIso = stringAt({ key: "observedAtIso", record: value });
  const reachedType = nullableStringAt({ key: "reachedType", record: value });
  const limitId = nullableStringAt({ key: "limitId", record: value });
  if (blockedBy === undefined || observedAtIso === undefined || reachedType === undefined || limitId === undefined) {
    return err(CodexErrors.capEvidenceIncomplete());
  }
  return ok({ blockedBy, limitId, observedAtIso, reachedType });
}

/** Decode the answer a receipt carries — the SAME fields a Codex review answer has. */
function parseAnswer({ value, property }: { value: unknown; property: ReviewProperty }): Result<ReviewAnswer> {
  // Round-trip through the review-output validator so a receipt written by hand with a `BROKEN` and no
  // counterexample is refused at read time exactly as it would have been at record time.
  return parseReviewAnswer({ property, response: JSON.stringify(value) });
}

/**
 * Decode the visible-session attestation a receipt carries — the reviewer's, or the planner's.
 *
 * @param value the `reviewer` or `planner` field as parsed off disk
 * @returns the attestation, or why it is not one
 */
export function parseVisibleClaudeSession({ value }: { value: unknown }): Result<VisibleClaudeReviewer, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "reviewer" });
  }
  const workspace = nullableStringAt({ key: "workspace", record: value });
  const model = nullableStringAt({ key: "model", record: value });
  if (value["host"] !== "claude-code" || workspace === undefined || model === undefined) {
    return err(CodexErrors.reviewerIncomplete());
  }
  return ok({ host: "claude-code", model, workspace });
}

/**
 * Decode a receipt off disk.
 *
 * Shape only. Whether it still BINDS to the request bytes beside it is {@link receiptBindingFailure}, asked
 * by the store once it has both files, because a receipt that parses and a receipt that is evidence are two
 * different facts.
 *
 * @param value the parsed JSON
 * @returns the receipt, or every reason it is not one
 */
export function parseFallbackReceipt({ value }: { value: unknown }): Result<ClaudeFallbackReviewReceipt, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "receipt" });
  }
  const errors: string[] = [];
  const receiptId = stringAt({ key: "receiptId", record: value });
  const requestId = stringAt({ key: "requestId", record: value });
  const requestSha256 = stringAt({ key: "requestSha256", record: value });
  const completedAtIso = stringAt({ key: "completedAtIso", record: value });
  if (value["schemaVersion"] !== 1) {
    errors.push("schemaVersion must be 1");
  }
  for (const [key, present] of [
    ["receiptId", receiptId],
    ["requestId", requestId],
    ["requestSha256", requestSha256],
    ["completedAtIso", completedAtIso],
  ] as const) {
    if (present === undefined) {
      errors.push(`${key} must be a string`);
    }
  }
  const request = parseFallbackRequest({ value: value["request"] });
  if (request.isErr()) {
    errors.push(...codexErrorLines({ error: request.error }).map((reason) => `request: ${reason}`));
  }
  const reviewer = parseVisibleClaudeSession({ value: value["reviewer"] });
  if (reviewer.isErr()) {
    errors.push(...codexErrorLines({ error: reviewer.error }));
  }
  const answer = request.isOk() ? parseAnswer({ property: request.value.property, value: value["answer"] }) : undefined;
  if (answer?.isErr() === true) {
    errors.push(...answer.error.map((reason) => `answer: ${reason}`));
  }
  if (
    errors.length > 0 ||
    receiptId === undefined ||
    requestId === undefined ||
    requestSha256 === undefined ||
    completedAtIso === undefined ||
    request.isErr() ||
    reviewer.isErr() ||
    answer === undefined ||
    answer.isErr()
  ) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({
    answer: answer.value,
    completedAtIso,
    receiptId,
    request: request.value,
    requestId,
    requestSha256,
    reviewer: reviewer.value,
    schemaVersion: 1,
  });
}

/**
 * The one failure every object-shaped field shares, whichever field it is.
 *
 * @param field the field that was not an object
 * @returns the failure, naming the field
 */
export function notAnObject({ field }: { field: string }): Result<never, CodexError> {
  return err(CodexErrors.notAnObject({ field }));
}

/**
 * Decode the refusal evidence a request carries as its `ground`.
 *
 * @param value the `ground` field as parsed off disk
 * @returns the evidence, or why it is not complete
 */
export function parsePolicyRefusalEvidence({ value }: { value: unknown }): Result<PolicyRefusalEvidence, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "ground" });
  }
  const { artifactId, initialFinishedAtIso, kind, retryFinishedAtIso } = value;
  if (
    kind !== "cyber-policy" ||
    typeof artifactId !== "string" ||
    typeof initialFinishedAtIso !== "string" ||
    typeof retryFinishedAtIso !== "string"
  ) {
    return err(CodexErrors.groundIncomplete());
  }
  return ok({ artifactId, initialFinishedAtIso, kind, retryFinishedAtIso });
}
