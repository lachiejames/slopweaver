/**
 * Typed failures for the current-owner-ruling overlay — {@link ./ownerDirective} (converting a memory leaf
 * into a directive, merging the overlay), {@link ./ownerDirectiveStore} (the store orchestration), its rows
 * and its one-time import of the legacy file. Modeled on an earlier codebase's `<domain>/errors.ts` pattern
 * (discriminated union + a factory object keyed by variant), re-skinned rather than ported verbatim; see
 * `AGENTS.md`'s "Porting from private sources".
 *
 * One union for every file: they are one bounded domain (the private control-plane overlay), and every
 * caller here only ever displays `.message` — there is no per-kind branch to justify splitting it.
 */

/** A memory opts into owner directives but its own frontmatter failed the memory schema. */
export interface OwnerDirectiveInvalidFrontmatterError {
  readonly code: "OWNER_DIRECTIVE_INVALID_FRONTMATTER";
  readonly message: string;
  readonly file: string;
}

/** A memory opts in but is not a `feedback`-typed memory — context memories are not control-plane. */
export interface OwnerDirectiveNotFeedbackError {
  readonly code: "OWNER_DIRECTIVE_NOT_FEEDBACK";
  readonly message: string;
  readonly file: string;
}

/** A memory opts in but has no usable declared name and description to become a bounded ruling. */
export interface OwnerDirectiveMissingNameOrDescriptionError {
  readonly code: "OWNER_DIRECTIVE_MISSING_NAME_OR_DESCRIPTION";
  readonly message: string;
  readonly file: string;
}

