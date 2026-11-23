/**
 * A cmux 0.65.2 tab's tree with the tty processes cmux attributes to no tree grafted back in from the process table
 * read beside it, failing CLOSED on every way the two reads can disagree. The judge in `./coldSeat.ts` reads the result
 * as a prompt or not; the agreement checks that run first are `./coldGraftAgreement.ts`. Pure.
 */
import { isCmuxAppCommand } from "../cmux/appProcess.js";
import type { CmuxProcess } from "../cmux/client.js";
import { err, ok, type Result } from "../lib/result.js";
import { flattenProcessTreePids, type ProcessRow, type TtyProcessRow } from "../live/standing/processes.js";
import { agreedTable, ancestorIn, repeatedPid, rowName, strayOnTabTty } from "./coldGraftAgreement.js";
import { type ColdGraftError, ColdGraftErrors } from "./coldGraftErrors.js";

/**
 * The table's rows grouped by parent pid.
 *
 * @param rows the whole process table
 * @returns the rows under each parent pid
 */
function childrenIndex({ rows }: { rows: readonly ProcessRow[] }): ReadonlyMap<number, readonly ProcessRow[]> {
  const childrenOf = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid);
    if (siblings === undefined) {
      childrenOf.set(row.ppid, [row]);
    } else {
      siblings.push(row);
    }
  }
  return childrenOf;
}

/**
 * The rows the table shows under one pid; a pid with no row under it has none.
 *
 * @param childrenOf the table's rows by parent pid
 * @param pid the parent
 * @returns its rows
 */
function tableChildren({
  childrenOf,
  pid,
}: {
  childrenOf: ReadonlyMap<number, readonly ProcessRow[]>;
  pid: number;
}): readonly ProcessRow[] {
  const children = childrenOf.get(pid);
  if (children === undefined) {
    return [];
  }
  return children;
}

/** What one walk of the table knows: the pids on the path so far, and the pids an earlier walk already placed. */
type Walk = { readonly seen: Set<number>; readonly placed: ReadonlySet<number> };

/**
 * The two ways a grafted tree grows: `build` reads a subtree off the table alone, `withTable` keeps every child cmux
 * gave an attributed process AND adds every child the table shows under it (cmux's tree can omit
 * a process `ps` already holds, and the typed line would reach it). A child an earlier walk placed is not repeated; a
 * child THIS walk already holds is a parent cycle in the table, recorded in `cycles` and not descended, so the walk
 * ends and the graft refuses (a cycle through a listed `login` rebuilt as the prompt shape).
 *
 * An attributed process is NAMED BY THE TABLE'S ROW, never by cmux's word for it: cmux reports a bare `zsh` where the
 * table's argv spells `/bin/zsh`, and the executable check after the graft holds a shell's image to the exact path
 * its argv spells, so a bare name there let a `/usr/local/bin/zsh` image through on its basename. The two spellings already agree by class and bare name (`sameProcess`), so the
 * table's loses nothing and carries the path.
 *
 * @param childrenOf the table's rows by parent pid
 * @param byPid the table's rows by pid, every attributed pid among them (`agreedTable` refused otherwise)
 * @returns the two builders, sharing that index, and the pids that closed a cycle
 */
function treeBuilders({
  childrenOf,
  byPid,
}: {
  childrenOf: ReadonlyMap<number, readonly ProcessRow[]>;
  byPid: ReadonlyMap<number, ProcessRow>;
}): {
  readonly build: (input: { row: ProcessRow; walk: Walk }) => CmuxProcess;
  readonly withTable: (input: { process: CmuxProcess; walk: Walk }) => CmuxProcess;
  readonly cycles: number[];
} {
  const cycles: number[] = [];
  const fresh = ({ pid, walk }: { pid: number; walk: Walk }): boolean => {
    if (walk.placed.has(pid)) {
      return false;
    }
    if (walk.seen.has(pid)) {
      cycles.push(pid);
      return false;
    }
    return true;
  };
  const build = ({ row, walk }: { row: ProcessRow; walk: Walk }): CmuxProcess => {
    walk.seen.add(row.pid);
    const children = tableChildren({ childrenOf, pid: row.pid })
      .filter((child) => fresh({ pid: child.pid, walk }))
      .map((child) => build({ row: child, walk }));
    return { children, name: rowName({ row }), pid: row.pid };
  };
  const withTable = ({ process, walk }: { process: CmuxProcess; walk: Walk }): CmuxProcess => {
    walk.seen.add(process.pid);
    const ownPids = new Set(process.children.map((child) => child.pid));
    const own = process.children
      .filter((child) => fresh({ pid: child.pid, walk }))
      .map((child) => withTable({ process: child, walk }));
    const more = tableChildren({ childrenOf, pid: process.pid })
      .filter((child) => !ownPids.has(child.pid) && fresh({ pid: child.pid, walk }))
      .map((child) => build({ row: child, walk }));
    const row = byPid.get(process.pid);
    return { children: [...own, ...more], name: row === undefined ? process.name : rowName({ row }), pid: process.pid };
  };
  return { build, cycles, withTable };
}

