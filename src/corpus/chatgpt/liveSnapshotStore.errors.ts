/**
 * Every way the live copy's snapshot store (`./liveSnapshotStore.ts`) fails: its own union, apart from the export's
 * and the conversation parser's in `./errors.ts`.
 */

/**
 * A held live snapshot does not stand as written: a manifest that will not read, a body missing or rewritten, or a
 * directory naming a different conversation. The whole live copy is refused, never the one snapshot passed over,
 * since that snapshot may be its conversation's latest version and an older export copy would stand in for it.
 */
export interface LiveSnapshotUnreadableError {
  readonly code: "LIVE_SNAPSHOT_UNREADABLE";
  readonly message: string;
  /** One line per conversation directory that does not stand. */
  readonly problems: readonly string[];
}

/** A live snapshot could not be written: the input was not one this writes, or the disk refused. */
export interface LiveSnapshotWriteFailedError {
  readonly code: "LIVE_SNAPSHOT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The owner's protect list covers the conversation's directory, so nothing of it was written. */
export interface LiveSnapshotProtectedError {
  readonly code: "LIVE_SNAPSHOT_PROTECTED";
  readonly message: string;
}

/** Every way the live copy's snapshot store fails. */
export type ChatgptSnapshotError =
  LiveSnapshotUnreadableError | LiveSnapshotWriteFailedError | LiveSnapshotProtectedError;

/** Factories for {@link ChatgptSnapshotError}. */
export const ChatgptSnapshotErrors = {
  protectedPath: ({ lines }: { lines: readonly string[] }): LiveSnapshotProtectedError => ({
    code: "LIVE_SNAPSHOT_PROTECTED",
    message: `chatgpt: ${lines.join("; ")} — nothing was written`,
  }),
  unreadable: ({ root, problems }: { root: string; problems: readonly string[] }): LiveSnapshotUnreadableError => ({
    code: "LIVE_SNAPSHOT_UNREADABLE",
    message:
      `chatgpt: the live copy at ${root} does not stand as written (${problems.join("; ")}) — remove each named ` +
      "conversation's directory and run the live sync again, which fetches it whole",
    problems,
  }),
  writeFailed: ({ path, detail }: { path: string; detail: string }): LiveSnapshotWriteFailedError => ({
    code: "LIVE_SNAPSHOT_WRITE_FAILED",
    message: `chatgpt: could not write the live snapshot ${path} (${detail})`,
    path,
  }),
} as const;
