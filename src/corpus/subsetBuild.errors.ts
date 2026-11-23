/**
 * The typed failure kinds of a subset build.
 *
 * Its own union rather than `readonly string[]` because a caller genuinely branches on all four: the verb
 * maps `NO_SOURCE_CORPUS` to the expected-empty exit, `DESTINATION_OCCUPIED` and `DESTINATION_IS_SOURCE` to
 * a usage exit, and `COPY_FAILED` to a hard error. Collapsing them would make "you pointed at an empty
 * corpus" and "the disk filled up halfway through" the same exit code, which is the failure this repo's
 * error rules exist to prevent.
 */

/** The source home holds no bronze at all, so there is nothing to slice. */
export interface NoSourceCorpusError {
  readonly code: "NO_SOURCE_CORPUS";
  readonly message: string;
  readonly sourceHome: string;
}

/** The destination already holds a corpus, and a subset build never writes into one it did not create. */
export interface DestinationOccupiedError {
  readonly code: "DESTINATION_OCCUPIED";
  readonly message: string;
  readonly outHome: string;
}

/** The destination IS the source home — the one mistake that would overwrite the real corpus. */
export interface DestinationIsSourceError {
  readonly code: "DESTINATION_IS_SOURCE";
  readonly message: string;
  readonly home: string;
}

/** A read or write failed partway through, naming the file it died on. */
export interface CopyFailedError {
  readonly code: "COPY_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** Every way a subset build can fail. */
export type SubsetBuildError =
  NoSourceCorpusError | DestinationOccupiedError | DestinationIsSourceError | CopyFailedError;

/** The factory every producer of a {@link SubsetBuildError} calls — tests construct through it too. */
export const SubsetBuildErrors = {
  copyFailed: ({ path, cause }: { path: string; cause: unknown }): CopyFailedError => ({
    cause,
    code: "COPY_FAILED",
    message: `subset build failed on ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  destinationIsSource: ({ home }: { home: string }): DestinationIsSourceError => ({
    code: "DESTINATION_IS_SOURCE",
    home,
    message: `--out ${home} is the source home itself — a subset build would overwrite the corpus it is slicing`,
  }),
  destinationOccupied: ({ outHome }: { outHome: string }): DestinationOccupiedError => ({
    code: "DESTINATION_OCCUPIED",
    message: `--out ${outHome} already holds a corpus — delete it or pick an empty directory (a rebuild is cheap)`,
    outHome,
  }),
  noSourceCorpus: ({ sourceHome }: { sourceHome: string }): NoSourceCorpusError => ({
    code: "NO_SOURCE_CORPUS",
    message: `no bronze corpus under ${sourceHome} — run \`slopweaver refresh\` before slicing a subset out of it`,
    sourceHome,
  }),
} as const;
