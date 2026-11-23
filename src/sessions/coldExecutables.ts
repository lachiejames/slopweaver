/**
 * Whether each shell in a grafted tab forest runs the image its argv names, read off `lsof` AFTER the graft
 * (`./coldGraft.ts`). The argv is the process's own word for itself: `execve("/tmp/zsh", ["/bin/zsh"])` lists as
 * `/bin/zsh` in every `ps` column, MEASURED on macOS, and passed every check keyed on it. The executable is the kernel's: the first `txt` file `lsof` lists for the pid is the mapped
 * image (`../live/standing/executables.ts`), and a shell whose image is outside the system shell directories, or is
 * not the shell its argv spells, is refused. Only shells are read: a program's presence already makes the tab not a
 * prompt, and a `login` is root's process, which `lsof` as the owner cannot read (`executablePids`), so a `login` is
 * held to holding NO descriptor on the tab's tty instead (`ttyHoldersAgree`). A pid the read holds no image for is
 * refused, never assumed. The table is then
 * read AGAIN and must rebuild the same forest (`forestChanged`): `lsof` reads only the pids the first table placed,
 * so a child the shell forked between that table read and the lsof read was in neither, and the shell it hung
 * under confirmed as `/bin/zsh`. Between the two, every pid holding the
 * tab's tty DEVICE open, and on which descriptors, is read off `lsof` (`ttyHoldersAgree`): every holder must be in
 * the forest, since a `setsid`'d helper on no controlling tty that kept a descriptor on the tab's tty reads what is
 * typed there and no `ps` column shows it as the tab's, and every shell at the prompt shape must hold the tty on
 * fd 0, since a shell reading its commands from a FIFO holds it on fds 1 and 2 alone and a typed line reaches no
 * reader. MEASURED the same day: a bare tab's tty is held by its shell
 * alone, on fds 0, 1, 2, 10 and 14, the `login` holding no descriptor on it, so holders are a SUBSET of the forest,
 * never the forest. After the holders, each prompt shell's process group and its tty's FOREGROUND group are read
 * off `ps -o pgid=,tpgid=` and must be the same (`foregroundAgrees`): a shell in a background group is stopped with
 * `SIGTTIN` the moment it reads, and a typed line queues unread. Pure.
 */
import type { CmuxProcess } from "../cmux/client.js";
import { err, ok, type Result } from "../lib/result.js";
import { flattenProcessTreePids, type TtyProcessRow } from "../live/standing/processes.js";
import type { ProcessGroup } from "../live/standing/processGroups.js";
import { type ColdGraftExecutableError, ColdGraftExecutableErrors } from "./coldExecutableErrors.js";
import { isSystemShellPath, processClass } from "./coldProcessClass.js";

/**
 * Every process in the forest of one class, in pre-order.
 *
 * @param tree the grafted forest
 * @param kind the class wanted
 * @returns those processes
 */
function ofClass({ tree, kind }: { tree: readonly CmuxProcess[]; kind: "shell" | "login" }): readonly CmuxProcess[] {
  return tree.flatMap((process) => [
    ...(processClass({ name: process.name }) === kind ? [process] : []),
    ...ofClass({ kind, tree: process.children }),
  ]);
}

/**
 * The pids whose executable the verdict needs: each SHELL's in the forest, never a `login`'s. A tab's `login` is
 * root's process (`/usr/bin/login` is setuid, and `ps -o user=` prints `root` for it), and `lsof` run as the owner
 * prints no block for a root process and exits 1, MEASURED on a real bare tab (`lsof -p 40159,40171`:
 * the shell's block alone, exit 1; `-p 40171`: exit 0). Asked for, the login made the read refuse every real bare
 * tab whole. The login is held to the tty-holder read instead (`ttyHoldersAgree`): a real one hands the tty to its
 * shell and keeps no descriptor on it.
 *
 * @param tree the grafted forest
 * @returns the shells' pids, in pre-order
 */
export function executablePids({ tree }: { tree: readonly CmuxProcess[] }): readonly number[] {
  return ofClass({ kind: "shell", tree }).map((process) => process.pid);
}

