/**
 * The second ground a Claude fallback review may stand on: Codex REFUSED the review twice on policy.
 *
 * Rule 9's fallback was built for a cap — Codex cannot take the pass at all. A cyber-policy refusal is the
 * other way the same review goes unanswered: Codex took the pass, read the packet, and OpenAI's filter ended
 * the turn (`./policyRefusal.ts`). `./policyRetryPass.ts` already spends the one retry a refusal earns;
 * this module decides whether a pass record proves that retry was spent AND refused, over exactly the review
 * the fallback is being prepared for. Only then does `codex review-fallback prepare --after-refusal <id>` write
 * a request, and the request carries the evidence as its `ground` instead of cap evidence it does not have.
 *
 * What it deliberately refuses:
 *
 * - **a refusal with no retry behind it** — every historical refused pass predates the retry, and none of
 *   them authorises a fallback retroactively; re-run the pass and let it retry;
 * - **a different review** — another checkout, pass, property (id or statement), diff, or tree. The refusal
 *   is evidence about ONE review, never a licence for the branch;
 * - **any other fault** — a network drop or a spend cap is not this ground; a cap has its own.
 *
 * Pure. The verb reads the record off disk; everything here takes values and returns values.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { transportFaultRefusal } from "./policyRefusal.js";
import type {
  CodexArtifactRecord,
  CodexAttempt,
  CodexPassScope,
  CodexPassTree,
  ReviewPassId,
  ReviewProperty,
} from "./types.js";

/** The request `mode` a refusal-grounded fallback declares — foreign to a build that predates it, by design. */
export const POLICY_REFUSAL_REVIEW_MODE = "review-policy-refusal";

/** What `prepare --after-refusal` saw that justified going to Claude — the pass record, by id and instant. */
export interface PolicyRefusalEvidence {
  readonly kind: "cyber-policy";
  /** The refused pass's artifact id — `$SLOPWEAVER_HOME/orchestration/<artifactId>/record.json`. */
  readonly artifactId: string;
  /** When the first refusal ended the initial attempt. */
  readonly initialFinishedAtIso: string;
  /** When the second refusal ended the one policy retry. */
  readonly retryFinishedAtIso: string;
}

/** The review a fallback request is being prepared for, which the refused pass must have been about. */
export interface PolicyFallbackSubject {
  readonly repoRoot: string;
  readonly pass: ReviewPassId;
  readonly property: ReviewProperty;
  readonly diffSha256: string;
  readonly diffBytes: number;
  readonly tree: CodexPassTree;
}

/** The record is not a finished review pass refused on policy. */
interface InvalidRefusalRecordError {
  readonly code: "INVALID_REFUSAL_RECORD";
  readonly message: string;
  readonly artifactId: string;
}

/** The refused pass was about a different review than the one being prepared. */
interface RefusalScopeMismatchError {
  readonly code: "REFUSAL_SCOPE_MISMATCH";
  readonly message: string;
  readonly artifactId: string;
  readonly field: string;
}

/** The pass was refused, but the one retry a refusal earns was never spent — or it answered. */
interface RetryNotExhaustedError {
  readonly code: "RETRY_NOT_EXHAUSTED";
  readonly message: string;
  readonly artifactId: string;
}

/** Why a pass record does not ground a refusal fallback. */
export type PolicyFallbackError = InvalidRefusalRecordError | RefusalScopeMismatchError | RetryNotExhaustedError;

/** The factories every {@link PolicyFallbackError} is built by. */
const PolicyFallbackErrors = {
  invalidRefusalRecord: ({ artifactId, why }: { artifactId: string; why: string }): InvalidRefusalRecordError => ({
    artifactId,
    code: "INVALID_REFUSAL_RECORD",
    message: `pass ${artifactId} is not a review refused on policy: ${why}`,
  }),
  refusalScopeMismatch: ({
    artifactId,
    field,
    refused,
    wanted,
  }: {
    artifactId: string;
    field: string;
    refused: string;
    wanted: string;
  }): RefusalScopeMismatchError => ({
    artifactId,
    code: "REFUSAL_SCOPE_MISMATCH",
    field,
    message:
      `pass ${artifactId} was refused over a different review: its ${field} is ${refused} and this one's is ` +
      `${wanted} — a refusal grounds only the review it refused`,
  }),
  retryNotExhausted: ({ artifactId, why }: { artifactId: string; why: string }): RetryNotExhaustedError => ({
    artifactId,
    code: "RETRY_NOT_EXHAUSTED",
    message:
      `pass ${artifactId} has not spent its one policy retry (${why}) — run the review again; a build with ` +
      `the retry refuses on policy twice before a refusal grounds a fallback`,
  }),
} as const;

