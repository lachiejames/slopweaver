/**
 * The executable-side half of the cold-seat graft's refusals (`./coldGraftErrors.ts` holds the union): every variant
 * here is a way the image behind a shell or `login` in the tab's forest, read off `lsof` after the graft
 * (`./coldExecutables.ts`), says the process is not the one its argv names, or the pids holding the tab's tty device
 * open, read off `lsof` after that, say something outside the forest reads the tab, or the process groups read off
 * `ps -o pgid=,tpgid=` after that say the tab's tty is not the prompt shell's to read. The seam is those reads:
 * nothing here is reachable from the cmux reply and the process table alone, since both print only what the
 * process named itself and which terminal CONTROLS it, never which descriptors it holds nor whose group is the
 * terminal's foreground.
 */

/** A shell in the forest has no executable in the read beside it. */
export interface ColdGraftExecutableUnreadError {
  readonly code: "EXECUTABLE_UNREAD";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
}
/** A shell in the forest runs an image that is not the system shell its argv names. */
export interface ColdGraftExecutableOffSystemPathError {
  readonly code: "EXECUTABLE_OFF_SYSTEM_PATH";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly path: string;
}

/**
 * A `login` in the forest holds the tab's tty open, read off `lsof`: a real `/usr/bin/login` hands the tty to its
 * shell and keeps no descriptor on it, so one holding any could read a typed line. The login's image itself cannot
 * be read, since it is root's process.
 */
export interface ColdGraftLoginHoldsTtyError {
  readonly code: "LOGIN_HOLDS_TTY";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
  readonly fds: readonly number[];
}

/**
 * The forest the table rebuilt AFTER the lsof read is not the one it rebuilt before it: a process started, ended or
 * changed its name between the two reads. Each side is the forest in pre-order, one `d<depth> <pid> <name>` per
 * process, so the two lists are equal exactly when the two forests are.
 */
