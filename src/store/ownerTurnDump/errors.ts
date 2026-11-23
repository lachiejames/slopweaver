/**
 * Every way loading a `pg_dump` of the owner-turn tables can fail. One domain, scoped to `./`, per
 * `.claude/rules/error-handling.md`; a caller branches on `code` and displays `message`.
 */

/** The dump file could not be opened or read to its end. */
export interface DumpUnreadableError {
  readonly code: "DUMP_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A table's `COPY … FROM stdin;` section is not in the dump, or never reaches its `\.` terminator. */
export interface DumpSectionMissingError {
  readonly code: "DUMP_SECTION_MISSING";
  readonly message: string;
  readonly table: string;
}

/** A data row does not decode as COPY text, or a field is not the shape its column holds. */
export interface DumpRowMalformedError {
  readonly code: "DUMP_ROW_MALFORMED";
  readonly message: string;
  readonly table: string;
  readonly lineNumber: number;
}

/** A body's own bytes do not hash, or measure, to what its row says. */
export interface DumpBodyMismatchError {
  readonly code: "DUMP_BODY_MISMATCH";
  readonly message: string;
  readonly lineNumber: number;
  readonly bodySha256: string;
}

/** A location names a body the dump does not carry. */
export interface DumpOrphanLocationError {
  readonly code: "DUMP_ORPHAN_LOCATION";
  readonly message: string;
  readonly lineNumber: number;
  readonly bodySha256: string;
}

/** A row repeats a key an earlier row of its table already holds, so one of the two would be dropped on insert. */
export interface DumpDuplicateKeyError {
  readonly code: "DUMP_DUPLICATE_KEY";
  readonly message: string;
  readonly table: string;
  readonly lineNumber: number;
  readonly firstLineNumber: number;
}

/** Why one COPY data line does not decode to exactly what PostgreSQL stored for it. */
export interface CopyLineError {
  readonly code: "COPY_END_MARKER" | "COPY_FIELD_COUNT" | "COPY_BAD_ESCAPE" | "COPY_NUL_BYTE" | "COPY_NOT_UTF8";
  readonly message: string;
}

/** The factory every COPY line refusal is built through. */
export const CopyLineErrors = {
  badEscape: ({ field, reason }: { field: number; reason: string }): CopyLineError => ({
    code: "COPY_BAD_ESCAPE",
    message: `field ${String(field)}: ${reason}`,
  }),
  endMarker: (): CopyLineError => ({
    code: "COPY_END_MARKER",
    message: "it is the end-of-data marker, which holds no row",
  }),
  fieldCount: ({ found, declared }: { found: number; declared: number }): CopyLineError => ({
    code: "COPY_FIELD_COUNT",
    message: `it has ${String(found)} field(s) where the section declares ${String(declared)}`,
  }),
  loneSurrogate: (): CopyLineError => ({
    code: "COPY_NOT_UTF8",
    message: "it holds a lone surrogate, which has no UTF-8 bytes",
  }),
  notUtf8: ({ field }: { field: number }): CopyLineError => ({
    code: "COPY_NOT_UTF8",
    message: `field ${String(field)} is not UTF-8`,
  }),
  nulByte: ({ field }: { field: number }): CopyLineError => ({
    code: "COPY_NUL_BYTE",
    message: `field ${String(field)} decodes to a NUL byte, which PostgreSQL text cannot hold`,
  }),
} as const;

/** Every refusal the dump load produces. */
export type OwnerTurnDumpError =
  | DumpUnreadableError
  | DumpSectionMissingError
  | DumpRowMalformedError
  | DumpBodyMismatchError
  | DumpOrphanLocationError
  | DumpDuplicateKeyError;

/** The factory every refusal is built through, so a test builds the same shape the code does. */
export const OwnerTurnDumpErrors = {
  bodyMismatch: ({
    lineNumber,
    bodySha256,
    reason,
  }: {
    lineNumber: number;
    bodySha256: string;
    reason: string;
  }): DumpBodyMismatchError => ({
    bodySha256,
    code: "DUMP_BODY_MISMATCH",
    lineNumber,
    message: `owner_turn line ${String(lineNumber)} (${bodySha256}): ${reason}`,
  }),
  duplicateKey: ({
    table,
    lineNumber,
    firstLineNumber,
  }: {
    table: string;
    lineNumber: number;
    firstLineNumber: number;
  }): DumpDuplicateKeyError => ({
    code: "DUMP_DUPLICATE_KEY",
    firstLineNumber,
    lineNumber,
    message: `${table} line ${String(lineNumber)} repeats the key of line ${String(firstLineNumber)}, so one of them would be dropped`,
    table,
  }),
  orphanLocation: ({
    lineNumber,
    bodySha256,
  }: {
    lineNumber: number;
    bodySha256: string;
  }): DumpOrphanLocationError => ({
    bodySha256,
    code: "DUMP_ORPHAN_LOCATION",
    lineNumber,
    message: `owner_turn_location line ${String(lineNumber)} names body ${bodySha256}, which the dump does not carry`,
  }),
  rowMalformed: ({
    table,
    lineNumber,
    reason,
  }: {
    table: string;
    lineNumber: number;
    reason: string;
  }): DumpRowMalformedError => ({
    code: "DUMP_ROW_MALFORMED",
    lineNumber,
    message: `${table} line ${String(lineNumber)}: ${reason}`,
    table,
  }),
  sectionMissing: ({ table, reason }: { table: string; reason: string }): DumpSectionMissingError => ({
    code: "DUMP_SECTION_MISSING",
    message: `${table}: ${reason}`,
    table,
  }),
  unreadable: ({ path, cause }: { path: string; cause: string }): DumpUnreadableError => ({
    code: "DUMP_UNREADABLE",
    message: `${path} could not be read: ${cause}`,
    path,
  }),
} as const;
