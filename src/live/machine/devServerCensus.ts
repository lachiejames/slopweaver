/**
 * WHAT a docs dev server is, read off one `ps` snapshot — the census half of the stray-server check.
 *
 * This module answers one question and takes no view: which processes on this machine are serving a Next
 * site, and for each one, where a kill would have to start, what its whole tree is, what it costs and how
 * long it has been up. Whether any of them should be ENDED is `./devServers.ts`, which folds this census
 * against the seat, the board and the duplicates.
 *
 * Two facts about a `next-server` process are why the census is its own step rather than a line inside the
 * classifier. Its argv carries nothing — measured, it is literally `next-server (v15.5.25)`,
 * with no path and no port — so its identity is its working directory, which only an `lsof` can answer.
 * And it sits under a yarn wrapper that would respawn it, so the unit is a TREE and never a pid. Both
 * readings are bounded by {@link servingPids}, which is what the caller runs `lsof` over.
 *
 * Pure: a process snapshot, a cwd map and two optional samples in, one row per server out.
 * `./devServerRead.ts` owns the commands; `../../cli/commands/machine/reap.ts` owns the one `process.kill`.
 */
import { basename, dirname } from "node:path";

import type { ProcessRow } from "../standing/processes.js";
import { childIndexOf, type ProcessCpu, type ProcessElapsed } from "./fleetLoad.js";
import { treeCpu, treeDeepestFirst } from "./processTree.js";

/** A Next.js process that SERVES — `next dev` or `next start`. Never `next build`, which is not a server. */
const NEXT_SERVE = /(?:^|[/\s])next(?:\.js)?\s+(?:dev|start)(?:\s|$)/u;

/** A wrapper a serving process is launched through, whose own argv names the script rather than the server. */
const YARN_WRAPPER = /(?:^|[/\s])yarn(?:\.js)?\s+(?:dev|start|next)(?:\s|$)/u;

/** The port a serving process was given, in either spelling Next accepts. */
const PORT_FLAG = /(?:--port|-p)[\s=](\d{2,5})(?:\s|$)/u;

/** The directory a Next project is served from, under the worktree that owns it. */
const SITE_DIR = "site";

/** One dev server standing on this machine, with everything the decision needs already derived. */
export interface DevServer {
  /** The process a kill starts from — the wrapper when there is one, so nothing is left to respawn. */
  readonly rootPid: number;
  /** The `next dev`/`next start` process itself. */
  readonly servePid: number;
  /** The worktree it serves, derived from its cwd. */
  readonly worktree: string;
  /** The port its argv names, or `undefined` when it named none (Next then chose 3000 or the next free one). */
  readonly port: number | undefined;
  /** Its whole tree, DEEPEST FIRST, the root last: the exact order kills go out in. */
  readonly treePids: readonly number[];
  /** What each pid in {@link DevServer.treePids} was running when it was selected — the recycled-pid guard. */
  readonly argvByPid: Readonly<Record<string, string>>;
  /** The tree's summed `%CPU`, or `undefined` when no sample was taken. */
  readonly cpuPct: number | undefined;
  /** How long the serving process has been up, or `undefined` when no elapsed reading was available. */
  readonly elapsedSeconds: number | undefined;
}

/**
 * Every pid in a snapshot that SERVES a Next site — `next dev` or `next start`, never `next build`.
 *
 * The caller reads these pids' working directories (`./devServerRead.ts`), which is the only place a
 * `next-server` process's identity lives, so this is what bounds that read to a handful of pids.
 *
 * @param processes the decoded `ps` snapshot
 * @returns the serving pids, in snapshot order
 */
export function servingPids({ processes }: { processes: readonly ProcessRow[] }): readonly number[] {
  return processes.filter((row) => NEXT_SERVE.test(row.argv)).map((row) => row.pid);
}

/**
 * The worktree a cwd belongs to — `<worktree>/site` is where `scripts/docs-site.sh` serves from, so the
 * site directory is folded away and anything else is taken as-is.
 *
 * @param cwd the process's current working directory
 * @returns the worktree path
 */
export function worktreeOfCwd({ cwd }: { cwd: string }): string {
  if (basename(cwd) === SITE_DIR) {
    return dirname(cwd);
  }
  return cwd;
}

/** The port a serving process's argv names, or `undefined` when it named none. */
function portOf({ argv }: { argv: string }): number | undefined {
  const match = PORT_FLAG.exec(argv);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]);
}

/**
 * Where a kill starts: the yarn wrapper a serving process was launched through, when it has one, and the
 * serving process itself otherwise. Killing only the inner `next dev` leaves its wrapper holding the
 * terminal, which is the shape `scripts/docs-site.sh --stop` avoids by signalling the whole tree.
 */
function rootPidOf({ serve, byPid }: { serve: ProcessRow; byPid: ReadonlyMap<number, ProcessRow> }): number {
  const parent = byPid.get(serve.ppid);
  if (parent === undefined || !YARN_WRAPPER.test(parent.argv)) {
    return serve.pid;
  }
  return parent.pid;
}

/** One pid's argv from a snapshot, or `""` when that snapshot does not carry it. */
function argvOf({ byPid, pid }: { byPid: ReadonlyMap<number, string>; pid: number }): string {
  const argv = byPid.get(pid);
  if (argv === undefined) {
    return "";
  }
  return argv;
}

/**
 * Every dev server the snapshot carries, whatever its disposition — the census the classifier folds.
 *
 * A process with no cwd reading is absent from this census: without a cwd there is no worktree, and without
 * a worktree not one of the three criteria can be evaluated. `./devServers.ts`'s `strayDevServers` still reports it, as a
 * skip naming the unreadable directory, so an unclassifiable server is never silently invisible.
 *
 * @param processes the decoded `ps` snapshot
 * @param cwdByPid each candidate pid's current working directory
 * @param cpuRows the decoded per-process `%CPU` rows
 * @param elapsedRows the decoded per-process elapsed rows
 * @returns one row per serving process whose cwd is known
 */
export function devServers({
  processes,
  cwdByPid,
  cpuRows,
  elapsedRows,
}: {
  processes: readonly ProcessRow[];
  cwdByPid: ReadonlyMap<number, string>;
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
}): readonly DevServer[] {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const children = childIndexOf({ processes });
  const cpuByPid = new Map(cpuRows.map((row) => [row.pid, row.cpuPct]));
  const elapsedByPid = new Map(elapsedRows.map((row) => [row.pid, row.seconds]));
  const argvByPidAll = new Map(processes.map((row) => [row.pid, row.argv]));
  const servers: DevServer[] = [];
  for (const row of processes) {
    if (!NEXT_SERVE.test(row.argv)) {
      continue;
    }
    const cwd = cwdByPid.get(row.pid);
    if (cwd === undefined) {
      continue;
    }
    const rootPid = rootPidOf({ byPid, serve: row });
    const treePids = treeDeepestFirst({ childrenByPpid: children, root: rootPid });
    servers.push({
      argvByPid: Object.fromEntries(
        treePids.map((pid) => [String(pid), argvOf({ byPid: argvByPidAll, pid })]).filter(([, argv]) => argv !== ""),
      ),
      cpuPct: treeCpu({ cpuByPid, cpuRows, treePids }),
      elapsedSeconds: elapsedByPid.get(row.pid),
      port: portOf({ argv: row.argv }),
      rootPid,
      servePid: row.pid,
      treePids,
      worktree: worktreeOfCwd({ cwd }),
    });
  }
  return servers;
}