/**
 * The tab's tree with the tty processes cmux attributes to no tree grafted back in, from one process-table snapshot.
 *
 * Each tty pid with no tty pid, nor any pid cmux attributed, among its table ancestors is a root (a listed shell cmux also attributed under a `vim` was detached and rooted beside it); its
 * descendants are read off the table's parent column,
 * whatever cmux attributed them to, so the shell's own child (a `claude`, a `sleep`) sits UNDER the shell and the tab
 * reads as not at its prompt. An attributed root already placed under a grafted root is not repeated beside it, and
 * only once every process cmux reported under it was placed too (dropping the root wholesale
 * erased a child only cmux saw); one the table does not reach is kept as cmux gave it. A pid the table does not hold,
 * a listed tty pid or one cmux attributed, is REFUSED, never dropped: the two reads disagree about what the
 * tab runs, and a tab that cannot be read is never typed into. So is a pid the two reads name differently — a shell to
 * cmux and not one to the table, or the reverse — because a pid a shell held when cmux looked can belong to whatever
 * started next by the time `ps` answers, and that reuse would otherwise confirm a shell that is gone. A `claude` is `2.1.310` to cmux and a path to the table, so the comparison is never on the spelling: it is
 * on the CLASS the prompt verdict rests on — a shell, the `login` it may sit under, or any other program — because a
 * `login` cmux saw over a `vim` the table holds, or the reverse, would otherwise rebuild as the prompt shape — and two shells must be the SAME shell by bare name, a `bash` where cmux saw a `zsh` being a
 * reused pid too. An attributed process also GAINS every child the table shows
 * under it that cmux did not: the two reads are unioned, so a program either one sees under
 * the shell makes the tab not a prompt. A table listing one pid twice is refused outright: `ps` never prints one, so
 * a duplicate is a row the parser split wrongly, and which copy to believe is not knowable. So
 * is a reply in which cmux lists one tty pid twice, or attributes one pid twice: the `seen` walk below would drop the
 * repeat silently, and a repeat under the shell is a child the prompt verdict must see. So is a child cmux shows under one parent that the table shows under another: the graft reads parentage off
 * the table, so cmux's edge would be discarded, and a `login` cmux saw UNDER the shell rebuilt as the prompt shape,
 * and so is a root cmux shows beside another attributed process that the table puts UNDER it
 * (it would be placed under that process and kept as a root). Behind every
 * check above, a graft that would still place one pid twice is refused rather than returned. A pid both listed and
 * attributed is NOT a repeat: the attributed root is placed once under the grafted
 * tree, and every process cmux reported under it must be placed too (the r1 check below).
 * With nothing listed and nothing attributed the caller never consults the table — an empty tree reads `no-process`,
 * never cold — and the graft refuses the input rather than returning an empty forest, so no path through it ends in a
 * forest with no process. A parent CYCLE in the table (a pid whose ancestor chain returns to itself) is refused too: the walk ends at
 * the edge that would close it and the graft fails rather than returning the tree with that edge dropped, because a
 * cycle through a listed `login` would otherwise rebuild as `login → childless shell`, the prompt shape, and so is a cycle made
 * only of listed pids, which roots none of them (it returned an empty tree, never an
 * error). A real `ps` never prints one — every process has one parent and pid 1's is 0 — so the refusal costs a real
 * tab nothing. Every root of the forest must sit directly under the cmux APP in the table, and all under the SAME app
 * process: every tab's `login` measurably does, and one tab is
 * owned by one app, and that app's own ancestry through the table must end at a pid the table does not hold, never
 * return to itself, since the cycle walk covers only the forest and an app row that was its own parent rebuilt the
 * prompt shape (`appAncestryLoops`). Last, every root must sit on ONE real tty and every table row on that tty must be in the forest:
 * a process on the tab cmux neither attributed nor listed is otherwise a process no read
 * placed, and the typed line would reach it (`strayOnTabTty`).
 *
 * @param trees the roots cmux attributes to the tab's surfaces
 * @param ttyPids the surfaces' `unattributed_tty_process_pids`
 * @param rows the whole process table with each row's tty, read beside the tree
 * @returns the grafted roots first, then every attributed root the graft did not already place — or the tty pids the
 *   table does not hold, because a tree built from a table missing one of them could read as a bare shell where a
 *   foreground process is: the tolerant `parseProcessRows` drops a row it cannot decode and
 *   still answers, which is why the cold read decodes with `parseProcessRowsWhole` and refuses a line it cannot place,
 * and a process that exited between the two reads settles on the next poll, so the graft
 *   fails CLOSED
 */
