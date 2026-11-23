/**
 * The cmux restore-policy domain's typed errors — why `fleet restore-policy` could not read, or would not edit,
 * `terminal.autoResumeAgentSessions` in cmux's own `cmux.json`.
 *
 * Its own union rather than a member of `./errors.ts`: that one is the cmux control socket's, and nothing here
 * opens a socket. The codes split what a caller can do about it: a SHAPE refusal is fixed by one line typed by
 * hand (every such message names it), an unverified edit means this code is wrong (its message says whether the file was written and put back), and
 * the file-system codes name the path they met.
 */

/** The line a refusal tells the owner to add by hand, inside the top-level `"terminal"` object. */
const HAND_LINE = '"autoResumeAgentSessions": false';

/** The config is not a shape this verb edits: a duplicate key, a non-boolean value, an unterminated comment. */
export interface ConfigShapeRefusedError {
  readonly code: "CONFIG_SHAPE_REFUSED";
  readonly message: string;
  /** What the scanner or walker met, without the hand-edit advice. */
  readonly reason: string;
}

/** The planned edit did not read back as `off`, or changed more than the one intended token run. */
export interface ConfigEditUnverifiedError {
  readonly code: "CONFIG_EDIT_UNVERIFIED";
  readonly message: string;
}

/** The config exists but could not be read. */
export interface ConfigUnreadableError {
  readonly code: "CONFIG_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** There is no config file to edit. */
export interface ConfigAbsentError {
  readonly code: "CONFIG_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The config path is a symlink, so an atomic replace would sever it from whatever it points at. */
export interface ConfigSymlinkError {
  readonly code: "CONFIG_SYMLINK";
  readonly message: string;
  readonly path: string;
}

/** The config has more than one name, so an atomic replace would leave the others holding the old text. */
export interface ConfigHardLinkedError {
  readonly code: "CONFIG_HARD_LINKED";
  readonly message: string;
  readonly path: string;
}

/** The backup, the write or the restore failed on disk. */
export interface ConfigWriteFailedError {
  readonly code: "CONFIG_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Every way reading or setting cmux's restore policy can fail. */
export type RestorePolicyError =
  | ConfigShapeRefusedError
  | ConfigEditUnverifiedError
  | ConfigUnreadableError
  | ConfigAbsentError
  | ConfigSymlinkError
  | ConfigHardLinkedError
  | ConfigWriteFailedError;

/** The factory every producer of a {@link RestorePolicyError} constructs through — tests included. */
export const RestorePolicyErrors = {
  absent: ({ path }: { path: string }): ConfigAbsentError => ({
    code: "CONFIG_ABSENT",
    message:
      `no cmux config at ${path}: create it holding {"terminal": {${HAND_LINE}}}, ` +
      "or launch cmux once so it writes its own template, then run this again",
    path,
  }),
  editUnverified: ({ detail }: { detail: string }): ConfigEditUnverifiedError => ({
    code: "CONFIG_EDIT_UNVERIFIED",
    message: `the planned edit did not verify (${detail}): add ${HAND_LINE} inside "terminal" by hand`,
  }),
  hardLinked: ({ path, links }: { path: string; links: number }): ConfigHardLinkedError => ({
    code: "CONFIG_HARD_LINKED",
    message: `${path} has ${String(links)} hard links, and an atomic replace would cut the others loose: add ${HAND_LINE} inside "terminal" by hand`,
    path,
  }),
  shapeRefused: ({ reason }: { reason: string }): ConfigShapeRefusedError => ({
    code: "CONFIG_SHAPE_REFUSED",
    message: `${reason} — not edited; add ${HAND_LINE} inside the top-level "terminal" object by hand`,
    reason,
  }),
  symlink: ({ path }: { path: string }): ConfigSymlinkError => ({
    code: "CONFIG_SYMLINK",
    message: `${path} is a symlink, and an atomic replace would cut it loose: edit its target by hand, adding ${HAND_LINE} inside "terminal"`,
    path,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): ConfigUnreadableError => ({
    code: "CONFIG_UNREADABLE",
    message: `could not read ${path}: ${detail}`,
    path,
  }),
  writeFailed: ({ path, detail }: { path: string; detail: string }): ConfigWriteFailedError => ({
    code: "CONFIG_WRITE_FAILED",
    message: `could not write ${path}: ${detail}`,
    path,
  }),
} as const;
