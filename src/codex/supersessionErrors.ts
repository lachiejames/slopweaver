/**
 * Why the supersession register could not be read or written. Its own union, per `.claude/rules/error-handling.md`:
 * every reader fails CLOSED on every one — `codex supersede`, `codex status`, the landing gate and a review's
 * announcement all refuse rather than judge a ledger without knowing which passes are retired — so a caller
 * displays `message` and branches on `code` only to say which.
 */
import { type ImportFileProblem, importProblemText, type StoreStepFailure } from "../store/registerImport.js";

import type { Supersession } from "./supersession.js";

/** The store could not be opened or a statement failed — which passes are retired is UNKNOWN, never "none". */
export interface SupersessionStoreUnavailableError {
  readonly code: "SUPERSESSION_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The old `codex-supersessions.jsonl` exists and would not read, so its one-time import cannot happen. */
export interface SupersessionImportUnreadableError {
  readonly code: "SUPERSESSION_IMPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The old file holds a line that is not a retirement; nothing was imported. */
export interface SupersessionImportInvalidError {
  readonly code: "SUPERSESSION_IMPORT_INVALID";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** A stored row does not decode — corrupt, never skipped. */
export interface SupersessionRecordInvalidError {
  readonly code: "SUPERSESSION_RECORD_INVALID";
  readonly message: string;
  readonly artifactId: string;
}

/** A DIFFERENT retirement of this pass is already on the record; nothing overwrites one. */
export interface AlreadySupersededError {
  readonly code: "ALREADY_SUPERSEDED";
  readonly message: string;
  readonly artifactId: string;
  readonly stored: Supersession;
}

/** Every way the supersession register refuses. */
export type SupersessionStoreError =
  | SupersessionStoreUnavailableError
  | SupersessionImportUnreadableError
  | SupersessionImportInvalidError
  | SupersessionRecordInvalidError
  | AlreadySupersededError;

/** A retirement — a line of the old file or a stored row — that is not an object at all. */
export interface SupersessionNotAnObjectError {
  readonly code: "SUPERSESSION_NOT_AN_OBJECT";
  readonly message: string;
}

/** A retirement whose named field, or one of a named group, is absent or malformed for its shape. */
export interface SupersessionFieldInvalidError {
  readonly code: "SUPERSESSION_FIELD_INVALID";
  readonly fields: readonly string[];
  readonly message: string;
}

/** A retirement whose `kind` is neither shape. */
export interface SupersessionKindUnknownError {
  readonly code: "SUPERSESSION_KIND_UNKNOWN";
  readonly kind: unknown;
  readonly message: string;
}

/** A wording retirement carrying a field only the no-tree shape has. */
export interface SupersessionFieldForbiddenError {
  readonly code: "SUPERSESSION_FIELD_FORBIDDEN";
  readonly message: string;
}

/** Why one value is not a retirement. Its `message` completes a sentence that names the value. */
export type SupersessionDecodeError =
  | SupersessionNotAnObjectError
  | SupersessionFieldInvalidError
  | SupersessionKindUnknownError
  | SupersessionFieldForbiddenError;

/**
 * A field-invalid decode error.
 *
 * @param fields which fields the check covered
 * @param message the sentence completing the value's name
 * @returns the error
 */
function fieldInvalid({
  fields,
  message,
}: {
  fields: readonly string[];
  message: string;
}): SupersessionFieldInvalidError {
  return { code: "SUPERSESSION_FIELD_INVALID", fields, message };
}

/** Constructors for {@link SupersessionDecodeError}. */
export const SupersessionDecodeErrors = {
  artifactIdInvalid: ({ artifactId }: { artifactId: unknown }): SupersessionFieldInvalidError => {
    if (typeof artifactId !== "string" || artifactId === "") {
      return fieldInvalid({ fields: ["artifactId"], message: "carries no artifactId" });
    }
    return fieldInvalid({
      fields: ["artifactId"],
      message: `carries an artifactId ${JSON.stringify(artifactId)} no pass can have`,
    });
  },
  kindUnknown: ({ kind }: { kind: unknown }): SupersessionKindUnknownError => ({
    code: "SUPERSESSION_KIND_UNKNOWN",
    kind,
    message: `carries an unknown kind ${JSON.stringify(kind)}`,
  }),
  notAnObject: (): SupersessionNotAnObjectError => ({
    code: "SUPERSESSION_NOT_AN_OBJECT",
    message: "is not an object",
  }),
  sharedFieldsMissing: (): SupersessionFieldInvalidError =>
    fieldInvalid({ fields: ["reason", "replacedBy", "atIso"], message: "is missing its reason, replacedBy or atIso" }),
  unplaceableFieldsMissing: (): SupersessionFieldInvalidError =>
    fieldInvalid({
      fields: ["pass", "mode", "branch"],
      message: "is a no-tree retirement missing its pass, mode or branch",
    }),
  unplaceablePropertyIdMalformed: (): SupersessionFieldInvalidError =>
    fieldInvalid({ fields: ["propertyId"], message: "is a no-tree retirement with a malformed propertyId" }),
  unplaceablePropertyIdMismatched: (): SupersessionFieldInvalidError =>
    fieldInvalid({
      fields: ["mode", "propertyId"],
      message: "is a no-tree retirement whose propertyId does not match its mode (a review names one, a plan none)",
    }),
  wordingCarriesNoTreeField: (): SupersessionFieldForbiddenError => ({
    code: "SUPERSESSION_FIELD_FORBIDDEN",
    message: "is a wording retirement carrying a no-tree field",
  }),
  wordingPropertyIdMissing: (): SupersessionFieldInvalidError =>
    fieldInvalid({ fields: ["propertyId"], message: "is a wording retirement with no propertyId" }),
} as const;

/** Constructors for {@link SupersessionStoreError}. */
export const SupersessionStoreErrors = {
  alreadySuperseded: ({ stored }: { stored: Supersession }): AlreadySupersededError => ({
    artifactId: stored.artifactId,
    code: "ALREADY_SUPERSEDED",
    message:
      `${stored.artifactId} is already retired (replaced by ${stored.replacedBy} at ${stored.atIso}), and a ` +
      "retirement on the record is never overwritten",
    stored,
  }),
  importProblem: ({
    problem,
  }: {
    problem: ImportFileProblem;
  }): SupersessionImportUnreadableError | SupersessionImportInvalidError => {
    const message =
      `the supersession register moved into the store and its old file must be imported once, but ` +
      `${importProblemText({ problem })} — nothing was imported, so which passes are retired is UNKNOWN`;
    if (problem.kind === "unreadable") {
      return { code: "SUPERSESSION_IMPORT_UNREADABLE", message, path: problem.path };
    }
    return { code: "SUPERSESSION_IMPORT_INVALID", message, path: problem.path, problems: problem.problems };
  },
  recordInvalid: ({ artifactId, reason }: { artifactId: string; reason: string }): SupersessionRecordInvalidError => ({
    artifactId,
    code: "SUPERSESSION_RECORD_INVALID",
    message: `the stored retirement of ${artifactId} ${reason}, so the supersession register cannot be read`,
  }),
  storeUnavailable: ({ doing, reason }: StoreStepFailure): SupersessionStoreUnavailableError => ({
    code: "SUPERSESSION_STORE_UNAVAILABLE",
    message:
      `the supersession register lives in the store, and the store could not ${doing}, so which passes are ` +
      `retired is UNKNOWN (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