/**
 * Whether the image behind one shell is the system shell its argv names. An argv that spells a PATH (`-/bin/zsh`,
 * every tab cmux starts) must be the image EXACTLY: a `/bin/bash` behind a `-/bin/zsh` row is refused as a
 * `/tmp/zsh` is, and so is a `/usr/local/bin/zsh`, a system shell
 * directory and the same bare name, behind that row (a basename match let an image in
 * another allowlisted directory through). An argv spelling no path at all is refused: the forest carries the table's
 * spelling (`./coldGraft.ts`, forty-first pass), and no tab cmux starts spells its shell bare.
 *
 * @param process the forest's shell
 * @param path the image lsof lists for it
 * @returns `true` only for the exact system shell path the argv spells
 */
function runsSystemShell({ process, path }: { process: CmuxProcess; path: string }): boolean {
  const spelled = process.name.replace(/^-/u, "");
  return spelled.startsWith("/") && path === spelled && isSystemShellPath({ word: spelled });
}

/**
 * The first shell in the forest whose executable is unread or is not the system shell its argv names.
 *
 * @param tree the grafted forest
 * @param executables each pid's image, as `parseExecutables` decoded the lsof read taken after the graft
 * @returns the refusal, or `undefined` when every shell in the forest runs its system image
 */
export function executablesAgree({
  tree,
  executables,
}: {
  tree: readonly CmuxProcess[];
  executables: ReadonlyMap<number, string>;
}): ColdGraftExecutableError | undefined {
  for (const process of ofClass({ kind: "shell", tree })) {
    const path = executables.get(process.pid);
    if (path === undefined) {
      return ColdGraftExecutableErrors.executableUnread({ name: process.name, pid: process.pid });
    }
    if (!runsSystemShell({ path, process })) {
      return ColdGraftExecutableErrors.executableOffSystemPath({ name: process.name, path, pid: process.pid });
    }
  }
  return undefined;
}

/**
 * One table read's graft: the forest, the tty every root of it sits on, and where that read placed each forest pid
 * (`tabPlacement`).
 */
export type GraftedTab = {
  readonly tree: readonly CmuxProcess[];
  readonly tty: string;
  readonly placement: ReadonlyMap<number, string>;
};

/**
 * Where one table read places each pid of the grafted forest: its parent, its tty and its argv, as one label per
 * pid. Two reads that rebuild the same forest on the same tty can still disagree here — a root under one cmux app
 * row in the first read and under another in the second — and the
 * state is left out on purpose, since each read judges it alone and `S+` beside `S` is one sleeping shell.
 *
 * @param tree the grafted forest
 * @param rows the table it was grafted from
 * @returns each forest pid the table holds, to its placement label
 */
export function tabPlacement({
  tree,
  rows,
}: {
  tree: readonly CmuxProcess[];
  rows: readonly TtyProcessRow[];
}): ReadonlyMap<number, string> {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const placement = new Map<number, string>();
  for (const pid of flattenProcessTreePids({ roots: tree })) {
    const row = byPid.get(pid);
    if (row !== undefined) {
      placement.set(pid, `under ${String(row.ppid)} on ${row.tty} as ${JSON.stringify(row.argv)}`);
    }
  }
  return placement;
}

/**
 * The tab's tty: the one every root of the grafted forest sits on in the table, which the graft already required to
 * be ONE real tty, read off the first root's row.
 *
 * @param tree the grafted forest
 * @param rows the table it was grafted from
 * @returns the tty, or the refusal when no root is in the table
 */
export function tabTty({
  tree,
  rows,
}: {
  tree: readonly CmuxProcess[];
  rows: readonly TtyProcessRow[];
}): Result<string, ColdGraftExecutableError> {
  const [root] = tree;
  const row = root === undefined ? undefined : rows.find((candidate) => candidate.pid === root.pid);
  return row === undefined ? err(ColdGraftExecutableErrors.tabTtyUnknown()) : ok(row.tty);
}

/**
 * The shells that would be the tab's prompt: each childless shell reached from a root through shells and logins
 * alone, in pre-order. A shell under a program is not one — the program already makes the tab not a prompt, and a
 * `claude`'s pipe-driven shells measurably hold no tty at all.
 *
 * @param tree the grafted forest
 * @returns those shells
 */
function promptShells({ tree }: { tree: readonly CmuxProcess[] }): readonly CmuxProcess[] {
  return tree.flatMap((process) => {
    const kind = processClass({ name: process.name });
    if (kind === "program") {
      return [];
    }
    if (kind === "shell" && process.children.length === 0) {
      return [process];
    }
    return promptShells({ tree: process.children });
  });
}

