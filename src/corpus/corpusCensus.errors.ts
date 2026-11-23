/**
 * Typed failures for {@link ./corpusCensus} — see `.claude/rules/error-handling.md` for the shape.
 *
 * A census fails the ways a corpus read fails (the root cannot be stat'ed), plus two of its own, both from
 * reading a row back by offset: the bytes there can no longer be read or parsed because the file changed
 * underneath the read, and a timestamp tie that needed such a row could not be decided.
 */
import type { CorpusStoreError } from "./corpusStore.errors.js";

/** A row read back by offset could not be read, or no longer parses into a record. */
export interface CensusRowUnreadableError {
  readonly code: "CENSUS_ROW_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly byteOffset: number;
}

/** A timestamp tie could not be decided, because a row it needed could not be read back. */
export interface CensusTieUnreadableError {
  readonly code: "CENSUS_TIE_UNREADABLE";
  readonly message: string;
  /** The file the census was reading when the tie failed. */
  readonly path: string;
  readonly cause: CensusRowUnreadableError;
}

/** Every way {@link ./corpusCensus.censusCorpus} can fail. */
export type CorpusCensusError = CorpusStoreError | CensusTieUnreadableError;

export const CorpusCensusErrors = {
  /**
   * Build a {@link CensusRowUnreadableError}.
   *
   * @param path the file the row sits in
   * @param byteOffset where the row starts in it
   * @param reason what the read or the parse reported
   * @returns the typed error
   */
  rowUnreadable: ({
    path,
    byteOffset,
    reason,
  }: {
    path: string;
    byteOffset: number;
    reason: string;
  }): CensusRowUnreadableError => ({
    byteOffset,
    code: "CENSUS_ROW_UNREADABLE",
    message:
      `${path}@${String(byteOffset)}: the row could not be read back (${reason}) — the file changed ` +
      "underneath this read, most likely a compaction; run the verb again",
    path,
  }),
  /**
   * Build a {@link CensusTieUnreadableError}.
   *
   * @param path the file being read when the tie failed
   * @param cause the row read that failed
   * @returns the typed error
   */
  tieUnreadable: ({ path, cause }: { path: string; cause: CensusRowUnreadableError }): CensusTieUnreadableError => ({
    cause,
    code: "CENSUS_TIE_UNREADABLE",
    message: `corpus census stopped at ${path}: ${cause.message}`,
    path,
  }),
} as const;
