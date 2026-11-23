/**
 * Why the cold-seat graft (`./coldGraft.ts`, `./coldGraftAgreement.ts`) refused to rebuild a tab's tree: one
 * discriminated union and its factory. Every variant is a way cmux's reply and the process table read beside it
 * disagree, and each is refused rather than resolved — the reasons are the graft's doc. The caller displays `message`
 * inside its own `CMUX_READ_FAILED`; nothing branches on `code` yet, which is why it is here: a refusal a reader can
 * tell apart from the next one without parsing prose. The tty-side variants, read off the table's `tty=` and `stat=`
 * columns and each row's argv, are `./coldGraftTtyErrors.ts`, and the executable-side ones, read off `lsof` after the
 * graft, `./coldExecutableErrors.ts`; both are folded into the union and the factory here.
 */
import { type ColdGraftExecutableError, ColdGraftExecutableErrors } from "./coldExecutableErrors.js";
import { type ColdGraftTtyError, ColdGraftTtyErrors } from "./coldGraftTtyErrors.js";

/** cmux reported no process for the tab at all, so there is nothing to graft. */
export interface ColdGraftNothingToGraftError {
  readonly code: "NOTHING_TO_GRAFT";
  readonly message: string;
}
/** A process cmux attributed to the tab is not in the table. */
export interface ColdGraftAttributedMissingError {
  readonly code: "ATTRIBUTED_MISSING";
  readonly message: string;
  readonly pids: readonly number[];
}
/** A tty pid cmux listed is not in the table. */
export interface ColdGraftTtyPidsMissingError {
  readonly code: "TTY_PIDS_MISSING";
  readonly message: string;
  readonly pids: readonly number[];
}
/** The table's parent links loop back through a rooted pid. */
export interface ColdGraftTableLoopsError {
  readonly code: "TABLE_LOOPS";
  readonly message: string;
  readonly pids: readonly number[];
}
/** The listed pids sit under one another with no root among them. */
export interface ColdGraftListedUnrootedError {
  readonly code: "LISTED_UNROOTED";
  readonly message: string;
  readonly pids: readonly number[];
}
/** The table lists one pid twice. */
export interface ColdGraftTableListsTwiceError {
  readonly code: "TABLE_LISTS_PID_TWICE";
  readonly message: string;
  readonly pid: number;
}
/** cmux listed one tty pid twice. */
export interface ColdGraftTtyPidListedTwiceError {
  readonly code: "TTY_PID_LISTED_TWICE";
  readonly message: string;
  readonly pid: number;
}
/** cmux attributed one pid twice. */
export interface ColdGraftAttributedTwiceError {
  readonly code: "ATTRIBUTED_TWICE";
  readonly message: string;
  readonly pid: number;
}
/** The two reads name one pid as different processes. */
export interface ColdGraftPidRenamedError {
  readonly code: "PID_RENAMED";
  readonly message: string;
  readonly pid: number;
  readonly reported: string;
  readonly tabled: string;
}
/** A child cmux shows under one parent sits under another in the table. */
export interface ColdGraftEdgeDisagreesError {
  readonly code: "EDGE_DISAGREES";
  readonly message: string;
  readonly child: number;
  readonly parent: number;
  readonly tableParent: number;
}
/** A root cmux shows beside another attributed process sits under it in the table. */
export interface ColdGraftRootNestedError {
  readonly code: "ROOT_NESTED";
  readonly message: string;
  readonly root: number;
  readonly tableParent: number;
}
/** The graft would place one pid twice. */
export interface ColdGraftPlacedTwiceError {
  readonly code: "PLACED_TWICE";
  readonly message: string;
  readonly pid: number;
}
/** A root's table parent is not the cmux app. */
export interface ColdGraftRootNotUnderAppError {
  readonly code: "ROOT_NOT_UNDER_APP";
  readonly message: string;
  readonly root: number;
  readonly tableParent: number;
}
/** The roots sit under two cmux app processes. */
export interface ColdGraftRootsUnderTwoAppsError {
  readonly code: "ROOTS_UNDER_TWO_APPS";
  readonly message: string;
  readonly first: number;
  readonly second: number;
}
/**
 * Every way the graft refuses: the agreement half here, the tty half in `./coldGraftTtyErrors.ts`, the executable
 * half in `./coldExecutableErrors.ts`.
 */
export type ColdGraftError =
  | ColdGraftNothingToGraftError
  | ColdGraftAttributedMissingError
  | ColdGraftTtyPidsMissingError
  | ColdGraftTableLoopsError
  | ColdGraftListedUnrootedError
  | ColdGraftTableListsTwiceError
  | ColdGraftTtyPidListedTwiceError
  | ColdGraftAttributedTwiceError
  | ColdGraftPidRenamedError
  | ColdGraftEdgeDisagreesError
  | ColdGraftRootNestedError
  | ColdGraftPlacedTwiceError
  | ColdGraftRootNotUnderAppError
  | ColdGraftRootsUnderTwoAppsError
  | ColdGraftTtyError
  | ColdGraftExecutableError;