/**
 * Whether the tty holders `lsof` lists agree the forest is what reads the tab: every holder is in the forest, and
 * every shell at the prompt shape holds the tty on fd 0. The first is a `setsid`'d helper on no controlling tty that
 * kept a descriptor on the tab's tty; the second a shell started `exec /bin/zsh -i </tmp/feed`, its stdout and
 * stderr on the tty and its commands read from the FIFO, which shows every `ps` column a prompt shows and holds the
 * tty on fds 1 and 2. MEASURED the same day: a bare tab's shell holds
 * its tty on fds 0, 1, 2, 10 and 14.
 *
 * @param tree the grafted forest
 * @param holders each pid `lsof` lists for the tab's tty device with the descriptors it holds it on
 * @param tty the tab's tty, for the refusal
 * @returns the refusal, or `undefined` when every holder is in the forest and every prompt shell reads the tty
 */
export function ttyHoldersAgree({
  tree,
  holders,
  tty,
}: {
  tree: readonly CmuxProcess[];
  holders: ReadonlyMap<number, readonly number[]>;
  tty: string;
}): ColdGraftExecutableError | undefined {
  const placed = new Set(flattenProcessTreePids({ roots: tree }));
  const outside = [...holders.keys()].find((pid) => !placed.has(pid));
  if (outside !== undefined) {
    return ColdGraftExecutableErrors.ttyHeldOutsideForest({ pid: outside, tty });
  }
  const login = loginHoldingTty({ holders, tree, tty });
  if (login !== undefined) {
    return login;
  }
  for (const shell of promptShells({ tree })) {
    const fds = holders.get(shell.pid);
    if (fds === undefined) {
      // A prompt shell lsof lists no descriptor for holds the tty on nothing, stdin included.
      return ColdGraftExecutableErrors.shellStdinOffTty({ fds: [], name: shell.name, pid: shell.pid, tty });
    }
    if (!fds.includes(0)) {
      return ColdGraftExecutableErrors.shellStdinOffTty({ fds, name: shell.name, pid: shell.pid, tty });
    }
  }
  return undefined;
}

/**
 * The first `login` in the forest that holds the tab's tty on any descriptor. A real `/usr/bin/login` hands the tty
 * to the shell it starts and keeps none, MEASURED on a bare tab (`lsof -Fpf /dev/ttys005`: the shell's
 * block alone); it is root's process, so its image cannot be read off `lsof` as the owner, and this is the check
 * that stands in: a `/tmp/login` that forks a real shell and keeps reading the tty holds
 * fd 0 on it.
 *
 * @param tree the grafted forest
 * @param holders each pid `lsof` lists for the tab's tty device with the descriptors it holds it on
 * @param tty the tab's tty, for the refusal
 * @returns the refusal, or `undefined` when no `login` in the forest holds the tty
 */
function loginHoldingTty({
  tree,
  holders,
  tty,
}: {
  tree: readonly CmuxProcess[];
  holders: ReadonlyMap<number, readonly number[]>;
  tty: string;
}): ColdGraftExecutableError | undefined {
  for (const login of ofClass({ kind: "login", tree })) {
    const fds = holders.get(login.pid);
    if (fds !== undefined) {
      return ColdGraftExecutableErrors.loginHoldsTty({ fds, name: login.name, pid: login.pid, tty });
    }
  }
  return undefined;
}

/**
 * The pids whose process groups the verdict needs: each shell at the prompt shape, in pre-order.
 *
 * @param tree the grafted forest
 * @returns their pids
 */
export function promptShellPids({ tree }: { tree: readonly CmuxProcess[] }): readonly number[] {
  return promptShells({ tree }).map((process) => process.pid);
}

