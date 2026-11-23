/**
 * Knowledge redaction's own typed failure union — why a redaction of register rows was refused. Every variant
 * names a qualified FIELD and a COUNT of rows, never a row id, a claim id or the text that matched: a refusal
 * that pointed at the row would be a second way to find the name the redaction exists to remove.
 *
 * Its own union rather than more variants on `./errors.ts`'s `KnowledgeError`, because a caller branches on these
 * as one family — each one means "nothing was written, here is the field to look at" — and none of them is a
 * fact about one recording's shape.
 */
import type { KnowledgeReferenceField } from "./redactionFields.js";

/**
 * A column that holds an IDENTITY rather than prose carries a forbidden identifier the plan cannot move: an import
 * key (a source digest the importer re-derives, so rewriting it would re-import the row), or a claim reference
 * whose claim is not in the batch being redacted.
 */
export interface RedactionIdentityHitError {
  readonly code: "KNOWLEDGE_REDACTION_IDENTITY_HIT";
  readonly message: string;
  readonly field: KnowledgeReferenceField;
  readonly rows: number;
}

/** Masking stopped making progress while a forbidden span remained — the redactor refused to claim a clean row. */
export interface RedactionIncompleteError {
  readonly code: "KNOWLEDGE_REDACTION_INCOMPLETE";
  readonly message: string;
  readonly field: KnowledgeReferenceField;
  readonly rows: number;
}

/** The pre-rewrite archive could not be written, so the rewrite it guards was rolled back. */
export interface RedactionArchiveFailedError {
  readonly code: "KNOWLEDGE_REDACTION_ARCHIVE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way a knowledge redaction is refused. */
export type KnowledgeRedactionError =
  RedactionIdentityHitError | RedactionIncompleteError | RedactionArchiveFailedError;

/** The factory every knowledge redaction failure is built through. */
export const KnowledgeRedactionErrors = {
  archiveFailed: ({ path, cause }: { path: string; cause: unknown }): RedactionArchiveFailedError => ({
    cause,
    code: "KNOWLEDGE_REDACTION_ARCHIVE_FAILED",
    message:
      `knowledge redaction: the pre-rewrite archive ${path} could not be written ` +
      `(${cause instanceof Error ? cause.message : String(cause)}) — the rewrite was rolled back, no row changed`,
    path,
  }),
  identityHit: ({ field, rows }: { field: KnowledgeReferenceField; rows: number }): RedactionIdentityHitError => ({
    code: "KNOWLEDGE_REDACTION_IDENTITY_HIT",
    field,
    message:
      `knowledge redaction: ${String(rows)} row(s) carry a forbidden identifier in ${field}, an identity column ` +
      "this redaction does not rewrite — nothing was written",
    rows,
  }),
  incomplete: ({ field, rows }: { field: KnowledgeReferenceField; rows: number }): RedactionIncompleteError => ({
    code: "KNOWLEDGE_REDACTION_INCOMPLETE",
    field,
    message:
      `knowledge redaction: ${String(rows)} row(s) still carry a forbidden identifier in ${field} after masking — ` +
      "nothing was written",
    rows,
  }),
} as const;