export function graftTtyProcesses({
  trees,
  ttyPids,
  rows,
}: {
  trees: readonly CmuxProcess[];
  ttyPids: readonly number[];
  rows: readonly TtyProcessRow[];
}): Result<readonly CmuxProcess[], ColdGraftError> {
  if (trees.length === 0 && ttyPids.length === 0) {
    return err(ColdGraftErrors.nothingToGraft());
  }
  const agreed = agreedTable({ rows, trees, ttyPids });
  if (agreed.isErr()) {
    return err(agreed.error);
  }
  const byPid = agreed.value;
  const { build, cycles, withTable } = treeBuilders({ byPid, childrenOf: childrenIndex({ rows }) });
  // A listed pid under a listed OR attributed ancestor is placed under it, never rooted beside it (a listed shell cmux also attributed under a `vim` was detached from it and rooted).
  const reported = new Set([...ttyPids, ...flattenProcessTreePids({ roots: trees })]);
  const none: ReadonlySet<number> = new Set<number>();
  const grafted = ttyPids
    .flatMap((pid) => {
      const row = byPid.get(pid);
      return row === undefined || ancestorIn({ byPid, pid, ppid: row.ppid, set: reported }) !== undefined ? [] : [row];
    })
    .map((row) => build({ row, walk: { placed: none, seen: new Set<number>() } }));
  const placed = new Set(flattenProcessTreePids({ roots: grafted }));
  const unplacedUnderPlacedRoot = trees
    .filter((root) => placed.has(root.pid))
    .flatMap((root) => flattenProcessTreePids({ roots: [root] }).filter((pid) => !placed.has(pid)));
  if (unplacedUnderPlacedRoot.length > 0) {
    return err(ColdGraftErrors.attributedMissing({ pids: unplacedUnderPlacedRoot }));
  }
  const kept = trees
    .filter((root) => !placed.has(root.pid))
    .map((root) => withTable({ process: root, walk: { placed, seen: new Set<number>() } }));
  if (cycles.length > 0) {
    return err(ColdGraftErrors.tableLoops({ pids: cycles }));
  }
  const roots = [...grafted, ...kept];
  const disagreement = forestDisagreement({ byPid, roots, rows, ttyPids });
  return disagreement === undefined ? ok(roots) : err(disagreement);
}

/**
 * What is wrong with the forest the graft would return, checked once it is whole: a pid placed twice, a listed pid
 * placed nowhere (a cycle made only of listed pids), a root the table puts under anything but the cmux app, roots
 * split across two app processes, an app whose own ancestry loops, or a process on the tab's tty the forest does not
 * hold.
 *
 * @param roots the forest the graft would return
 * @param ttyPids the surfaces' `unattributed_tty_process_pids`
 * @param rows the whole process table
 * @param byPid the table by pid
 * @returns the refusal, or `undefined` when the forest holds
 */
