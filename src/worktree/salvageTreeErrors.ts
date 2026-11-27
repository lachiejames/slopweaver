/**
 * Why `./pruneSalvage`'s apply-time read left a tree unmeasured. Each variant's `message` is the whole decline a
 * salvage prints, because the tree is kept and nothing was captured either way.
 */

/** A git read of the tree threw, so nothing about it is known. */
export interface TreeUnreadableError {
  readonly code: "TREE_UNREADABLE";
  readonly message: string;
}

/** HEAD is no longer the sha the history check accepted. */
export interface HeadMovedError {
  readonly code: "HEAD_MOVED";
  readonly message: string;
}

/** Files whose "stop looking at this file" bit would not clear, so their edits stay unreported. */
export interface StillHiddenError {
  readonly code: "STILL_HIDDEN";
  readonly message: string;
  readonly paths: readonly string[];
}

/** Every reason the apply-time read leaves a tree unmeasured. */
export type SalvageTreeError = HeadMovedError | StillHiddenError | TreeUnreadableError;

/** The one place each {@link SalvageTreeError} is built. */
export const SalvageTreeErrors = {
  headMoved: (): HeadMovedError => ({
    code: "HEAD_MOVED",
    message: "its HEAD moved after its history was checked against the trunk — nothing was pushed",
  }),
  stillHidden: ({ paths }: { paths: readonly string[] }): StillHiddenError => ({
    code: "STILL_HIDDEN",
    message: `git would not stop ignoring ${String(paths.length)} file(s) — ${paths.join(", ")} — so an edit to one of them would not be reported, captured, or recoverable`,
    paths,
  }),
  treeUnreadable: (): TreeUnreadableError => ({
    code: "TREE_UNREADABLE",
    message: "its working tree could not be read at apply time, so nothing was captured",
  }),
} as const;