export interface ColdGraftForestChangedError {
  readonly code: "FOREST_CHANGED";
  readonly message: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/**
 * A process outside the tab's forest holds the tab's tty device open, read off `lsof`: a typed line could reach it,
 * and no `ps` column places it on the tab.
 */
export interface ColdGraftTtyHeldOutsideForestError {
  readonly code: "TTY_HELD_OUTSIDE_FOREST";
  readonly message: string;
  readonly pid: number;
  readonly tty: string;
}

/**
 * A shell at the tab's prompt shape does not hold the tab's tty on its stdin, read off `lsof`: it reads its commands
 * from somewhere else, so a typed line queues on the tty and reaches no reader.
 */
export interface ColdGraftShellStdinOffTtyError {
  readonly code: "SHELL_STDIN_OFF_TTY";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
  readonly fds: readonly number[];
}

/** A shell at the tab's prompt shape has no process group in the `ps` read beside it. */
export interface ColdGraftGroupUnreadError {
  readonly code: "GROUP_UNREAD";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
}

/**
 * A shell at the tab's prompt shape is in a process group that is not its tty's FOREGROUND group, read off `ps -o
 * pgid=,tpgid=`: the moment it reads the tty it is stopped with `SIGTTIN`, so a typed line queues unread.
 */
export interface ColdGraftShellNotForegroundError {
  readonly code: "SHELL_NOT_FOREGROUND";
  readonly message: string;
  readonly pid: number;
  readonly name: string;
  readonly tty: string;
  readonly pgid: number;
  readonly tpgid: number;
}

/**
 * The tab's tty is in canonical mode, or hands its line editing to the pty's master, read off `stty -g`: a shell at
 * its prompt reads raw through its own line editor, and in canonical mode the kernel holds a typed line until a
 * delimiter it may have been set to map away.
 */
export interface ColdGraftTtyCanonicalError {
  readonly code: "TTY_CANONICAL";
  readonly message: string;
  readonly tty: string;
  readonly flag: "icanon" | "extproc";
}

/**
 * The tab's tty has `igncr` set, read off `stty -g`: the kernel drops the carriage return an Enter key sends before
 * the shell sees it, so the line is typed and never entered.
 */
export interface ColdGraftTtyIgnoresReturnError {
  readonly code: "TTY_IGNORES_RETURN";
  readonly message: string;
  readonly tty: string;
}

/**
 * One of the tab's tty's control characters is set to a byte a typed line can carry, read off `stty -g`: the kernel
 * acts on that byte itself, eating the line's end on `^J` or `^M` or interrupting the shell on a letter, so the shell
 * never sees the line entered as typed. `char` is the byte as the refusal spells it: `^I`, `^J`, `^M`, a quoted
 * printable with its hex, or the bare hex of a high byte.
 */
export interface ColdGraftTtyEatsLineByteError {
  readonly code: "TTY_EATS_LINE_BYTE";
  readonly message: string;
  readonly tty: string;
  readonly name: string;
  readonly char: string;
}

/** The forest's roots are not in the table read beside it, so the tab's tty cannot be named. */
export interface ColdGraftTabTtyUnknownError {
  readonly code: "TAB_TTY_UNKNOWN";
  readonly message: string;
}

/**
 * The table read AFTER the lsof reads puts the same forest on another tty than the one read before them: the
 * holders read covered a tty the tab is no longer on.
 */
export interface ColdGraftTabTtyChangedError {
  readonly code: "TAB_TTY_CHANGED";
  readonly message: string;
  readonly before: string;
  readonly after: string;
}

/**
 * The table read AFTER the lsof reads places one forest pid differently from the read before them: under another
 * parent, on another tty, or spelled by another argv, with the forest's pids and names unchanged.
 */
export interface ColdGraftPlacementChangedError {
  readonly code: "PLACEMENT_CHANGED";
  readonly message: string;
  readonly pid: number;
  readonly before: string;
  readonly after: string;
}

/** Every executable-side way the graft refuses. */
export type ColdGraftExecutableError =
  | ColdGraftPlacementChangedError
  | ColdGraftExecutableUnreadError
  | ColdGraftExecutableOffSystemPathError
  | ColdGraftForestChangedError
  | ColdGraftGroupUnreadError
  | ColdGraftLoginHoldsTtyError
  | ColdGraftShellNotForegroundError
  | ColdGraftTtyHeldOutsideForestError
  | ColdGraftShellStdinOffTtyError
  | ColdGraftTabTtyUnknownError
  | ColdGraftTabTtyChangedError
  | ColdGraftTtyCanonicalError
  | ColdGraftTtyIgnoresReturnError
  | ColdGraftTtyEatsLineByteError;

/** What each canonical-side flag means for a typed line, in the refusal's words. */
const CANONICAL_WHY: Readonly<Record<ColdGraftTtyCanonicalError["flag"], string>> = {
  extproc: "hands its line editing to the pty's master",
  icanon:
    "is in canonical mode, where the kernel holds a typed line until a delimiter it may have been set to map away",
};

/** The one place each executable-side refusal's wording lives; spread into `ColdGraftErrors`. */
export const ColdGraftExecutableErrors = {
  executableOffSystemPath: ({
    pid,
    name,
    path,
  }: {
    pid: number;
    name: string;
    path: string;
  }): ColdGraftExecutableOffSystemPathError => ({
    code: "EXECUTABLE_OFF_SYSTEM_PATH",
    message: `process ${String(pid)} (${name}) in the tab's forest runs ${JSON.stringify(path)}, the image lsof lists for it, not the system shell its argv names`,
    name,
    path,
    pid,
  }),
  executableUnread: ({ pid, name }: { pid: number; name: string }): ColdGraftExecutableUnreadError => ({
    code: "EXECUTABLE_UNREAD",
    message: `process ${String(pid)} (${name}) in the tab's forest has no executable in the lsof read beside it, so what it runs is unconfirmed`,
    name,
    pid,
  }),
  forestChanged: ({
    before,
    after,
  }: {
    before: readonly string[];
    after: readonly string[];
  }): ColdGraftForestChangedError => ({
    after,
    before,
    code: "FOREST_CHANGED",
    message: `the tab's forest read after lsof is [${after.join(", ")}] where the one read before it was [${before.join(", ")}], so a process started, ended or changed between the two reads`,
  }),
  groupUnread: ({ pid, name }: { pid: number; name: string }): ColdGraftGroupUnreadError => ({
    code: "GROUP_UNREAD",
    message: `process ${String(pid)} (${name}) at the tab's prompt shape has no process group in the ps read beside it, so whether its tty's foreground is its own is unconfirmed`,
    name,
    pid,
  }),
  loginHoldsTty: ({
    pid,
    name,
    tty,
    fds,
  }: {
    pid: number;
    name: string;
    tty: string;
    fds: readonly number[];
  }): ColdGraftLoginHoldsTtyError => ({
    code: "LOGIN_HOLDS_TTY",
    fds,
    message: `process ${String(pid)} (${name}), the tab's login, holds the tab's tty ${tty} on descriptor(s) [${fds.join(", ")}] in the lsof read beside it, where a real login hands the tty to its shell and keeps none, so it could read a typed line`,
    name,
    pid,
    tty,
  }),
  placementChanged: ({
    pid,
    before,
    after,
  }: {
    pid: number;
    before: string;
    after: string;
  }): ColdGraftPlacementChangedError => ({
    after,
    before,
    code: "PLACEMENT_CHANGED",
    message: `process ${String(pid)} in the tab's forest is ${after} in the table read after lsof where it was ${before} in the one read before it, so the two reads disagree about where it sits`,
    pid,
  }),
  shellNotForeground: ({
    pid,
    name,
    tty,
    pgid,
    tpgid,
  }: {
    pid: number;
    name: string;
    tty: string;
    pgid: number;
    tpgid: number;
  }): ColdGraftShellNotForegroundError => ({
    code: "SHELL_NOT_FOREGROUND",
    message: `process ${String(pid)} (${name}) at the tab's prompt shape is in process group ${String(pgid)} while the tab's tty ${tty} has foreground group ${String(tpgid)} in the ps read beside it, so a line typed there would stop it with SIGTTIN and reach no prompt`,
    name,
    pgid,
    pid,
    tpgid,
    tty,
  }),
  shellStdinOffTty: ({
    pid,
    name,
    tty,
    fds,
  }: {
    pid: number;
    name: string;
    tty: string;
    fds: readonly number[];
  }): ColdGraftShellStdinOffTtyError => ({
    code: "SHELL_STDIN_OFF_TTY",
    fds,
    message: `process ${String(pid)} (${name}) at the tab's prompt shape holds the tab's tty ${tty} on descriptor(s) [${fds.join(", ")}] in the lsof read beside it, not on its stdin, so it reads its commands from somewhere else and a typed line would reach no reader`,
    name,
    pid,
    tty,
  }),
  tabTtyChanged: ({ before, after }: { before: string; after: string }): ColdGraftTabTtyChangedError => ({
    after,
    before,
    code: "TAB_TTY_CHANGED",
    message: `the tab's forest read after lsof is on tty ${after} where the one read before it was on ${before}, so the holders read covered a tty the tab is no longer on`,
  }),
  tabTtyUnknown: (): ColdGraftTabTtyUnknownError => ({
    code: "TAB_TTY_UNKNOWN",
    message: "the tab's forest has no root in the process table read beside it, so the tab's tty cannot be named",
  }),
  ttyCanonical: ({ tty, flag }: { tty: string; flag: "icanon" | "extproc" }): ColdGraftTtyCanonicalError => ({
    code: "TTY_CANONICAL",
    flag,
    message: `the tab's tty ${tty} has ${flag} set in the stty read beside it, so it ${CANONICAL_WHY[flag]}, where a shell at its prompt reads raw through its own line editor and a typed line would never be entered`,
    tty,
  }),
  ttyIgnoresReturn: ({ tty }: { tty: string }): ColdGraftTtyIgnoresReturnError => ({
    code: "TTY_IGNORES_RETURN",
    message: `the tab's tty ${tty} has igncr set in the stty read beside it, so the kernel would drop the carriage return an Enter sends before the shell saw it and a typed line would never be entered`,
    tty,
  }),
  ttyEatsLineByte: ({
    tty,
    name,
    char,
  }: {
    tty: string;
    name: string;
    char: string;
  }): ColdGraftTtyEatsLineByteError => ({
    char,
    code: "TTY_EATS_LINE_BYTE",
    message: `the tab's tty ${tty} has its ${name} character set to ${char} in the stty read beside it, a byte a typed line can carry, so the kernel would act on that byte itself and the shell would never see the line entered as typed`,
    name,
    tty,
  }),
  ttyHeldOutsideForest: ({ pid, tty }: { pid: number; tty: string }): ColdGraftTtyHeldOutsideForestError => ({
    code: "TTY_HELD_OUTSIDE_FOREST",
    message: `process ${String(pid)} holds the tab's tty ${tty} open in the lsof read beside it and is outside the tab's forest, so a typed line could reach it`,
    pid,
    tty,
  }),
} as const;
