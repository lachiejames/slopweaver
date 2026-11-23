/**
 * The typed failures of the Vanta change log — writing one sync's record, listing the unread ones, and moving
 * the read cursor (`changesStore.ts`). A union of its own per `.claude/rules/error-handling.md`: a caller
 * branches on `code` (a refused `--mark-read` is the operator's typo, an unreadable file is the store's fault)
 * and displays `message`.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** Every way the change log can refuse or fail. */
export type VantaChangesError =
  | { readonly code: "CHANGE_FILE_UNWRITABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CHANGE_FILE_UNREMOVABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CHANGE_FILE_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CHANGES_DIRECTORY_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CURSOR_UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "CURSOR_UNWRITABLE"; readonly message: string; readonly path: string }
  | { readonly code: "UNKNOWN_CHANGE"; readonly message: string; readonly at: string }
  | { readonly code: "CURSOR_BACKWARDS"; readonly message: string; readonly at: string; readonly through: string };

/** How to raise one — the factory the real code calls. */
export const VantaChangesErrors = {
  changeFileUnreadable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CHANGE_FILE_UNREADABLE",
    message: `the Vanta change file ${path} will not read as a change record: ${errorMessage({ error: cause })} — move it aside and the next sync writes a fresh one`,
    path,
  }),
  changeFileUnwritable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CHANGE_FILE_UNWRITABLE",
    message: `could not record what this sync changed at ${path}: ${errorMessage({ error: cause })} — once the atlas publishes, this sync's changes are lost because the next sync compares against what this one published`,
    path,
  }),
  changeFileUnremovable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CHANGE_FILE_UNREMOVABLE",
    message: `the atlas did not publish, but its change record ${path} could not be removed: ${errorMessage({ error: cause })} — delete it, or the next sync's record repeats its changes`,
    path,
  }),
  changesDirectoryUnreadable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CHANGES_DIRECTORY_UNREADABLE",
    message: `could not list the Vanta change files in ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  cursorBackwards: ({ at, through }: { at: string; through: string }): VantaChangesError => ({
    at,
    code: "CURSOR_BACKWARDS",
    message: `--mark-read ${at} would move the read cursor back from ${through} — a change already judged is never re-offered by moving it`,
    through,
  }),
  cursorUnreadable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CURSOR_UNREADABLE",
    message: `the Vanta change read cursor ${path} will not read: ${errorMessage({ error: cause })} — fix or delete it; deleted, every change file reads as unread`,
    path,
  }),
  cursorUnwritable: ({ path, cause }: { path: string; cause: unknown }): VantaChangesError => ({
    code: "CURSOR_UNWRITABLE",
    message: `could not move the Vanta change read cursor at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  unknownChange: ({ at }: { at: string }): VantaChangesError => ({
    at,
    code: "UNKNOWN_CHANGE",
    message: `no Vanta change file is recorded at ${at} — pass the \`at\` a change listing printed`,
  }),
} as const;
