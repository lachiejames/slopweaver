/**
 * The backup leg's own typed error union — every way a file this process meant to store ended up not being
 * the file the destination holds. Distinct from `./localDestinationErrors.ts`, which is the TRANSPORT's domain:
 * one of those says the write failed, and one of these says the write SUCCEEDED and landed something that is not
 * what the manifest describes. They share no base type, per
 * `.claude/rules/error-handling.md`. {@link BlobUnfrozenError} is the one variant that is not a landing: the file
 * could not be frozen for sending at all (`./filesLeg.ts`), which is a local failure the transport never saw.
 *
 * Every variant is displayed rather than branched on today, and the union exists because
 * `error-shape-threshold` is the owner's ruling that a directory past its floor declares one instead of
 * growing a plain string list — the list is exactly how the same three near-identical "did not carry the
 * whole file" sentences came to be written in three places.
 *
 * {@link BackupUploadErrors.blobLeftBehind} is the one that carries the most: it is the single path in the
 * whole mechanism that can leave an object in the destination which does not hash to its own name, so its message
 * names the object, why the removal failed, and what a person has to do before the next backup runs. A
 * message that said only "deleting … failed" would leave a reader with no reason to know that.
 */

/** A blob landed shorter or longer than the length the walk measured. */
export interface BlobShortError {
  readonly code: "BLOB_SHORT";
  readonly message: string;
  readonly relativePath: string;
  readonly held: number;
  readonly expected: number;
}

/** A blob's bytes do not hash to the digest its object name is built from. */
export interface BlobRewrittenError {
  readonly code: "BLOB_REWRITTEN";
  readonly message: string;
  readonly relativePath: string;
  readonly sent: string;
  readonly named: string;
}

/** A blob that did not match its name could not be taken back out, so the destination still holds it. */
export interface BlobLeftBehindError {
  readonly code: "BLOB_LEFT_BEHIND";
  readonly message: string;
  readonly objectName: string;
}

/** A file the destination lacks could not be cloned into the snapshot it is hashed and sent from. */
export interface BlobUnfrozenError {
  readonly code: "BLOB_UNFROZEN";
  readonly message: string;
  readonly relativePath: string;
}

/** One of the four staged files landed at a different length from the file on disk. */
export interface StagedFileShortError {
  readonly code: "STAGED_FILE_SHORT";
  readonly message: string;
  readonly objectName: string;
  readonly held: number;
  readonly expected: number;
}

/** One of the staged files landed at the right length but hashes to something the staging manifest never recorded. */
export interface StagedFileAlteredError {
  readonly code: "STAGED_FILE_ALTERED";
  readonly message: string;
  readonly objectName: string;
  readonly sent: string;
  readonly recorded: string;
}

/** A staged file's upload reported an object other than the one it was asked to write. */
export interface StagedFileMisplacedError {
  readonly code: "STAGED_FILE_MISPLACED";
  readonly message: string;
  readonly objectName: string;
  readonly landed: string;
}

/** Every way an upload lands something that is not what the manifest describes. */
export type BackupUploadError =
  | BlobLeftBehindError
  | BlobRewrittenError
  | BlobShortError
  | StagedFileAlteredError
  | StagedFileMisplacedError
  | StagedFileShortError;

/** The factories the backup leg constructs its upload failures with. Tests build fixtures through these. */
export const BackupUploadErrors = {
  blobLeftBehind: ({
    objectName,
    mismatch,
    why,
  }: {
    objectName: string;
    mismatch: BackupUploadError;
    why: string;
  }): BlobLeftBehindError => ({
    code: "BLOB_LEFT_BEHIND",
    message:
      `${mismatch.message} The blob could NOT be removed (${why}), so ${objectName} is still in the destination. ` +
      `Delete it by hand before the next backup: its size now matches its name, and nothing else will catch it.`,
    objectName,
  }),
  blobRewritten: ({
    relativePath,
    sent,
    named,
  }: {
    relativePath: string;
    sent: string;
    named: string;
  }): BlobRewrittenError => ({
    code: "BLOB_REWRITTEN",
    message:
      `${relativePath}: what was sent hashes to ${sent} and the object is named for ${named} — the bytes ` +
      `that landed are not the frozen copy they were named for.`,
    named,
    relativePath,
    sent,
  }),
  blobUnfrozen: ({ relativePath, cause }: { relativePath: string; cause: unknown }): BlobUnfrozenError => ({
    code: "BLOB_UNFROZEN",
    message:
      `${relativePath}: could not be frozen into the snapshot it is sent from — ` +
      `${cause instanceof Error ? cause.message : String(cause)}`,
    relativePath,
  }),
  blobShort: ({
    relativePath,
    held,
    expected,
  }: {
    relativePath: string;
    held: number;
    expected: number;
  }): BlobShortError => ({
    code: "BLOB_SHORT",
    expected,
    held,
    message:
      `${relativePath}: the destination holds ${String(held)} byte(s) of ${String(expected)} — the upload did ` +
      `not carry the whole file.`,
    relativePath,
  }),
  stagedFileAltered: ({
    objectName,
    sent,
    recorded,
  }: {
    objectName: string;
    sent: string;
    recorded: string;
  }): StagedFileAlteredError => ({
    code: "STAGED_FILE_ALTERED",
    message:
      `${objectName}: what was sent hashes to ${sent} and the staging manifest recorded ${recorded} — ` +
      `the staged file changed after it was measured, so no receipt is written for it.`,
    objectName,
    recorded,
    sent,
  }),
  stagedFileMisplaced: ({ objectName, landed }: { objectName: string; landed: string }): StagedFileMisplacedError => ({
    code: "STAGED_FILE_MISPLACED",
    landed,
    message: `${objectName} was asked for and the upload reported ${landed} — no receipt is written for it.`,
    objectName,
  }),
  stagedFileShort: ({
    objectName,
    held,
    expected,
  }: {
    objectName: string;
    held: number;
    expected: number;
  }): StagedFileShortError => ({
    code: "STAGED_FILE_SHORT",
    expected,
    held,
    message:
      `${objectName} holds ${String(held)} byte(s); the staged file is ${String(expected)} — the ` +
      `upload did not carry the whole file.`,
    objectName,
  }),
} as const;
