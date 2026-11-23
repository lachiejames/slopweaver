/**
 * The tty-side half of the cold-seat graft's refusals (`./coldGraftErrors.ts` holds the union and the agreement
 * half): every variant here is a way the tab's rows, read off the `tty=` and `stat=` columns and each row's argv,
 * say the tab is not a bare shell at its prompt even though cmux's reply and the table agree on the tree. The
 * seam is the column read: nothing here is reachable from a table without a tty column.
 */

/** A root is on no tty. */
export interface ColdGraftRootOnNoTtyError {
  readonly code: "ROOT_ON_NO_TTY";
  readonly message: string;
  readonly pid: number;
}
/** A root's tty token is neither `??` nor a `ttys<N>`, so it names no device the tab could be read on. */
export interface ColdGraftRootOnUnrealTtyError {
  readonly code: "ROOT_ON_UNREAL_TTY";
  readonly message: string;
  readonly pid: number;
  readonly tty: string;
}
/** The roots sit on two ttys. */
export interface ColdGraftRootsOnTwoTtysError {
  readonly code: "ROOTS_ON_TWO_TTYS";
  readonly message: string;
  readonly first: string;
  readonly second: string;
}
/** A process on the tab's tty is in the forest nowhere. */
export interface ColdGraftStrayOnTtyError {
  readonly code: "STRAY_ON_TTY";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
}
/** A childless shell on the tab's tty was started on a script or a command string, so it is at no prompt. */
export interface ColdGraftShellRunsScriptError {
  readonly code: "SHELL_RUNS_SCRIPT";
  readonly message: string;
  readonly pid: number;
  readonly argv: string;
  readonly tty: string;
}
/** A childless shell on the tab's tty is spelled by bare name or by a path outside the system shell directories. */
export interface ColdGraftShellOffSystemPathError {
  readonly code: "SHELL_OFF_SYSTEM_PATH";
  readonly message: string;
  readonly pid: number;
  readonly argv: string;
  readonly tty: string;
}
/** A `login` on the tab's tty is spelled by bare name or by a path other than `/usr/bin/login`. */
export interface ColdGraftLoginOffSystemPathError {
  readonly code: "LOGIN_OFF_SYSTEM_PATH";
  readonly message: string;
  readonly pid: number;
  readonly argv: string;
  readonly tty: string;
}
/** A process in the tab's forest sits on a tty that is not the tab's, or on none under a shell or `login`. */
export interface ColdGraftPlacedOnOtherTtyError {
  readonly code: "PLACED_ON_OTHER_TTY";
  readonly message: string;
  readonly pid: number;
  readonly tty: string;
  readonly tabTty: string;
}
/** A process on the tab's tty is stopped by a signal or has exited unreaped, so nothing on that tty is at a prompt. */
export interface ColdGraftStoppedOnTtyError {
  readonly code: "STOPPED_ON_TTY";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
  readonly state: string;
}

/**
 * A childless interactive shell on the tab's tty is on the CPU: a shell at its prompt sleeps in its line editor, so
 * this one is running a builtin loop that forked nothing, and a typed line would queue behind it.
 */
export interface ColdGraftShellBusyOnTtyError {
  readonly code: "SHELL_BUSY_ON_TTY";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
  readonly state: string;
}

/** Every tty-side way the graft refuses. */
export type ColdGraftTtyError =
  | ColdGraftRootOnNoTtyError
  | ColdGraftRootOnUnrealTtyError
  | ColdGraftRootsOnTwoTtysError
  | ColdGraftStrayOnTtyError
  | ColdGraftStoppedOnTtyError
  | ColdGraftShellBusyOnTtyError
  | ColdGraftShellRunsScriptError
  | ColdGraftShellOffSystemPathError
  | ColdGraftLoginOffSystemPathError
  | ColdGraftPlacedOnOtherTtyError;

