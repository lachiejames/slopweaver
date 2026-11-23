/**
 * Each pid's process group and the FOREGROUND group of its controlling tty, decoded off `ps -o pid=,pgid=,tpgid= -p
 * <pids>`: the one pair that says whether a line typed at the tty reaches the shell. A shell in a group that is not
 * the tty's foreground group is stopped with `SIGTTIN` the moment it reads, so it shows every column a prompt shows,
 * sleeping and childless with the tty on fd 0, and the typed line queues on the tty unread (a helper that ignored
 * `SIGTTOU`, `tcsetpgrp`'d the tty to the `login`'s group and exited).
 * MEASURED the same day on cmux 0.65.2: a bare tab's shell is its own group leader and that group is the tty's
 * foreground (`40171 40171 40171`), its `login` in a group of its own with the shell's as the foreground (`40159
 * 40159 40171`), and a live tab's `claude` the foreground of its tty (`914 914 914`). The read is `./coldReads.ts`'s
 * `readProcessGroups`; this file is the decoder, pure.
 */

/** One pid's process group and the foreground group of its controlling tty. */
export type ProcessGroup = {
  readonly pgid: number;
  readonly tpgid: number;
};

/** One `ps -o pid=,pgid=,tpgid=` row: three integers, the last negative on macOS for a process on no tty. */
const GROUP_ROW = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s*$/u;

/**
 * Decode a `ps -o pid=,pgid=,tpgid=` listing into each pid's group pair. A line that is not three integers is not a
 * row and has no entry; a pid listed twice keeps its first row. A pid the listing holds no row for has no entry,
 * and the caller refuses it rather than guessing.
 *
 * @param text the raw listing
 * @returns each pid's group and its tty's foreground group
 */
export function parseProcessGroups({ text }: { readonly text: string }): ReadonlyMap<number, ProcessGroup> {
  const groups = new Map<number, ProcessGroup>();
  for (const line of text.split("\n")) {
    const row = GROUP_ROW.exec(line);
    if (row === null) {
      continue;
    }
    const [, pid = "", pgid = "", tpgid = ""] = row;
    if (!groups.has(Number(pid))) {
      groups.set(Number(pid), { pgid: Number(pgid), tpgid: Number(tpgid) });
    }
  }
  return groups;
}
