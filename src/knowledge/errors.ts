/**
 * The knowledge register's own typed failure union.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `knowledge record` exits differently on a malformed row than on an
 * unreadable store, and the settle gate distinguishes "nothing was declared" from "the register could not be
 * read at all" — treating the second as the first would let an I/O failure silently satisfy a gate whose
 * entire job is to refuse silence. The restore-only variants' shapes live in `./restoreErrors.ts`.
 */
import { resolve } from "node:path";

import { shellCommandLine } from "#lib/shellCommandLine.js";

/**
 * The `--home` flag a printed `knowledge domains add` instruction carries, for the home whose store holds the
 * install's domains. Absolute, because the flag parser refuses a value starting with `--` and a relative home can.
 *
 * @param home the state home whose store the domain would be added to
 * @returns the quoted `--home <dir>` tokens
 */
export function homeFlag({ home }: { home: string }): string {
  return shellCommandLine({ command: ["--home", resolve(home)] });
}

import type {
  RestoreClosureBrokenError,
  RestoreConflictError,
  RestoreDuplicateKeyError,
  RestoreLockBusyError,
  RestoreNotEmptyError,
  RestoreSeqExhaustedError,
  RestoreTable,
} from "./restoreErrors.js";

/** A field is absent, empty, too long, or not one of its closed vocabulary's members. */
export interface InvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: string;
}

/** The domain is not a slug — free text or punctuation, which would not project to a checked column. */
export interface InvalidDomainError {
  readonly code: "INVALID_DOMAIN";
  readonly message: string;
  readonly domain: string;
}

/** The domain is a retired spelling of one in the vocabulary (`./domains.ts`). Names the one to use. */
export interface DomainRetiredError {
  readonly code: "DOMAIN_RETIRED";
  readonly message: string;
  readonly domain: string;
  readonly canonical: string;
}

/**
 * The domain is a slug, but neither the committed vocabulary (`./domains.ts`) nor this install's own domains in
 * its store hold it. Carries the home, because adding an install's own domain is `knowledge domains add` there.
 */
export interface DomainNotConfiguredError {
  readonly code: "DOMAIN_NOT_CONFIGURED";
  readonly message: string;
  readonly domain: string;
  readonly home: string;
}

/**
 * A `--supersedes` names a claim this recording cannot retire: its own, one never recorded, or one of another
 * kind. Carries the id so the writer can check it against `knowledge recall`.
 */
export interface SupersedesRefusedError {
  readonly code: "SUPERSEDES_REFUSED";
  readonly message: string;
  readonly supersedes: string;
}

/** A stored line could not be decoded. Carries the line number so the file can be inspected by hand. */
export interface CorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
}

/** The register could not be read or appended to. Never conflated with an EMPTY register. */
export interface StoreUnreadableError {
  readonly code: "STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/**
 * The writer declared a destination other than the memories table, so this is not the place for it.
 *
 * A POLICY refusal rather than a field error: the input was well formed and a gate said no, which
 * `.claude/rules/error-handling.md` gives its own shape and its own escape hatch.
 */
export interface PlacementRefusedError {
  readonly code: "PLACEMENT_REFUSED";
  readonly message: string;
  readonly placement: string;
}

/** The memories table could not be read or written. Never conflated with a query that matched nothing. */
export interface DatabaseFailedError {
  readonly code: "DATABASE_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** A stored recording is not the lesson its kind claims — a facet the CHECK constraint should have refused is null. */
export interface CorruptRecordingError {
  readonly code: "CORRUPT_RECORDING";
  readonly message: string;
  readonly recordingId: string;
}

/** An import would write a row the table already holds under a different shape. */
export interface ImportConflictError {
  readonly code: "IMPORT_CONFLICT";
  readonly message: string;
  readonly importKey: string;
}

/** A recall names a claim id the register has never recorded, so there is nothing to account for. */
export interface MemoryUnknownError {
  readonly code: "MEMORY_UNKNOWN";
  readonly message: string;
  readonly memoryId: string;
}

/** A prune plan line is refused — unreadable, invalid in a field, or contradicting another line of the plan. */
export interface PlanLineRefusedError {
  readonly code: "PLAN_LINE_REFUSED";
  readonly message: string;
  readonly lineNumber: number;
}

/** Every way this domain fails. */
export type KnowledgeError =
  | RestoreNotEmptyError
  | RestoreSeqExhaustedError
  | RestoreConflictError
  | RestoreDuplicateKeyError
  | RestoreClosureBrokenError
  | RestoreLockBusyError
  | PlanLineRefusedError
  | MemoryUnknownError
  | InvalidFieldError
  | InvalidDomainError
  | DomainRetiredError
  | DomainNotConfiguredError
  | SupersedesRefusedError
  | CorruptRowError
  | CorruptRecordingError
  | StoreUnreadableError
  | PlacementRefusedError
  | DatabaseFailedError
  | ImportConflictError;

/**
 * The readable half of whatever the driver threw, with no connection string in it.
 *
 * @param cause what the driver threw
 * @returns its message, or a stable phrase when it carried none
 */
function databaseCauseText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.length > 0) {
    return cause;
  }
  return "the store refused, and carried no message";
}