/** A directive or the whole overlay failed its strict Zod schema — every issue named at once. */
export interface OwnerDirectiveSchemaInvalidError {
  readonly code: "OWNER_DIRECTIVE_SCHEMA_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** A replacement or revocation named an id owned by a different memory file. */
export interface OwnerDirectiveConflictError {
  readonly code: "OWNER_DIRECTIVE_CONFLICT";
  readonly message: string;
  readonly id: string;
  readonly action: "replace" | "revoke";
  readonly attemptedBy: string;
  readonly ownedBy: string;
}

/** A store step did not finish — the store could not be opened, read or written. Never read as absence. */
export interface OwnerDirectiveStoreUnavailableError {
  readonly code: "OWNER_DIRECTIVE_STORE_UNAVAILABLE";
  readonly message: string;
  readonly doing: string;
  readonly reason: string;
}

/**
 * No store is selected for this home, and something needed one: a legacy file still waits to be imported, or a
 * memory recorded a change. With no store and no legacy file there is nothing recorded anywhere to read.
 */
export interface OwnerDirectiveStoreUnselectedError {
  readonly code: "OWNER_DIRECTIVE_STORE_UNSELECTED";
  readonly message: string;
  readonly needed: string;
  /** The store's own sentence on how to select one, carried so a caller can restate what needed it. */
  readonly selection: string;
}

/** One stored version does not decode into the domain shape — named by its row and its logical id. */
export interface OwnerDirectiveRowUnreadableError {
  readonly code: "OWNER_DIRECTIVE_ROW_UNREADABLE";
  readonly message: string;
  readonly table: "owner_correction" | "owner_directive";
  readonly rowId: string;
  readonly id: string;
  readonly issues: readonly string[];
}

/** The legacy overlay file could not be read or does not decode, so nothing was imported from it. */
export interface OwnerDirectiveHomeFileUnreadableError {
  readonly code: "OWNER_DIRECTIVE_HOME_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/** The legacy overlay file is well-formed JSON at a version this build does not read, so nothing was imported. */
export interface OwnerDirectiveHomeFileOutdatedError {
  readonly code: "OWNER_DIRECTIVE_HOME_FILE_OUTDATED";
  readonly message: string;
  readonly path: string;
  readonly version: number;
}

/** The import marker claims more records than the two tables hold, so rows were lost — never read as fewer. */
export interface OwnerDirectiveImportMarkerInconsistentError {
  readonly code: "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT";
  readonly message: string;
  readonly expected: number;
  readonly observed: number;
}

/** A concurrent writer activated the same logical id first; the partial unique index refused the second. */
export interface OwnerDirectiveWriteConflictError {
  readonly code: "OWNER_DIRECTIVE_WRITE_CONFLICT";
  readonly message: string;
  readonly reason: string;
}

/**
 * An applied import takes an instruction over a live version, and no active version of it is stored any more: the
 * import was planned against one, so the plan no longer describes the table.
 */
export interface OwnerDirectiveImportTargetGoneError {
  readonly code: "OWNER_DIRECTIVE_IMPORT_TARGET_GONE";
  readonly message: string;
  readonly kind: "directive" | "correction";
  readonly id: string;
}

/**
 * An imported version asks to retire the live one while being written inactive: only a `take-imported` answer retires
 * a live version, and that answer writes the import active, so the pair names no answer at all.
 */
export interface OwnerDirectiveImportAnswerContradictoryError {
  readonly code: "OWNER_DIRECTIVE_IMPORT_ANSWER_CONTRADICTORY";
  readonly message: string;
  readonly kind: "directive" | "correction";
  readonly id: string;
}

/** One or more memory leaves each produced their own refusal, gathered into one report. */
export interface OwnerDirectiveMemoryInvalidError {
  readonly code: "OWNER_DIRECTIVE_MEMORY_INVALID";
  readonly message: string;
  readonly causes: readonly OwnerDirectiveError[];
}

/** Every way the owner-directive overlay can fail to be read, parsed, merged or written. */
export type OwnerDirectiveError =
  | OwnerDirectiveInvalidFrontmatterError
  | OwnerDirectiveNotFeedbackError
  | OwnerDirectiveMissingNameOrDescriptionError
  | OwnerDirectiveSchemaInvalidError
  | OwnerDirectiveConflictError
  | OwnerDirectiveStoreUnavailableError
  | OwnerDirectiveStoreUnselectedError
  | OwnerDirectiveRowUnreadableError
  | OwnerDirectiveHomeFileUnreadableError
  | OwnerDirectiveHomeFileOutdatedError
  | OwnerDirectiveImportMarkerInconsistentError
  | OwnerDirectiveWriteConflictError
  | OwnerDirectiveImportTargetGoneError
  | OwnerDirectiveImportAnswerContradictoryError
  | OwnerDirectiveMemoryInvalidError;

/** Factories for {@link OwnerDirectiveError} — the one place its message text is composed. */
export const OwnerDirectiveErrors = {
  /**
   * Build an {@link OwnerDirectiveConflictError}.
   *
   * @param id the directive id in conflict
   * @param action whether the attempt was a replacement or a revocation
   * @param attemptedBy the memory file that attempted the change
   * @param ownedBy the memory file that actually owns the id
   * @returns the typed error
   */
  conflict: ({
    id,
    action,
    attemptedBy,
    ownedBy,
  }: {
    id: string;
    action: "replace" | "revoke";
    attemptedBy: string;
    ownedBy: string;
  }): OwnerDirectiveConflictError => ({
    action,
    attemptedBy,
    code: "OWNER_DIRECTIVE_CONFLICT",
    id,
    message: `${attemptedBy} cannot ${action} owner directive ${id}; it is owned by ${ownedBy}`,
    ownedBy,
  }),
  /** @returns an {@link OwnerDirectiveInvalidFrontmatterError} naming the offending memory file */
  invalidFrontmatter: ({ file }: { file: string }): OwnerDirectiveInvalidFrontmatterError => ({
    code: "OWNER_DIRECTIVE_INVALID_FRONTMATTER",
    file,
    message: `${file} opts into owner directives but its memory frontmatter is invalid`,
  }),

  /**
   * Build an {@link OwnerDirectiveMemoryInvalidError} aggregating every leaf-level refusal.
   *
   * @param causes every per-leaf error observed while scanning
   * @returns the typed error
   */
  memoryInvalid: ({ causes }: { causes: readonly OwnerDirectiveError[] }): OwnerDirectiveMemoryInvalidError => ({
    causes,
    code: "OWNER_DIRECTIVE_MEMORY_INVALID",
    message: causes.map((cause) => cause.message).join("; "),
  }),

  /** @returns an {@link OwnerDirectiveMissingNameOrDescriptionError} naming the offending memory file */
  missingNameOrDescription: ({ file }: { file: string }): OwnerDirectiveMissingNameOrDescriptionError => ({
    code: "OWNER_DIRECTIVE_MISSING_NAME_OR_DESCRIPTION",
    file,
    message: `${file} opts into owner directives but has no usable name and description`,
  }),

  /** @returns an {@link OwnerDirectiveNotFeedbackError} naming the offending memory file */
  notFeedback: ({ file }: { file: string }): OwnerDirectiveNotFeedbackError => ({
    code: "OWNER_DIRECTIVE_NOT_FEEDBACK",
    file,
    message: `${file} opts into owner directives but metadata.type is not feedback`,
  }),

  /**
   * Build an {@link OwnerDirectiveImportMarkerInconsistentError}.
   *
   * @param expected how many records the marker says the import wrote
   * @param observed how many legacy-file rows, either state, the two tables still hold
   * @returns the typed error
   */
  importMarkerInconsistent: ({
    expected,
    observed,
  }: {
    expected: number;
    observed: number;
  }): OwnerDirectiveImportMarkerInconsistentError => ({
    code: "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT",
    expected,
    message: `the owner-judgement import marker records ${String(expected)} imported instruction(s), and the owner_directive and owner_correction tables hold ${String(observed)} legacy-file version(s) — ${observed < expected ? "imported rows were lost" : "the old file was imported twice"}, so neither is read as the rulings`,
    observed,
  }),

  /**
   * Build an {@link OwnerDirectiveHomeFileOutdatedError}.
   *
   * @param path the legacy file
   * @param version the schema version it carries
   * @param reads the one version this build imports
   * @returns the typed error
   */
  homeFileOutdated: ({
    path,
    version,
    reads,
  }: {
    path: string;
    version: number;
    reads: number;
  }): OwnerDirectiveHomeFileOutdatedError => ({
    code: "OWNER_DIRECTIVE_HOME_FILE_OUTDATED",
    message: `${path} is schemaVersion ${String(version)} and this build imports only ${String(reads)}, so nothing was imported; move the file aside and the next memory write records each directive from the memory that owns it`,
    path,
    version,
  }),

  /**
   * Build an {@link OwnerDirectiveHomeFileUnreadableError}.
   *
   * @param path the legacy file
   * @param reason why it could not be read or decoded
   * @returns the typed error
   */
  homeFileUnreadable: ({ path, reason }: { path: string; reason: string }): OwnerDirectiveHomeFileUnreadableError => ({
    code: "OWNER_DIRECTIVE_HOME_FILE_UNREADABLE",
    message: `${path} could not be imported into the store and was left untouched: ${reason}`,
    path,
    reason,
  }),

  /**
   * Build an {@link OwnerDirectiveRowUnreadableError}.
   *
   * @param table which table the row is in
   * @param rowId the version's own row id
   * @param id the logical directive or correction id it carries
   * @param issues every decode problem
   * @returns the typed error
   */
  rowUnreadable: ({
    table,
    rowId,
    id,
    issues,
  }: {
    table: "owner_correction" | "owner_directive";
    rowId: string;
    id: string;
    issues: readonly string[];
  }): OwnerDirectiveRowUnreadableError => ({
    code: "OWNER_DIRECTIVE_ROW_UNREADABLE",
    id,
    issues,
    message: `${table} row ${rowId} (id ${id}) does not decode: ${issues.join("; ")}`,
    rowId,
    table,
  }),

  /**
   * Build an {@link OwnerDirectiveStoreUnavailableError}.
   *
   * @param doing finishes "the store could not …"
   * @param reason what the driver or the connection said
   * @returns the typed error
   */
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): OwnerDirectiveStoreUnavailableError => ({
    code: "OWNER_DIRECTIVE_STORE_UNAVAILABLE",
    doing,
    message: `the store could not ${doing} for owner directives: ${reason}`,
    reason,
  }),