function forestDisagreement({
  roots,
  ttyPids,
  rows,
  byPid,
}: {
  roots: readonly CmuxProcess[];
  ttyPids: readonly number[];
  rows: readonly TtyProcessRow[];
  byPid: ReadonlyMap<number, TtyProcessRow>;
}): ColdGraftError | undefined {
  const rootedPids = flattenProcessTreePids({ roots });
  const twice = repeatedPid({ pids: rootedPids });
  if (twice !== undefined) {
    return ColdGraftErrors.placedTwice({ pid: twice });
  }
  const everyPlaced = new Set(rootedPids);
  const unrooted = ttyPids.filter((pid) => !everyPlaced.has(pid));
  if (unrooted.length > 0) {
    return ColdGraftErrors.listedUnrooted({ pids: unrooted });
  }
  const unowned = rootNotUnderCmuxApp({ byPid, roots });
  if (unowned !== undefined) {
    return ColdGraftErrors.rootNotUnderApp(unowned);
  }
  const split = rootsUnderTwoApps({ byPid, roots });
  if (split !== undefined) {
    return ColdGraftErrors.rootsUnderTwoApps(split);
  }
  const loop = appAncestryLoops({ byPid, roots });
  if (loop.length > 0) {
    return ColdGraftErrors.tableLoops({ pids: loop });
  }
  return strayOnTabTty({ byPid, roots, rows });
}

/**
 * The pids the table's parent links loop through ABOVE the tab's forest, walked up from the cmux app row the roots
 * sit under: the cycle walk below covers only the forest, so an app row that is its own parent, or whose ancestor
 * chain returns to it, was a table that loops and still rebuilt the prompt shape. A real table never loops: pid 1's parent is 0, which is no row, so the walk from the app ends there.
 *
 * @param roots the forest the graft would return, every root already known to sit under one cmux app row
 * @param byPid the table by pid
 * @returns the pids on the loop in walk order, or an empty list when the app's ancestry ends at a pid the table does not hold
 */
function appAncestryLoops({
  roots,
  byPid,
}: {
  roots: readonly CmuxProcess[];
  byPid: ReadonlyMap<number, ProcessRow>;
}): readonly number[] {
  const [root] = roots;
  const rootRow = root === undefined ? undefined : byPid.get(root.pid);
  if (rootRow === undefined) {
    return [];
  }
  const walked: number[] = [];
  let pid: number | undefined = rootRow.ppid;
  while (pid !== undefined) {
    if (walked.includes(pid)) {
      return walked.slice(walked.indexOf(pid));
    }
    walked.push(pid);
    pid = byPid.get(pid)?.ppid;
  }
  return [];
}

/**
 * Two cmux app pids the forest's roots sit under, when they do not all share one (two roots, each under its own `cmux` row, passed because each parent LOOKED like the app). One tab is owned
 * by one app process, so a forest spanning two is two tabs' processes, or a stale row, never one tab.
 *
 * @param roots the forest the graft would return, every root already known to sit under a cmux app row
 * @param byPid the table by pid
 * @returns the first two distinct app pids, or `undefined` when every root shares one
 */
function rootsUnderTwoApps({
  roots,
  byPid,
}: {
  roots: readonly CmuxProcess[];
  byPid: ReadonlyMap<number, ProcessRow>;
}): { readonly first: number; readonly second: number } | undefined {
  const parents = roots.flatMap((root) => {
    const row = byPid.get(root.pid);
    return row === undefined ? [] : [row.ppid];
  });
  const [first] = parents;
  const second = parents.find((pid) => pid !== first);
  return first === undefined || second === undefined ? undefined : { first, second };
}

/**
 * The first root of the tab's forest whose table parent is not the cmux APP (a
 * shell cmux attributed as a lone root, the table under a `vim` cmux neither listed nor attributed, rebuilt as the
 * prompt shape). Every process a tab runs descends from the app through the tab's `login` — MEASURED on
 * cmux 0.65.2, every `login` under pid 60470, `/Applications/cmux.app/Contents/MacOS/cmux` — so a root under anything
 * else is a root the two reads disagree about.
 *
 * @param roots the forest the graft would return
 * @param byPid the table by pid, every root already known to be present
 * @returns the root and its table parent, or `undefined` when every root is the app's child
 */
function rootNotUnderCmuxApp({
  roots,
  byPid,
}: {
  roots: readonly CmuxProcess[];
  byPid: ReadonlyMap<number, ProcessRow>;
}): { readonly root: number; readonly tableParent: number } | undefined {
  for (const root of roots) {
    const row = byPid.get(root.pid);
    if (row === undefined) {
      continue;
    }
    const parent = byPid.get(row.ppid);
    if (parent === undefined || !isCmuxAppCommand({ command: parent.argv })) {
      return { root: root.pid, tableParent: row.ppid };
    }
  }
  return undefined;
}