/**
 * What one kind of merge clash means, in words an operator can act on.
 *
 * @param conflict the clash kind
 * @returns the phrase
 */
function conflictPhrase({ conflict }: { conflict: RestoreConflictError["conflict"] }): string {
  switch (conflict) {
    case "recording-differs":
      return "the database already holds this recording with different content";
    case "recall-differs":
      return "the database already holds this recall with different content";
    case "import-key-taken":
      return "another recording in the database already carries this row's import key";
    default: {
      const unreachable: never = conflict;
      return unreachable;
    }
  }
}

/**
 * What one kind of broken link means.
 *
 * @param link the link kind
 * @returns the phrase
 */
function closurePhrase({ link }: { link: RestoreClosureBrokenError["link"] }): string {
  switch (link) {
    case "supersedes":
      return "its supersedes names no claim of its own kind in the database or the export, or names its own claim";
    case "recall-recording":
      return "it names a recording neither the database nor the export holds";
    case "recall-claim":
      return "it names a recording that belongs to a different claim than the recall's own";
    default: {
      const unreachable: never = link;
      return unreachable;
    }
  }
}

/** Constructors for {@link KnowledgeError}. The only place a knowledge error is built. */
export const KnowledgeErrors = {
  restoreNotEmpty: ({ table }: { table: RestoreTable }): RestoreNotEmptyError => ({
    code: "RESTORE_NOT_EMPTY",
    message:
      `the ${table} table already holds rows. A default restore is recovery into a fresh database — pass ` +
      "--merge to add an export to a live one. Nothing was written",
    table,
  }),
  restoreConflict: ({
    table,
    conflict,
    rowId,
  }: {
    table: RestoreTable;
    conflict: RestoreConflictError["conflict"];
    rowId: string;
  }): RestoreConflictError => ({
    code: "RESTORE_CONFLICT",
    conflict,
    message:
      `${table} row ${rowId}: ${conflictPhrase({ conflict })} — the merge was refused whole and nothing was ` +
      "written. Reconcile the two by hand; a merge never picks one history over another",
    rowId,
    table,
  }),
  restoreDuplicateKey: ({
    table,
    key,
    value,
  }: {
    table: RestoreTable;
    key: RestoreDuplicateKeyError["key"];
    value: string;
  }): RestoreDuplicateKeyError => ({
    code: "RESTORE_DUPLICATE_KEY",
    key,
    message: `the export holds two ${table} rows sharing ${key} ${value} — a damaged backup, refused whole`,
    table,
    value,
  }),
  restoreSeqExhausted: ({ table, floor }: { table: RestoreTable; floor: number }): RestoreSeqExhaustedError => ({
    code: "RESTORE_SEQ_EXHAUSTED",
    floor,
    message:
      `the ${table} table's highest seq is ${String(floor)}, and renumbering the export above it would pass the ` +
      "largest integer a sequence value can be read back as — the merge was refused whole and nothing was written",
    table,
  }),
  restoreClosureBroken: ({
    table,
    link,
    rowId,
  }: {
    table: RestoreTable;
    link: RestoreClosureBrokenError["link"];
    rowId: string;
  }): RestoreClosureBrokenError => ({
    code: "RESTORE_CLOSURE_BROKEN",
    link,
    message: `${table} row ${rowId}: ${closurePhrase({ link })} — the merge was refused whole and nothing was written`,
    rowId,
    table,
  }),
  restoreLockBusy: ({ attempts }: { attempts: number }): RestoreLockBusyError => ({
    attempts,
    code: "RESTORE_LOCK_BUSY",
    message:
      `another session was writing to memories or memory_recalls through all ${String(attempts)} asks for their ` +
      "locks — nothing was written; run the restore again once the fleet is quieter",
  }),
  planLineRefused: ({ lineNumber, why }: { lineNumber: number; why: string }): PlanLineRefusedError => ({
    code: "PLAN_LINE_REFUSED",
    lineNumber,
    message: `line ${String(lineNumber)}: ${why}`,
  }),
  memoryUnknown: ({ memoryId }: { memoryId: string }): MemoryUnknownError => ({
    code: "MEMORY_UNKNOWN",
    memoryId,
    message:
      `no recording carries the claim id ${memoryId} — recall it first and copy the id from the page, ` +
      "since an accounting row against a claim nobody recorded would count a recall that never happened",
  }),
  invalidField: ({ field, why }: { field: string; why: string }): InvalidFieldError => ({
    code: "INVALID_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  invalidDomain: ({ domain }: { domain: string }): InvalidDomainError => ({
    code: "INVALID_DOMAIN",
    domain,
    message:
      `"${domain}" is not a domain slug — lowercase letters, digits and single hyphens, 2-40 characters ` +
      `(the same shape as an atlas platform directory, so "datadog" and "google-admin" are already legal)`,
  }),
  domainRetired: ({ domain, canonical }: { domain: string; canonical: string }): DomainRetiredError => ({
    canonical,
    code: "DOMAIN_RETIRED",
    domain,
    message: `domain "${domain}" folded into "${canonical}" — record it under --domain ${canonical}`,
  }),
  domainNotConfigured: ({ domain, home }: { domain: string; home: string }): DomainNotConfiguredError => ({
    code: "DOMAIN_NOT_CONFIGURED",
    domain,
    home,
    message:
      `domain "${domain}" is not configured — \`slopweaver knowledge domains\` lists every domain and what it ` +
      `holds; one of this install's own is added to its store with ` +
      `\`slopweaver knowledge domains add --slug ${domain} --holds "<what it holds>" ${homeFlag({ home })}\``,
  }),
  supersedesRefused: ({ supersedes, why }: { supersedes: string; why: string }): SupersedesRefusedError => ({
    code: "SUPERSEDES_REFUSED",
    message: `cannot supersede ${supersedes} — ${why}`,
    supersedes,
  }),
  corruptRow: ({ lineNumber }: { lineNumber: number }): CorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `line ${String(lineNumber)} of the register is not a decodable lesson row`,
  }),
  corruptRecording: ({ recordingId, why }: { recordingId: string; why: string }): CorruptRecordingError => ({
    code: "CORRUPT_RECORDING",
    message: `recording ${recordingId} in the memories table is not a readable lesson — ${why}`,
    recordingId,
  }),
  placementRefused: ({
    placement,
    destination,
  }: {
    placement: string;
    destination: string;
  }): PlacementRefusedError => ({
    code: "PLACEMENT_REFUSED",
    message: `placement "${placement}" belongs in ${destination}, not the memories table`,
    placement,
  }),
  databaseFailed: ({ cause, doing }: { cause: unknown; doing: string }): DatabaseFailedError => ({
    cause,
    code: "DATABASE_FAILED",
    // The database's own message is carried into the display string rather than left only on `cause`:
    // a caller that prints `.message` is the common case, and "could not recall" with no reason is a
    // refusal an operator cannot act on, which is the defect `.claude/rules/error-handling.md` names.
    message: `could not ${doing} — ${databaseCauseText({ cause })}`,
  }),
  importConflict: ({ importKey }: { importKey: string }): ImportConflictError => ({
    code: "IMPORT_CONFLICT",
    importKey,
    message:
      `the table already holds a recording for import key ${importKey} that differs from the source line — ` +
      `reconcile the two before applying again, because a changed source file is not a safe retry`,
  }),
  storeUnreadable: ({ path, cause }: { path: string; cause: unknown }): StoreUnreadableError => ({
    cause,
    code: "STORE_UNREADABLE",
    message: `could not read the knowledge register at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