/** The one place each tty-side refusal's wording lives; spread into `ColdGraftErrors`. */
export const ColdGraftTtyErrors = {
  loginOffSystemPath: ({
    pid,
    argv,
    tty,
  }: {
    pid: number;
    argv: string;
    tty: string;
  }): ColdGraftLoginOffSystemPathError => ({
    argv,
    code: "LOGIN_OFF_SYSTEM_PATH",
    message: `process ${String(pid)} on the tab's tty ${tty} is a login started as ${JSON.stringify(argv)} in the process table read beside it, not /usr/bin/login, the one that hands a tab to its shell`,
    pid,
    tty,
  }),
  placedOnOtherTty: ({
    pid,
    tty,
    tabTty,
  }: {
    pid: number;
    tty: string;
    tabTty: string;
  }): ColdGraftPlacedOnOtherTtyError => ({
    code: "PLACED_ON_OTHER_TTY",
    message: `process ${String(pid)} in the tab's forest sits on tty ${tty} in the process table read beside it, not the tab's ${tabTty}, so what it runs is unread by the tab's tty`,
    pid,
    tabTty,
    tty,
  }),
  rootOnNoTty: ({ pid }: { pid: number }): ColdGraftRootOnNoTtyError => ({
    code: "ROOT_ON_NO_TTY",
    message: `process ${String(pid)} cmux shows as a root of the tab is on no tty in the process table read beside it`,
    pid,
  }),
  rootOnUnrealTty: ({ pid, tty }: { pid: number; tty: string }): ColdGraftRootOnUnrealTtyError => ({
    code: "ROOT_ON_UNREAL_TTY",
    message: `process ${String(pid)} cmux shows as a root of the tab is on tty ${JSON.stringify(tty)} in the process table read beside it, which is not a ttys<N> device name, so the row is misread`,
    pid,
    tty,
  }),
  rootsOnTwoTtys: ({ first, second }: { first: string; second: string }): ColdGraftRootsOnTwoTtysError => ({
    code: "ROOTS_ON_TWO_TTYS",
    first,
    message: `the tab's roots sit on two ttys in the process table read beside it, ${first} and ${second}, and one tab is one tty`,
    second,
  }),
  shellOffSystemPath: ({
    pid,
    argv,
    tty,
  }: {
    pid: number;
    argv: string;
    tty: string;
  }): ColdGraftShellOffSystemPathError => ({
    argv,
    code: "SHELL_OFF_SYSTEM_PATH",
    message: `process ${String(pid)} on the tab's tty ${tty} is a shell started as ${JSON.stringify(argv)} in the process table read beside it, by bare name or from outside the system shell directories, not the shell cmux starts a tab on`,
    pid,
    tty,
  }),
  shellBusyOnTty: ({
    pid,
    name,
    tty,
    state,
  }: {
    pid: number;
    name: string;
    tty: string;
    state: string;
  }): ColdGraftShellBusyOnTtyError => ({
    code: "SHELL_BUSY_ON_TTY",
    message: `process ${String(pid)} (${name}) on the tab's tty ${tty} is in state ${state} in the process table read beside it, on the CPU, where a shell at its prompt sleeps in its line editor, so it is running a builtin loop and a typed line would queue behind it`,
    name,
    pid,
    state,
    tty,
  }),
  shellRunsScript: ({ pid, argv, tty }: { pid: number; argv: string; tty: string }): ColdGraftShellRunsScriptError => ({
    argv,
    code: "SHELL_RUNS_SCRIPT",
    message: `process ${String(pid)} on the tab's tty ${tty} is a shell started as ${JSON.stringify(argv)} in the process table read beside it, not one at its prompt`,
    pid,
    tty,
  }),
  stoppedOnTty: ({
    pid,
    name,
    tty,
    state,
  }: {
    pid: number;
    name: string;
    tty: string;
    state: string;
  }): ColdGraftStoppedOnTtyError => ({
    code: "STOPPED_ON_TTY",
    message: `process ${String(pid)} (${name}) on the tab's tty ${tty} is in state ${state} in the process table read beside it, stopped or exited, and such a process is at no prompt`,
    name,
    pid,
    state,
    tty,
  }),
  strayOnTty: ({ pid, name, tty }: { pid: number; name: string; tty: string }): ColdGraftStrayOnTtyError => ({
    code: "STRAY_ON_TTY",
    message: `process ${String(pid)} (${name}) is on the tab's tty ${tty} in the process table read beside it, and cmux neither attributed nor listed it`,
    name,
    pid,
    tty,
  }),
} as const;
