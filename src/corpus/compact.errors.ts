/**
 * Typed failures for bronze compaction ({@link ./compact}). Five genuinely different things can go wrong
 * — a source the listing refused, a line the rewriter must not silently drop, a window file that could not be
 * read, a canonical file that could not be written, and a superseded file that could not be unlinked after the
 * canonical write landed — and each but the last leaves the corpus untouched, the last a superset on disk.
 */

/** A window file held a line the strict rewriter refuses to drop silently — the whole source is aborted. */
export interface CorruptLineError {
  readonly code: "CORRUPT_LINE";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** A bronze window file could not be read. */
export interface CompactReadFailedError {
  readonly code: "COMPACT_READ_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The canonical file could not be staged/renamed into place. */
export interface CompactWriteFailedError {
  readonly code: "COMPACT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** One or more superseded window files could not be unlinked after the canonical file landed. */
export interface CompactUnlinkFailedError {
  readonly code: "COMPACT_UNLINK_FAILED";
  readonly message: string;
  readonly paths: readonly string[];
}

/** The source's bronze could not be listed — the owner's protect list refused it, or an entry would not stat. */
export interface CompactListRefusedError {
  readonly code: "COMPACT_LIST_REFUSED";
  readonly message: string;
}

/** Every way {@link ./compact} can fail to plan or apply a source's compaction. */
export type CompactError =
  | CorruptLineError
  | CompactListRefusedError
  | CompactReadFailedError
  | CompactWriteFailedError
  | CompactUnlinkFailedError;

/** Factories for {@link CompactError} — the one place its message text is composed. */
export const CompactErrors = {
  /**
   * Build a {@link CorruptLineError}.
   *
   * @param path the window file holding the bad line
   * @param line the 1-based line number
   * @param reason why the line was rejected
   * @returns the typed error
   */
  corruptLine: ({ path, line, reason }: { path: string; line: number; reason: string }): CorruptLineError => ({
    code: "CORRUPT_LINE",
    line,
    message: `${path}:${String(line)}: ${reason} — refusing to compact this source`,
    path,
  }),

  /**
   * Build a {@link CompactListRefusedError}.
   *
   * @param message the listing's own refusal, naming the protect-list entry or the entry that would not stat
   * @returns the typed error
   */
  listRefused: ({ message }: { message: string }): CompactListRefusedError => ({
    code: "COMPACT_LIST_REFUSED",
    message: `${message} — nothing was compacted`,
  }),

  /**
   * Build a {@link CompactReadFailedError}.
   *
   * @param path the window file that could not be read
   * @param message the underlying io error message
   * @returns the typed error
   */
  readFailed: ({ path, message }: { path: string; message: string }): CompactReadFailedError => ({
    code: "COMPACT_READ_FAILED",
    message,
    path,
  }),

  /**
   * Build a {@link CompactUnlinkFailedError}.
   *
   * @param paths the superseded files that could not be removed
   * @param failures one human message per failed path
   * @returns the typed error
   */
  unlinkFailed: ({
    paths,
    failures,
  }: {
    paths: readonly string[];
    failures: readonly string[];
  }): CompactUnlinkFailedError => ({
    code: "COMPACT_UNLINK_FAILED",
    message: failures.join("; "),
    paths,
  }),

  /**
   * Build a {@link CompactWriteFailedError}.
   *
   * @param path the canonical file that could not be written
   * @param message the underlying io error message
   * @returns the typed error
   */
  writeFailed: ({ path, message }: { path: string; message: string }): CompactWriteFailedError => ({
    code: "COMPACT_WRITE_FAILED",
    message,
    path,
  }),
} as const;
