/**
 * The shells a retired chair's `claude` runs, read against its keep-alive: how many there are, how many host a seat
 * watch, and the first reason one of those hosting shells runs more than the keep-alive — its watch, plus any
 * read-only filters its own command pipes it through (`./keepAliveShellCommand.ts`). The decision that reads this is
 * `./keepAliveSeatClose.ts`; the incident and the measurement are its header.
 *
 * Pure: the seat's cmux process tree and one whole process-table read are the caller's.
 */
import type { CmuxProcess } from "../cmux/client.js";
import type { TtyProcessRow } from "../live/standing/processes.js";
import {
  commandName,
  filterRunsAs,
  type KeepAliveFilterName,
  parseKeepAliveShellCommand,
} from "./keepAliveShellCommand.js";

/** Why a hosting shell runs more than the keep-alive, naming the process that shows it. */
export type ShellFault =
  | { readonly kind: "stranger"; readonly pid: number; readonly name: string }
  | { readonly kind: "awake"; readonly pid: number; readonly state: string | undefined }
  | { readonly kind: "command"; readonly pid: number };

/** Every node under `node`, itself excluded. */
function descendants({ node }: { node: CmuxProcess }): readonly CmuxProcess[] {
  return node.children.flatMap((child) => [child, ...descendants({ node: child })]);
}

/**
 * Every row under `pid` in the process table, by parent pid, itself excluded.
 *
 * @param pid the process whose descendants are wanted
 * @param rows one whole read of the process table
 * @returns the rows below it, in discovery order
 */
export function tableDescendants({
  pid,
  rows,
}: {
  pid: number;
  rows: readonly TtyProcessRow[];
}): readonly TtyProcessRow[] {
  const found: TtyProcessRow[] = [];
  const frontier = [pid];
  const visited = new Set([pid]);
  for (let parent = frontier.pop(); parent !== undefined; parent = frontier.pop()) {
    for (const row of rows) {
      if (row.ppid === parent && !visited.has(row.pid)) {
        visited.add(row.pid);
        found.push(row);
        frontier.push(row.pid);
      }
    }
  }
  return found;
}

/**
 * The pids of the filter processes a keep-alive's pipeline names: DIRECT children of its shell, by the table, whose
 * executable the next unclaimed filter stage may run as. Each stage claims at most one process and owns only that
 * process, so a second `grep` the command never named, or anything a filter starts, stays a stranger.
 */
function filterPids({
  filters,
  rows,
  shellPid,
}: {
  filters: readonly KeepAliveFilterName[];
  rows: readonly TtyProcessRow[];
  shellPid: number;
}): readonly number[] {
  const unclaimed = [...filters];
  const claimed: number[] = [];
  for (const row of rows.filter((candidate) => candidate.ppid === shellPid)) {
    const name = commandName(row);
    const stage = unclaimed.findIndex((filter) => filterRunsAs({ filter, name }));
    if (stage !== -1 && !claimed.includes(row.pid)) {
      unclaimed.splice(stage, 1);
      claimed.push(row.pid);
    }
  }
  return claimed;
}

/** Whether a process is a shell by name — what Claude Code runs each background command in. */
function isShell({ node }: { node: CmuxProcess }): boolean {
  return /^-?(?:zsh|bash|sh|dash|ksh|fish)$/u.test(node.name);
}

/** Every pid a seat watch accounts for: the watch, its launcher, and everything the table places under it. */
function watchOwned({
  parentOf,
  rows,
  seatWatchPids,
}: {
  parentOf: ReadonlyMap<number, number>;
  rows: readonly TtyProcessRow[];
  seatWatchPids: readonly number[];
}): Set<number> {
  const owned = new Set<number>();
  for (const pid of seatWatchPids) {
    owned.add(pid);
    const launcher = parentOf.get(pid);
    if (launcher !== undefined) {
      owned.add(launcher);
    }
    for (const below of tableDescendants({ pid, rows })) {
      owned.add(below.pid);
    }
  }
  return owned;
}

