/**
 * Why one night could not be SENT to a destination — the send path's own failure kinds (`./sendStaging.ts`,
 * `./run.ts`), kept apart from the staging and restore union in `./errors.ts` because a send failure is per
 * destination: it fails that destination's outcome and the next destination is still sent.
 */

/** A destination's transport threw rather than returning its failure. */
export interface BackupSendThrewError {
  readonly code: "SEND_THREW";
  readonly message: string;
  readonly root: string;
}

/** Reading where a destination lands, or its pinned drive, threw before anything was sent to it. */
export interface BackupInspectThrewError {
  readonly code: "INSPECT_THREW";
  readonly message: string;
  readonly root: string;
}

/** The night's frozen file copies were released or removed before this destination got them. */
export interface BackupFrozenCopiesGoneError {
  readonly code: "FROZEN_COPIES_GONE";
  readonly message: string;
  readonly files: readonly string[];
}

/** A night was handed a destination to write but no backup key to encrypt under. */
export interface BackupSendKeylessError {
  readonly code: "SEND_KEYLESS";
  readonly message: string;
}

/**
 * Every way a night's send can fail. The send path reports lines today, so no caller branches on it yet.
 *
 * @internal
 */
export type BackupSendError =
  BackupSendThrewError | BackupInspectThrewError | BackupFrozenCopiesGoneError | BackupSendKeylessError;

/** The send path's error factories. */
export const BackupSendErrors = {
  frozenCopiesGone: ({ files }: { files: readonly string[] }): BackupFrozenCopiesGoneError => ({
    code: "FROZEN_COPIES_GONE",
    files,
    message: `the night's frozen copies of ${files.join(", ")} are gone, so nothing more was sent`,
  }),
  inspectThrew: ({ root, why }: { root: string; why: string }): BackupInspectThrewError => ({
    code: "INSPECT_THREW",
    message: `reading where ${root} lands threw: ${why} — nothing was sent to it`,
    root,
  }),
  keyless: (): BackupSendKeylessError => ({
    code: "SEND_KEYLESS",
    message: "a destination is only ever written under the backup key, and none was given",
  }),
  threw: ({ root, why }: { root: string; why: string }): BackupSendThrewError => ({
    code: "SEND_THREW",
    message: `writing to ${root} threw: ${why}`,
    root,
  }),
} as const;