  /**
   * Build an {@link OwnerDirectiveStoreUnselectedError}.
   *
   * @param needed what needed a store, finishing "owner directives …"
   * @param selection the store's own sentence on how to select one
   * @returns the typed error
   */
  storeUnselected: ({
    needed,
    selection,
  }: {
    needed: string;
    selection: string;
  }): OwnerDirectiveStoreUnselectedError => ({
    code: "OWNER_DIRECTIVE_STORE_UNSELECTED",
    message: `owner directives ${needed}, and no store is selected for this home — ${selection}`,
    needed,
    selection,
  }),

  /**
   * Build an {@link OwnerDirectiveSchemaInvalidError} from every Zod issue at once.
   *
   * @param issues every schema violation message
   * @returns the typed error
   */
  schemaInvalid: ({ issues }: { issues: readonly string[] }): OwnerDirectiveSchemaInvalidError => ({
    code: "OWNER_DIRECTIVE_SCHEMA_INVALID",
    issues,
    message: issues.join("; "),
  }),

  /**
   * Build an {@link OwnerDirectiveWriteConflictError}.
   *
   * @param reason what the store said when the second activation met the active-version index
   * @returns the typed error
   */
  writeConflict: ({ reason }: { reason: string }): OwnerDirectiveWriteConflictError => ({
    code: "OWNER_DIRECTIVE_WRITE_CONFLICT",
    message: `another writer changed the same owner directive first, so nothing was written; run the memory write again: ${reason}`,
    reason,
  }),
  /**
   * Build an {@link OwnerDirectiveImportTargetGoneError}.
   *
   * @param kind which instruction table the import takes the version over in
   * @param id the instruction's logical id
   * @returns the typed error
   */
  importTargetGone: ({
    kind,
    id,
  }: {
    kind: "directive" | "correction";
    id: string;
  }): OwnerDirectiveImportTargetGoneError => ({
    code: "OWNER_DIRECTIVE_IMPORT_TARGET_GONE",
    id,
    kind,
    message: `the import takes ${kind} ${id} over a live version, and no active version of it is stored; plan the import again`,
  }),
  /**
   * Build an {@link OwnerDirectiveImportAnswerContradictoryError}.
   *
   * @param kind which instruction table the version would be written to
   * @param id the instruction's logical id
   * @returns the typed error
   */
  importAnswerContradictory: ({
    kind,
    id,
  }: {
    kind: "directive" | "correction";
    id: string;
  }): OwnerDirectiveImportAnswerContradictoryError => ({
    code: "OWNER_DIRECTIVE_IMPORT_ANSWER_CONTRADICTORY",
    id,
    kind,
    message: `the import would retire the live ${kind} ${id} while writing its own version inactive, which no answer asks for; nothing was written`,
  }),
} as const;