/**
 * The first reason one hosting shell runs more than its keep-alive, or none. Its own command is read first: one that
 * is not a keep-alive is a `command` fault, and one that is names the filter processes it owns. Adds its watches' tree
 * and those filters to `owned`.
 */
function shellFault({
  owned,
  rows,
  shell,
  watchSet,
}: {
  owned: Set<number>;
  rows: readonly TtyProcessRow[];
  shell: CmuxProcess;
  watchSet: ReadonlySet<number>;
}): ShellFault | undefined {
  // The LAST row for the pid, as a pid-keyed map built from the table would hold it.
  const row = rows.findLast((candidate) => candidate.pid === shell.pid);
  const command = row === undefined ? undefined : parseKeepAliveShellCommand({ argv: row.argv });
  if (row !== undefined && command === undefined) {
    return { kind: "command", pid: shell.pid };
  }
  const under = descendants({ node: shell });
  for (const node of under.filter((candidate) => watchSet.has(candidate.pid))) {
    for (const below of descendants({ node })) {
      owned.add(below.pid);
    }
  }
  if (command !== undefined) {
    for (const pid of filterPids({ filters: command.filters, rows, shellPid: shell.pid })) {
      owned.add(pid);
    }
  }
  // The table is read AFTER the tree, so a process the shell started between the two shows only there: both are searched.
  const fromTable = tableDescendants({ pid: shell.pid, rows }).map((below) => ({
    name: commandName(below),
    pid: below.pid,
  }));
  const stranger = [...under, ...fromTable].find((node) => !owned.has(node.pid));
  if (stranger !== undefined) {
    return { kind: "stranger", name: stranger.name, pid: stranger.pid };
  }
  if (row === undefined || !/^[SI]/u.test(row.state)) {
    return { kind: "awake", pid: shell.pid, state: row?.state };
  }
  return undefined;
}

/**
 * How many shells the seat's `claude` runs, how many of them host a seat watch, and the first reason a hosting shell
 * runs more than the keep-alive — its command not a keep-alive, a process beside the watch and its named filters, or
 * the shell itself awake.
 *
 * The footer counts SHELLS, never watches, so the decision compares it with both: a watch count proves nothing, since
 * two watches can share one shell while a second, watch-free shell runs other work, and one shell can run a watch beside other work, `claude watch & sleep 600` (second pass). A shell is a
 * shell-named direct child of a tree root (the seat's `claude`), never any child: an MCP server or a watch started
 * outside a shell sits there too, and counting one as the footer's shell once let a real shell running `sleep` go
 * unread (fourth pass). A hosting shell must itself be ASLEEP, waiting on its children — `ps` state `S`, or `I` once
 * idle a while: a loop of builtins, `claude watch & while :; do :; done`, starts no child to catch and shows only as
 * the shell running (`R`), and a shell the table does not list proves nothing either (fifth pass).
 *
 * @param tree the process tree cmux attributes to the seat
 * @param seatWatchPids the standing watches inside the seat
 * @param rows one whole read of the process table
 * @returns the two counts and the first fault, if any
 */
export function watchShells({
  tree,
  seatWatchPids,
  rows,
}: {
  tree: readonly CmuxProcess[];
  seatWatchPids: readonly number[];
  rows: readonly TtyProcessRow[];
}): { readonly shells: number; readonly hosting: number; readonly fault: ShellFault | undefined } {
  const parentOf = new Map(rows.map((row) => [row.pid, row.ppid]));
  const watchSet = new Set(seatWatchPids);
  const owned = watchOwned({ parentOf, rows, seatWatchPids });
  const shells = tree.flatMap((root) => root.children).filter((node) => isShell({ node }));
  const hostingShells = shells.filter((shell) => descendants({ node: shell }).some((node) => watchSet.has(node.pid)));
  for (const shell of hostingShells) {
    const fault = shellFault({ owned, rows, shell, watchSet });
    if (fault !== undefined) {
      return { fault, hosting: hostingShells.length, shells: shells.length };
    }
  }
  return { fault: undefined, hosting: hostingShells.length, shells: shells.length };
}