/** An attempt that failed on the cyber-policy refusal, judged by its own recorded cause. */
function refusedOnPolicy({ attempt }: { attempt: CodexAttempt }): boolean {
  return attempt.status === "failed" && transportFaultRefusal({ cause: attempt.cause }) !== null;
}

/**
 * A scope or tree field as compared and shown: JSON-encoded, so a detached HEAD (`null`) never equals a branch
 * named "null", a hand-edited `[174]` never equals `174`, and a field the record lacks reads `absent`.
 *
 * @param value the field as recorded or captured
 * @returns the comparable, printable form
 */
function shownValue({ value }: { value: unknown }): string {
  if (value === undefined) {
    return "absent";
  }
  return JSON.stringify(value);
}

/**
 * The first field on which the refused review differs from the one being prepared, or `undefined`.
 *
 * @returns the field name with both values, or `undefined` when they are the same review
 */
function scopeMismatch({
  repoRoot,
  scope,
  tree,
  subject,
}: {
  repoRoot: string;
  scope: Extract<CodexPassScope, { mode: "review" }>;
  tree: CodexPassTree | undefined;
  subject: PolicyFallbackSubject;
}): { field: string; refused: string; wanted: string } | undefined {
  const pairs: readonly (readonly [string, string, string])[] = [
    ["repoRoot", shownValue({ value: repoRoot }), shownValue({ value: subject.repoRoot })],
    ["pass", shownValue({ value: scope.pass }), shownValue({ value: subject.pass })],
    ["property id", shownValue({ value: scope.property.id }), shownValue({ value: subject.property.id })],
    [
      "property statement",
      shownValue({ value: scope.property.statement }),
      shownValue({ value: subject.property.statement }),
    ],
    ["diffSha256", shownValue({ value: scope.diffSha256 }), shownValue({ value: subject.diffSha256 })],
    ["diffBytes", shownValue({ value: scope.diffBytes }), shownValue({ value: subject.diffBytes })],
    ["tree branch", shownValue({ value: tree?.branch }), shownValue({ value: subject.tree.branch })],
    ["tree headSha", shownValue({ value: tree?.headSha }), shownValue({ value: subject.tree.headSha })],
    ["tree fingerprint", shownValue({ value: tree?.fingerprint }), shownValue({ value: subject.tree.fingerprint })],
  ];
  const differing = pairs.find(([, refused, wanted]) => refused !== wanted);
  return differing === undefined ? undefined : { field: differing[0], refused: differing[1], wanted: differing[2] };
}

/**
 * Whether a pass record grounds a Claude fallback review of `subject` on a twice-refused policy pass.
 *
 * Exactly two attempts, in order: an `initial` and a `policy-retry`, each failed on the cyber-policy refusal
 * by its own recorded cause, under a `fatal` outcome that says the same. Anything short of that is not the
 * ground this module is for, and says which check it failed.
 *
 * @param artifactId the id `prepare --after-refusal` was given, echoed in every refusal
 * @param record the pass record read off disk under that id
 * @param subject the review the fallback request is being prepared for
 * @returns the evidence to write into the request, or the one check that failed
 */
export function validatePolicyFallback({
  artifactId,
  record,
  subject,
}: {
  artifactId: string;
  record: CodexArtifactRecord;
  subject: PolicyFallbackSubject;
}): Result<PolicyRefusalEvidence, PolicyFallbackError> {
  if (record.artifactId !== artifactId) {
    return err(PolicyFallbackErrors.invalidRefusalRecord({ artifactId, why: `its record names ${record.artifactId}` }));
  }
  const schemaVersion: unknown = record.schemaVersion;
  if (schemaVersion !== 1) {
    const why = `its schemaVersion is ${shownValue({ value: schemaVersion })}, not the 1 this build reads`;
    return err(PolicyFallbackErrors.invalidRefusalRecord({ artifactId, why }));
  }
  const { scope } = record;
  if (scope.mode !== "review") {
    return err(PolicyFallbackErrors.invalidRefusalRecord({ artifactId, why: "it is a plan pass" }));
  }
  // The store decodes a scope as any object, so the property the comparison reads is checked before it is read.
  const property: unknown = scope.property;
  if (!isRecord(property)) {
    return err(PolicyFallbackErrors.invalidRefusalRecord({ artifactId, why: "its scope names no property" }));
  }
  const { outcome } = record;
  if (outcome.kind !== "fatal" || transportFaultRefusal({ cause: outcome.cause }) === null) {
    return err(
      PolicyFallbackErrors.invalidRefusalRecord({
        artifactId,
        why: `its outcome is ${shownValue({ value: outcome.kind })}, not a fatal cyber-policy refusal`,
      }),
    );
  }
  const mismatch = scopeMismatch({ repoRoot: record.repoRoot, scope, subject, tree: record.tree });
  if (mismatch !== undefined) {
    return err(PolicyFallbackErrors.refusalScopeMismatch({ artifactId, ...mismatch }));
  }
  return refusedAttempts({ artifactId, record }).map(({ initial, retry }) => ({
    artifactId,
    initialFinishedAtIso: initial.finishedAtIso,
    kind: "cyber-policy" as const,
    retryFinishedAtIso: retry.finishedAtIso,
  }));
}

