/**
 * The fleet import's own typed failures.
 *
 * One `<Domain>Error` union for this directory, per `.claude/rules/error-handling.md`: the failures here
 * are genuinely distinct KINDS a caller branches on — a malformed line has a line number to print, a
 * missing source directory is a state fact, and a line whose timestamp cannot be read is refused rather
 * than defaulted. Collapsing them into `readonly string[]` would lose the line number, which is the one
 * thing the operator needs to go and look at the file.
 *
 * The failures about a legacy ledger line (a fallback document, a grant line, an autonomy line the store
 * already disagrees with or will not hold) are declared in `./ledgerImportErrors.ts` and are members of the
 * same union and the same factory object below, as are a captured turn's in `./captureImportErrors.ts`.
 */
import { CaptureImportErrors, type UnstorableOwnerCaptureError } from "./captureImportErrors.js";
import {
  type AutonomyImportDivergedError,
  type AutonomyLineRefusedError,
  type DoorImportDivergedError,
  type FallbackImportDivergedError,
  type GrantImportDivergedError,
  LedgerImportErrors,
} from "./ledgerImportErrors.js";

/** A physical line that did not decode as JSON, or decoded to something that is not an object. */
export interface UnreadableLineError {
  readonly code: "UNREADABLE_LINE";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
}

/** A line missing a field the table declares `notNull`, named so the operator can see which. */
export interface MissingFieldError {
  readonly code: "MISSING_FIELD";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly field: string;
}

/** A timestamp in a LINE that is present but not a readable instant. Never defaulted. */
export interface UnreadableInstantError {
  readonly code: "UNREADABLE_INSTANT";
  readonly message: string;
  readonly path: string;
  readonly lineNumber: number;
  readonly value: string;
}

/**
 * A DOCUMENT field that is present and unreadable.
 *
 * Its own variant rather than a reuse of {@link UnreadableInstantError} because a board row is a whole
 * file, so there is no line number to report and a zero would be a fabricated one. The field name is what
 * a reader needs instead.
 */
export interface UnreadableDocFieldError {
  readonly code: "UNREADABLE_DOC_FIELD";
  readonly message: string;
  readonly path: string;
  readonly field: string;
  readonly value: string;
}

/** A source file or directory the import was pointed at that is not there. */
export interface SourceAbsentError {
  readonly code: "SOURCE_ABSENT";
  readonly message: string;
  readonly path: string;
}

/**
 * The store refused a batch this import had already projected.
 *
 * Its own variant rather than a reuse of {@link SourceAbsentError}, which the first draft of the CLI shell
 * did: a database failure reported as "the file does not exist" sends the operator to look at a file that
 * is sitting right there. The message a caller displays is the store's own.
 */