/**
 * Whether every shell at the prompt shape is in the FOREGROUND process group of the tab's tty, read off `ps -o
 * pgid=,tpgid=`: a shell in any other group is stopped with `SIGTTIN` the moment it reads the tty, so a typed line
 * queues unread while every other column shows a prompt, sleeping and childless with the tty on fd 0 (a helper that ignored `SIGTTOU`, `tcsetpgrp`'d the tty to the `login`'s group
 * and exited). MEASURED the same day: a bare tab's shell is its own group leader and that group is the tty's
 * foreground. A prompt shell the read holds no group for is refused, never assumed.
 *
 * @param tree the grafted forest
 * @param groups each pid's group and its tty's foreground group, as `parseProcessGroups` decoded the read
 * @param tty the tab's tty, for the refusal
 * @returns the refusal, or `undefined` when every prompt shell's group is its tty's foreground group
 */
export function foregroundAgrees({
  tree,
  groups,
  tty,
}: {
  tree: readonly CmuxProcess[];
  groups: ReadonlyMap<number, ProcessGroup>;
  tty: string;
}): ColdGraftExecutableError | undefined {
  for (const shell of promptShells({ tree })) {
    const group = groups.get(shell.pid);
    if (group === undefined) {
      return ColdGraftExecutableErrors.groupUnread({ name: shell.name, pid: shell.pid });
    }
    if (group.pgid !== group.tpgid) {
      return ColdGraftExecutableErrors.shellNotForeground({
        name: shell.name,
        pgid: group.pgid,
        pid: shell.pid,
        tpgid: group.tpgid,
        tty,
      });
    }
  }
  return undefined;
}

/**
 * A forest as one label per process in pre-order, `d<depth> <pid> <name>`: two forests are equal exactly when their
 * label lists are, since pre-order with depths rebuilds the one forest.
 *
 * @param tree the forest
 * @param depth the depth of its roots
 * @returns the labels
 */
function forestLabels({ tree, depth }: { tree: readonly CmuxProcess[]; depth: number }): readonly string[] {
  return tree.flatMap((process) => [
    `d${String(depth)} ${String(process.pid)} ${process.name}`,
    ...forestLabels({ depth: depth + 1, tree: process.children }),
  ]);
}

/**
 * Whether the forest the table rebuilt after the lsof read differs from the one it rebuilt before it.
 *
 * @param before the forest grafted from the table read before `lsof`
 * @param after the forest grafted from the table read after it
 * @returns the refusal naming both, or `undefined` when the two forests are the same
 */
export function forestChanged({
  before,
  after,
}: {
  before: readonly CmuxProcess[];
  after: readonly CmuxProcess[];
}): ColdGraftExecutableError | undefined {
  const was = forestLabels({ depth: 0, tree: before });
  const is = forestLabels({ depth: 0, tree: after });
  if (was.length === is.length && was.every((label, index) => label === is[index])) {
    return undefined;
  }
  return ColdGraftExecutableErrors.forestChanged({ after: is, before: was });
}

/**
 * Whether the graft the table rebuilt after the lsof reads differs from the one it rebuilt before them: the forest,
 * then the tty it sits on, since the holders read covered the FIRST read's tty and a tab the second read puts on
 * another one was never checked, then where each forest pid sits, since
 * the same forest on the same tty can be under another cmux app row in the second read.
 *
 * @param before the graft off the table read before `lsof`
 * @param after the graft off the table read after it
 * @returns the refusal, or `undefined` when the forest, its tty and every pid's placement are the same
 */
export function graftChanged({
  before,
  after,
}: {
  before: GraftedTab;
  after: GraftedTab;
}): ColdGraftExecutableError | undefined {
  const forest = forestChanged({ after: after.tree, before: before.tree });
  if (forest !== undefined) {
    return forest;
  }
  if (before.tty !== after.tty) {
    return ColdGraftExecutableErrors.tabTtyChanged({ after: after.tty, before: before.tty });
  }
  for (const pid of new Set([...before.placement.keys(), ...after.placement.keys()])) {
    const was = placementLabel({ pid, placement: before.placement });
    const is = placementLabel({ pid, placement: after.placement });
    if (was !== is) {
      return ColdGraftExecutableErrors.placementChanged({ after: is, before: was, pid });
    }
  }
  return undefined;
}

/**
 * One read's placement label for a forest pid, or the word for a pid that read's table did not hold.
 *
 * @param pid the forest pid
 * @param placement that read's placement
 * @returns the label
 */
function placementLabel({ pid, placement }: { pid: number; placement: ReadonlyMap<number, string> }): string {
  const label = placement.get(pid);
  if (label === undefined) {
    return "absent from the table";
  }
  return label;
}