/**
 * The record's two refused attempts — an `initial` then one `policy-retry`, each well-formed and each failed on
 * the cyber-policy refusal by its own recorded cause — or the one check they fail.
 *
 * @returns both attempts, or why they do not ground a fallback
 */
function refusedAttempts({
  artifactId,
  record,
}: {
  artifactId: string;
  record: CodexArtifactRecord;
}): Result<{ initial: CodexAttempt; retry: CodexAttempt }, PolicyFallbackError> {
  // The store's decode is shallow, so an old or hand-edited record may carry no attempts array at all, or
  // attempts missing what the evidence copies — a request built on one would be refused by this build's reader.
  const attempts: readonly CodexAttempt[] = Array.isArray(record.attempts) ? record.attempts : [];
  const malformed = attempts
    .map((attempt, index) => attemptShapeProblem({ attempt, index }))
    .find((why) => why !== undefined);
  if (malformed !== undefined) {
    return err(PolicyFallbackErrors.invalidRefusalRecord({ artifactId, why: malformed }));
  }
  const [initial, retry, ...rest] = attempts;
  if (initial?.kind !== "initial" || !refusedOnPolicy({ attempt: initial })) {
    return err(
      PolicyFallbackErrors.invalidRefusalRecord({
        artifactId,
        why: "its initial attempt carries no recorded cyber-policy cause",
      }),
    );
  }
  if (retry?.kind !== "policy-retry" || rest.length > 0) {
    return err(
      PolicyFallbackErrors.retryNotExhausted({
        artifactId,
        why: `attempts ${attempts.map((attempt) => attempt.kind).join(", ")}`,
      }),
    );
  }
  if (!refusedOnPolicy({ attempt: retry })) {
    return err(
      PolicyFallbackErrors.retryNotExhausted({ artifactId, why: `the retry ended ${retry.status} on another cause` }),
    );
  }
  return ok({ initial, retry });
}

/** The attempt kinds and statuses a record can carry. */
const ATTEMPT_KINDS: ReadonlySet<unknown> = new Set<CodexAttempt["kind"]>(["initial", "policy-retry", "conclusion"]);
const ATTEMPT_STATUSES: ReadonlySet<unknown> = new Set<CodexAttempt["status"]>(["answered", "aborted", "failed"]);

/**
 * What a recorded attempt lacks of the {@link CodexAttempt} shape, or `undefined` when it has it all. The
 * optional `cause` is `refusedOnPolicy`'s business.
 */
function attemptShapeProblem({ attempt, index }: { attempt: unknown; index: number }): string | undefined {
  if (!isRecord(attempt)) {
    return `attempt ${String(index)} is not an object`;
  }
  const checks: readonly (readonly [string, boolean])[] = [
    ["known kind", ATTEMPT_KINDS.has(attempt["kind"])],
    ["known status", ATTEMPT_STATUSES.has(attempt["status"])],
    ["threadId", attempt["threadId"] === null || typeof attempt["threadId"] === "string"],
    ["startedAtIso", typeof attempt["startedAtIso"] === "string"],
    ["finishedAtIso", typeof attempt["finishedAtIso"] === "string"],
    ["elapsedMs", typeof attempt["elapsedMs"] === "number"],
    ["usage", measurementKind({ value: attempt["usage"] })],
    ["items", measurementKind({ value: attempt["items"] })],
  ];
  const failed = checks.find(([, holds]) => !holds);
  return failed === undefined ? undefined : `attempt ${String(index)} records no ${failed[0]}`;
}

/** Whether a usage or item tally carries one of the two kinds either union allows. */
function measurementKind({ value }: { value: unknown }): boolean {
  return isRecord(value) && (value["kind"] === "measured" || value["kind"] === "not-measured");
}