export interface LegWriteFailedError {
  readonly code: "LEG_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/**
 * An owner-turn file, or a reference to one, that the store cannot hold as the owner's words verbatim.
 *
 * Its own variant because every reason here is a refusal to ALTER the owner's text: a NUL byte Postgres `text`
 * cannot carry, bytes that are not UTF-8, a path outside the two owner-turn roots. Each is named with the
 * file and never stripped or re-encoded into something the owner did not write.
 */
export interface UnstorableTurnFileError {
  readonly code: "UNSTORABLE_TURN_FILE";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * A file under an authored directory, or a reference to one, that the store will not hold.
 *
 * Its own variant rather than a reuse of {@link UnstorableTurnFileError}: that one promises the text is the owner's
 * words verbatim, and these reasons are about a path, a size or a credential the file carries. Each names the
 * file; none is ever cleaned into something storable.
 */
export interface UnstorableAuthoredFileError {
  readonly code: "UNSTORABLE_AUTHORED_FILE";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * A Claude fallback request or receipt the store cannot hold verbatim.
 *
 * Its own variant for the same reason as {@link UnstorableTurnFileError}: a receipt binds to its request by
 * the digest of the request's exact bytes, so the only honest outcomes are "stored as it is" and "named and
 * left on disk" — never a cleaned copy whose digest no longer matches.
 */
export interface UnstorableFallbackDocumentError {
  readonly code: "UNSTORABLE_FALLBACK_DOCUMENT";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * A measurement file, or a reference to one, the store cannot hold or hand back as it was written.
 *
 * Its own variant rather than a reuse of {@link UnstorableTurnFileError}: a measurement is never refused for
 * its BYTES — a NUL or a non-UTF-8 file simply goes to Storage — so every reason here is about WHERE it is: a
 * directory that would not read, a ref outside the four roots, a restore path that would leave its target.
 */
export interface UnstorableMeasurementError {
  readonly code: "UNSTORABLE_MEASUREMENT";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/** A `--class` word `measurement_location.class` has no row for. */
export interface UnknownMeasurementClassError {
  readonly code: "UNKNOWN_MEASUREMENT_CLASS";
  readonly message: string;
  readonly value: string;
}

/** A path `store authored-show` asked for that the store holds no bytes for — never imported, or its body gone. */
export interface AuthoredNotStoredError {
  readonly code: "AUTHORED_NOT_STORED";
  readonly message: string;
  readonly path: string;
}

/** A git bundle whose pack could not be walked to its end, so its objects cannot be scanned. */
export interface UnreadableGitBundleError {
  readonly code: "UNREADABLE_GIT_BUNDLE";
  readonly message: string;
  readonly reason: string;
}

/** Every way projecting the home's record-shaped files into store rows, or reading them back, can fail. */
export type FleetImportError =
  | AutonomyImportDivergedError
  | AutonomyLineRefusedError
  | DoorImportDivergedError
  | UnstorableAuthoredFileError
  | AuthoredNotStoredError
  | UnreadableGitBundleError
  | FallbackImportDivergedError
  | GrantImportDivergedError
  | UnstorableFallbackDocumentError
  | UnstorableMeasurementError
  | UnknownMeasurementClassError
  | UnstorableTurnFileError
  | UnstorableOwnerCaptureError
  | UnreadableLineError
  | MissingFieldError
  | UnreadableInstantError
  | UnreadableDocFieldError
  | LegWriteFailedError
  | SourceAbsentError;

/** The factories the projections and their tests both build failures with. */
export const FleetImportErrors = {
  missingField: ({
    path,
    lineNumber,
    field,
  }: {
    path: string;
    lineNumber: number;
    field: string;
  }): MissingFieldError => ({
    code: "MISSING_FIELD",
    field,
    lineNumber,
    message: `${path}:${String(lineNumber)} carries no ${field}, which the row requires`,
    path,
  }),
  legWriteFailed: ({ path, reason }: { path: string; reason: string }): LegWriteFailedError => ({
    code: "LEG_WRITE_FAILED",
    message: `the store refused rows projected from ${path}: ${reason}`,
    path,
  }),
  sourceAbsent: ({ path }: { path: string }): SourceAbsentError => ({
    code: "SOURCE_ABSENT",
    message: `${path} does not exist — nothing to import from it`,
    path,
  }),
  unreadableDocField: ({
    path,
    field,
    value,
  }: {
    path: string;
    field: string;
    value: string;
  }): UnreadableDocFieldError => ({
    code: "UNREADABLE_DOC_FIELD",
    field,
    message: `${path} declares ${field}: "${value}", which is not a readable instant`,
    path,
    value,
  }),
  unreadableInstant: ({
    path,
    lineNumber,
    value,
  }: {
    path: string;
    lineNumber: number;
    value: string;
  }): UnreadableInstantError => ({
    code: "UNREADABLE_INSTANT",
    lineNumber,
    message: `${path}:${String(lineNumber)} carries "${value}", which is not a readable instant`,
    path,
    value,
  }),
  authoredPathNotStored: ({
    path,
    importCommand,
  }: {
    path: string;
    importCommand: string;
  }): AuthoredNotStoredError => ({
    code: "AUTHORED_NOT_STORED",
    message: `the store holds nothing at ${path} — run \`${importCommand}\` while the file exists`,
    path,
  }),
  authoredBodyNotStored: ({ path, bodySha256 }: { path: string; bodySha256: string }): AuthoredNotStoredError => ({
    code: "AUTHORED_NOT_STORED",
    message: `${path} names body ${bodySha256}, which the store does not hold`,
    path,
  }),
  unreadableGitBundle: ({ reason }: { reason: string }): UnreadableGitBundleError => ({
    code: "UNREADABLE_GIT_BUNDLE",
    message: `the git bundle's pack could not be read: ${reason}`,
    reason,
  }),
  unstorableAuthoredFile: ({ path, reason }: { path: string; reason: string }): UnstorableAuthoredFileError => ({
    code: "UNSTORABLE_AUTHORED_FILE",
    message: `${path} is not stored as authored working state: ${reason}`,
    path,
    reason,
  }),
  ...LedgerImportErrors,
  ...CaptureImportErrors,
  unstorableFallbackDocument: ({
    path,
    reason,
  }: {
    path: string;
    reason: string;
  }): UnstorableFallbackDocumentError => ({
    code: "UNSTORABLE_FALLBACK_DOCUMENT",
    message: `${path} cannot be stored as a Claude fallback document verbatim: ${reason}`,
    path,
    reason,
  }),
  unstorableMeasurement: ({ path, reason }: { path: string; reason: string }): UnstorableMeasurementError => ({
    code: "UNSTORABLE_MEASUREMENT",
    message: `${path} cannot be stored or restored as a measurement: ${reason}`,
    path,
    reason,
  }),
  unknownMeasurementClass: ({
    value,
    known,
  }: {
    value: string;
    known: readonly string[];
  }): UnknownMeasurementClassError => ({
    code: "UNKNOWN_MEASUREMENT_CLASS",
    message: `--class ${value} is not one of ${known.join(", ")}`,
    value,
  }),
  unstorableTurnFile: ({ path, reason }: { path: string; reason: string }): UnstorableTurnFileError => ({
    code: "UNSTORABLE_TURN_FILE",
    message: `${path} cannot be stored as an owner turn verbatim: ${reason}`,
    path,
    reason,
  }),
  unreadableLine: ({ path, lineNumber }: { path: string; lineNumber: number }): UnreadableLineError => ({
    code: "UNREADABLE_LINE",
    lineNumber,
    message: `${path}:${String(lineNumber)} did not decode as a JSON object`,
    path,
  }),
} as const;
