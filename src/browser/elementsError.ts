/**
 * Why a look's elements could not be printed — the one typed failure of `browser read --under|--find`, and of
 * the outline every `open`, `read`, `scroll`, `aim` and `inspect` prints (`./snapshotOutline.ts`).
 *
 * One union for one domain: reading a filed snapshot and choosing which part of it to print. The two usage
 * problems sit here beside the read ones because the same receipt prints all of them and a caller branches on
 * `code` alone — a usage code is exit 2, every other one exit 1.
 */

/** `--under` and `--find` were both given. */
export interface SelectionConflictError {
  readonly code: "SELECTION_CONFLICT";
  readonly message: string;
}

/** `--under` was given something that is not a ref. */
export interface NotARefError {
  readonly code: "NOT_A_REF";
  readonly message: string;
  readonly given: string;
}

/** `--find` was given only whitespace. */
export interface EmptyFindError {
  readonly code: "EMPTY_FIND";
  readonly message: string;
}

/** No element of the look carries the ref. */
export interface RefAbsentError {
  readonly code: "REF_ABSENT";
  readonly message: string;
  readonly ref: string;
}

/** More than one element of the look carries the ref, so none can be chosen. */
export interface RefAmbiguousError {
  readonly code: "REF_AMBIGUOUS";
  readonly message: string;
  readonly ref: string;
  readonly count: number;
}

/** The look's filed snapshot could not be read. */
export interface SnapshotUnreadableError {
  readonly code: "SNAPSHOT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way printing a look's elements fails. */
export type ElementsError =
  SelectionConflictError | NotARefError | EmptyFindError | RefAbsentError | RefAmbiguousError | SnapshotUnreadableError;

/** The factories every {@link ElementsError} is built through. */
export const ElementsErrors = {
  emptyFind: (): EmptyFindError => ({
    code: "EMPTY_FIND",
    message: "--find needs the text to look for, e.g. --find Merge",
  }),
  notARef: ({ given }: { given: string }): NotARefError => ({
    code: "NOT_A_REF",
    given,
    message: `--under takes a ref out of the outline, such as f1e4 — got '${given}'`,
  }),
  refAbsent: ({ ref }: { ref: string }): RefAbsentError => ({
    code: "REF_ABSENT",
    message: `ref ${ref} is no element of this session's latest read — take a fresh \`browser read\` and open a ref its outline names`,
    ref,
  }),
  refAmbiguous: ({ ref, count }: { ref: string; count: number }): RefAmbiguousError => ({
    code: "REF_AMBIGUOUS",
    count,
    message: `ref ${ref} names ${String(count)} elements of this read, so --under cannot tell which to open — take a fresh \`browser read\``,
    ref,
  }),
  selectionConflict: (): SelectionConflictError => ({
    code: "SELECTION_CONFLICT",
    message: "`browser read` takes --under <ref> or --find <text>, not both: open one ref, or search the read",
  }),
  snapshotUnreadable: ({ path, detail }: { path: string; detail: string }): SnapshotUnreadableError => ({
    code: "SNAPSHOT_UNREADABLE",
    message: `the look's snapshot at ${path} could not be read: ${detail}`,
    path,
  }),
} as const;
