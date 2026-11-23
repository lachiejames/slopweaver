/**
 * Why the WHOLE process-table read (`./inspect.ts`'s `readProcessTableWhole`, `./processes.ts`'s
 * `parseProcessRowsWhole`) or one of the four scoped reads after it (`./coldReads.ts`: `readExecutables`,
 * `readTtyModes`, `readTtyHolders`, `readProcessGroups`) could not answer:
 * one discriminated union and its factory. The read a "nothing else runs here" verdict stands on never answers
 * partially, so each failure is a refusal of the whole read.
 */

/** `ps` itself could not be run or read. */
export interface ProcessTableUnreadableError {
  readonly code: "TABLE_UNREADABLE";
  readonly message: string;
  readonly cause: string;
}
/** A listing line is not a row and follows no row it could be the tail of. */
export interface ProcessTableUnplaceableLineError {
  readonly code: "LINE_UNPLACEABLE";
  readonly message: string;
  /** 1-based, as a reader counts lines. */
  readonly lineNumber: number;
  readonly line: string;
}

/** `lsof` could not be run or read for the pids whose executables the verdict needs. */
export interface ProcessTableExecutablesUnreadableError {
  readonly code: "EXECUTABLES_UNREADABLE";
  readonly message: string;
  readonly cause: string;
  readonly pids: readonly number[];
}

/** `lsof` could not be run or read for the tty whose holders the verdict needs. */
export interface ProcessTableTtyHoldersUnreadableError {
  readonly code: "TTY_HOLDERS_UNREADABLE";
  readonly message: string;
  readonly cause: string;
  readonly tty: string;
}

/** `ps` could not be run or read for the pids whose process groups the verdict needs. */
export interface ProcessTableProcessGroupsUnreadableError {
  readonly code: "PROCESS_GROUPS_UNREADABLE";
  readonly message: string;
  readonly cause: string;
  readonly pids: readonly number[];
}

/** `stty -g` could not be run, or printed a line that is not a tty's modes, for the tty whose modes the verdict needs. */
export interface ProcessTableTtyModesUnreadableError {
  readonly code: "TTY_MODES_UNREADABLE";
  readonly message: string;
  readonly cause: string;
  readonly tty: string;
}

/** Every way the whole read refuses. */
export type ProcessTableError =
  | ProcessTableUnreadableError
  | ProcessTableUnplaceableLineError
  | ProcessTableExecutablesUnreadableError
  | ProcessTableTtyHoldersUnreadableError
  | ProcessTableTtyModesUnreadableError
  | ProcessTableProcessGroupsUnreadableError;

/** The one place each refusal's wording lives. */
export const ProcessTableErrors = {
  executablesUnreadable: ({
    cause,
    pids,
  }: {
    cause: unknown;
    pids: readonly number[];
  }): ProcessTableExecutablesUnreadableError => {
    const text = cause instanceof Error ? cause.message : String(cause);
    return {
      cause: text,
      code: "EXECUTABLES_UNREADABLE",
      message: `the executables behind process(es) ${pids.join(", ")} could not be read (${text})`,
      pids,
    };
  },
  lineUnplaceable: ({ lineNumber, line }: { lineNumber: number; line: string }): ProcessTableUnplaceableLineError => ({
    code: "LINE_UNPLACEABLE",
    line,
    lineNumber,
    message: `line ${String(lineNumber)} of the process table is not a row and follows none: ${JSON.stringify(line)}`,
  }),
  processGroupsUnreadable: ({
    cause,
    pids,
  }: {
    cause: unknown;
    pids: readonly number[];
  }): ProcessTableProcessGroupsUnreadableError => {
    const text = cause instanceof Error ? cause.message : String(cause);
    return {
      cause: text,
      code: "PROCESS_GROUPS_UNREADABLE",
      message: `the process groups of process(es) ${pids.join(", ")} could not be read (${text})`,
      pids,
    };
  },
  ttyHoldersUnreadable: ({ cause, tty }: { cause: unknown; tty: string }): ProcessTableTtyHoldersUnreadableError => {
    const text = cause instanceof Error ? cause.message : String(cause);
    return {
      cause: text,
      code: "TTY_HOLDERS_UNREADABLE",
      message: `the processes holding tty ${tty} open could not be read (${text})`,
      tty,
    };
  },
  ttyModesUnreadable: ({ cause, tty }: { cause: unknown; tty: string }): ProcessTableTtyModesUnreadableError => {
    const text = cause instanceof Error ? cause.message : String(cause);
    return {
      cause: text,
      code: "TTY_MODES_UNREADABLE",
      message: `the modes of tty ${tty} could not be read (${text})`,
      tty,
    };
  },
  unreadable: ({ cause }: { cause: unknown }): ProcessTableUnreadableError => {
    const text = cause instanceof Error ? cause.message : String(cause);
    return { cause: text, code: "TABLE_UNREADABLE", message: `the process table could not be read (${text})` };
  },
} as const;