/**
 * The one place each refusal's wording lives, the tty half spread in from `./coldGraftTtyErrors.ts` and the
 * executable half from `./coldExecutableErrors.ts`.
 */
export const ColdGraftErrors = {
  ...ColdGraftExecutableErrors,
  ...ColdGraftTtyErrors,
  attributedMissing: ({ pids }: { pids: readonly number[] }): ColdGraftAttributedMissingError => ({
    code: "ATTRIBUTED_MISSING",
    message: `process(es) ${pids.join(", ")} cmux attributed to the tab are not in the process table read beside it`,
    pids,
  }),
  attributedTwice: ({ pid }: { pid: number }): ColdGraftAttributedTwiceError => ({
    code: "ATTRIBUTED_TWICE",
    message: `cmux attributed pid ${String(pid)} to the tab more than once`,
    pid,
  }),
  edgeDisagrees: ({
    child,
    parent,
    tableParent,
  }: {
    child: number;
    parent: number;
    tableParent: number;
  }): ColdGraftEdgeDisagreesError => ({
    child,
    code: "EDGE_DISAGREES",
    message: `process ${String(child)} cmux shows under ${String(parent)} is under ${String(tableParent)} in the process table read beside it`,
    parent,
    tableParent,
  }),
  listedUnrooted: ({ pids }: { pids: readonly number[] }): ColdGraftListedUnrootedError => ({
    code: "LISTED_UNROOTED",
    message: `the process table read beside the tab loops: listed pid(s) ${pids.join(", ")} sit under one another with no root among them`,
    pids,
  }),
  nothingToGraft: (): ColdGraftNothingToGraftError => ({
    code: "NOTHING_TO_GRAFT",
    message:
      "cmux reported no process for the tab, so there is nothing to graft; an empty tab is judged without the table",
  }),
  pidRenamed: ({
    pid,
    reported,
    tabled,
  }: {
    pid: number;
    reported: string;
    tabled: string;
  }): ColdGraftPidRenamedError => ({
    code: "PID_RENAMED",
    message: `process ${String(pid)} cmux reports as ${reported} is ${tabled} in the process table read beside it`,
    pid,
    reported,
    tabled,
  }),
  placedTwice: ({ pid }: { pid: number }): ColdGraftPlacedTwiceError => ({
    code: "PLACED_TWICE",
    message: `the graft would place pid ${String(pid)} twice, so the two reads disagree about where it sits`,
    pid,
  }),
  rootNested: ({ root, tableParent }: { root: number; tableParent: number }): ColdGraftRootNestedError => ({
    code: "ROOT_NESTED",
    message: `process ${String(root)} cmux shows as a root of the tab is under ${String(tableParent)} in the process table read beside it`,
    root,
    tableParent,
  }),
  rootNotUnderApp: ({ root, tableParent }: { root: number; tableParent: number }): ColdGraftRootNotUnderAppError => ({
    code: "ROOT_NOT_UNDER_APP",
    message: `process ${String(root)} cmux shows as a root of the tab is under ${String(tableParent)} in the process table read beside it, which is not the cmux app that owns the tab`,
    root,
    tableParent,
  }),
  rootsUnderTwoApps: ({ first, second }: { first: number; second: number }): ColdGraftRootsUnderTwoAppsError => ({
    code: "ROOTS_UNDER_TWO_APPS",
    first,
    message: `the tab's roots sit under two cmux app processes in the process table read beside it, ${String(first)} and ${String(second)}, and one tab is owned by one app`,
    second,
  }),
  tableListsTwice: ({ pid }: { pid: number }): ColdGraftTableListsTwiceError => ({
    code: "TABLE_LISTS_PID_TWICE",
    message: `the process table read beside the tab lists pid ${String(pid)} more than once`,
    pid,
  }),
  tableLoops: ({ pids }: { pids: readonly number[] }): ColdGraftTableLoopsError => ({
    code: "TABLE_LOOPS",
    message: `the process table read beside the tab loops: pid(s) ${pids.join(", ")} sit under their own descendants`,
    pids,
  }),
  ttyPidListedTwice: ({ pid }: { pid: number }): ColdGraftTtyPidListedTwiceError => ({
    code: "TTY_PID_LISTED_TWICE",
    message: `cmux listed tty pid ${String(pid)} for the tab more than once`,
    pid,
  }),
  ttyPidsMissing: ({ pids }: { pids: readonly number[] }): ColdGraftTtyPidsMissingError => ({
    code: "TTY_PIDS_MISSING",
    message: `tty pid(s) ${pids.join(", ")} cmux listed are not in the process table read beside it`,
    pids,
  }),
} as const;
