/**
 * Whether the two reads of a reopened tab — cmux's `system.top` reply and the process table read beside it — AGREE
 * before `./coldGraft.ts` rebuilds the tab's tree from them. Every disagreement is refused, never resolved: the reasons
 * are the graft's doc. Pure.
 */
import type { CmuxProcess } from "../cmux/client.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  flattenProcessTreePids,
  isTtyName,
  NO_TTY,
  type ProcessRow,
  RUNNING_STATE,
  STOPPED_STATE,
  type TtyProcessRow,
  ZOMBIE_STATE,
} from "../live/standing/processes.js";
import { type ColdGraftError, ColdGraftErrors } from "./coldGraftErrors.js";
import {
  bareName,
  isInteractiveShellArgv,
  isSystemLoginArgv,
  isSystemShellPath,
  processClass,
} from "./coldProcessClass.js";

/** What a process-table row with no argv at all is named in a grafted tree; `ps` never prints one, so it is a guard. */
const UNNAMED_ROW = "(unnamed)";

/**
 * A process-table row's name the way cmux names a process: its argv's first word (`-/bin/zsh`, `/usr/bin/login`).
 *
 * @param row the table row
 * @returns its name
 */
export function rowName({ row }: { row: ProcessRow }): string {
  const [first] = row.argv.split(/\s+/u);
  return first === undefined || first.length === 0 ? UNNAMED_ROW : first;
}

/**
 * The first pid that appears in `pids` more than once, or `undefined` when each appears once.
 *
 * @param pids the pids, in order
 * @returns the first repeat
 */
export function repeatedPid({ pids }: { pids: readonly number[] }): number | undefined {
  return pids.find((pid, index) => pids.indexOf(pid) !== index);
}

/** One parent → child edge cmux reported that the table's parent column contradicts. */
type DisagreeingEdge = { readonly parent: number; readonly child: number; readonly tableParent: number };

/**
 * The first edge in cmux's trees whose child the table places under a different parent (cmux
 * showing the `login` UNDER the shell while the table shows the shell under the `login` rebuilt as the prompt shape,
 * the child cmux reported discarded). A root has no cmux parent and is not checked here.
 *
 * @param trees the roots cmux attributes to the tab
 * @param byPid the table by pid, every attributed pid already known to be present
 * @returns the first disagreement, or `undefined` when every edge agrees
 */
function disagreeingEdge({
  trees,
  byPid,
}: {
  trees: readonly CmuxProcess[];
  byPid: ReadonlyMap<number, ProcessRow>;
}): DisagreeingEdge | undefined {
  for (const parent of flattenProcesses({ roots: trees })) {
    for (const child of parent.children) {
      const row = byPid.get(child.pid);
      if (row !== undefined && row.ppid !== parent.pid) {
        return { child: child.pid, parent: parent.pid, tableParent: row.ppid };
      }
    }
  }
  return undefined;
}

/**
 * The first root cmux attributes to the tab that the table places under ANOTHER process cmux attributed, however many
 * rows between (a `vim` cmux showed beside the shell, the table under it, was
 * placed under the shell AND kept as a root). A root under a LISTED pid is the 0.65.2 shape and is placed once by the
 * graft, so it is not this.
 *
 * @param trees the roots cmux attributes to the tab
 * @param byPid the table by pid, every attributed pid already known to be present
 * @returns the root and the attributed pid the table puts over it, or `undefined`
 */
function nestedRoot({
  trees,
  byPid,
}: {
  trees: readonly CmuxProcess[];
  byPid: ReadonlyMap<number, ProcessRow>;
}): { readonly root: number; readonly tableParent: number } | undefined {
  const attributed = new Set(flattenProcessTreePids({ roots: trees }));
  for (const root of trees) {
    const row = byPid.get(root.pid);
    const over = row === undefined ? undefined : ancestorIn({ byPid, pid: root.pid, ppid: row.ppid, set: attributed });
    if (over !== undefined) {
      return { root: root.pid, tableParent: over };
    }
  }
  return undefined;
}

/**
 * Whether the name cmux reports for a pid and the name the table holds for it are one process. The comparison is on
 * CLASS, never spelling — a `claude` is `2.1.310` to cmux and a path to the table — except that two SHELLS must be the
 * same shell by bare name: a `bash` where cmux saw a `zsh` is a pid handed to another shell between the two reads, and
 * the class alone confirmed it. A `login` is one class with one name.
 *
 * @param reported the name cmux reports
 * @param tabled the name the table holds, `rowName`
 * @returns `true` when the two reads agree
 */
function sameProcess({ reported, tabled }: { reported: string; tabled: string }): boolean {
  const reportedClass = processClass({ name: reported });
  if (reportedClass !== processClass({ name: tabled })) {
    return false;
  }
  return reportedClass !== "shell" || bareName({ name: reported }) === bareName({ name: tabled });
}

/**
 * Every process in the trees, roots and descendants, in pre-order.
 *
 * @param roots the trees
 * @returns every process
 */
function flattenProcesses({ roots }: { roots: readonly CmuxProcess[] }): readonly CmuxProcess[] {
  return roots.flatMap((root) => [root, ...flattenProcesses({ roots: root.children })]);
}

/**
 * The process table by pid, once it agrees with what cmux reported for the tab: each pid listed once by either read,
 * every listed or attributed pid present, every attributed pid in the same process class in both reads, and every
 * attributed child under the same parent in both. The reasons each disagreement is refused rather than resolved are
 * `./coldGraft.ts`'s `graftTtyProcesses` doc.
 *
 * @param rows the whole process table
 * @param trees the roots cmux attributes to the tab
 * @param ttyPids the surfaces' `unattributed_tty_process_pids`
 * @returns the rows by pid, or why the two reads cannot be reconciled
 */
export function agreedTable({
  rows,
  trees,
  ttyPids,
}: {
  rows: readonly TtyProcessRow[];
  trees: readonly CmuxProcess[];
  ttyPids: readonly number[];
}): Result<ReadonlyMap<number, TtyProcessRow>, ColdGraftError> {
  const byPid = new Map<number, TtyProcessRow>();
  for (const row of rows) {
    if (byPid.has(row.pid)) {
      return err(ColdGraftErrors.tableListsTwice({ pid: row.pid }));
    }
    byPid.set(row.pid, row);
  }
  const listedTwice = repeatedPid({ pids: ttyPids });
  if (listedTwice !== undefined) {
    return err(ColdGraftErrors.ttyPidListedTwice({ pid: listedTwice }));
  }
  const attributedPids = flattenProcessTreePids({ roots: trees });
  const attributedTwice = repeatedPid({ pids: attributedPids });
  if (attributedTwice !== undefined) {
    return err(ColdGraftErrors.attributedTwice({ pid: attributedTwice }));
  }
  const missing = ttyPids.filter((pid) => !byPid.has(pid));
  if (missing.length > 0) {
    return err(ColdGraftErrors.ttyPidsMissing({ pids: missing }));
  }
  const attributedMissing = attributedPids.filter((pid) => !byPid.has(pid));
  if (attributedMissing.length > 0) {
    return err(ColdGraftErrors.attributedMissing({ pids: attributedMissing }));
  }
  const reused = flattenProcesses({ roots: trees }).find((process) => {
    const row = byPid.get(process.pid);
    return row !== undefined && !sameProcess({ reported: process.name, tabled: rowName({ row }) });
  });
  if (reused !== undefined) {
    const row = byPid.get(reused.pid);
    return err(
      ColdGraftErrors.pidRenamed({
        pid: reused.pid,
        reported: reused.name,
        tabled: row === undefined ? UNNAMED_ROW : rowName({ row }),
      }),
    );
  }
  const edge = disagreeingEdge({ byPid, trees });
  if (edge !== undefined) {
    return err(ColdGraftErrors.edgeDisagrees(edge));
  }
  const nested = nestedRoot({ byPid, trees });
  if (nested !== undefined) {
    return err(ColdGraftErrors.rootNested(nested));
  }
  return ok(byPid);
}

/**
 * A process on the tab's TTY that the forest does not hold — one cmux neither attributed nor listed, which the graft
 * would otherwise never see (a `vim` under the cmux app beside the reported
 * shell, on the same tab, approved the childless shell). The tty is the one tab membership `ps` carries: every root
 * of the forest must sit on one real tty, MEASURED on cmux 0.65.2 as each tab's own `ttys00N` with the
 * app itself on none, and every table row on that tty must already be in the forest. A root on no tty, or roots on
 * two, is refused the same way, and so is a root whose tty token is not a `ttys<N>` name ({@link isTtyName}), since
 * the decoder takes any non-empty token as a tty and a misread row is no tab. A descendant on NO tty under a PROGRAM — a `claude`'s pipe-driven shells measurably
 * sit on none — is placed off the parent column as before; a descendant on ANOTHER real tty, or on none under a shell
 * or `login`, is refused, since what it runs the tab's tty never reads, and a stopped shell cmux listed on another
 * tty slipped every check keyed on the root's tty. So every member of a
 * prompt-shaped forest is on the tab's tty, and the rest of the checks run over the rows on it (`forestOnTabTty`): a
 * process a signal STOPPED (`stat` starting {@link STOPPED_STATE}) or that has EXITED unreaped
 * ({@link ZOMBIE_STATE}) is refused, since a `SIGSTOP`ped childless shell shows every shape a prompt shows and reads
 * nothing until `SIGCONT`, so a line typed at it would queue, and a zombie one reads nothing ever. The state is the one column that tells those apart, which is
 * why the whole read carries it. Then a childless shell spelled off the system shell path, or started on a
 * script rather than as an interactive shell, is refused off its argv (`scriptedShellOnTabTty`). Last of all, a
 * childless interactive shell on the CPU ({@link RUNNING_STATE}) is refused (`busyShellOnTabTty`): a shell at its
 * prompt sleeps in its line editor, and one spinning in a builtin loop installed as a `precmd` hook shows every
 * other column a prompt shows while a typed line queues behind it.
 *
 * @param roots the forest the graft would return, every root already known to be in the table
 * @param rows the whole process table
 * @param byPid the table by pid
 * @returns the refusal, or `undefined` when nothing else sits on the tab's tty and nothing on it is stopped
 */
export function strayOnTabTty({
  roots,
  rows,
  byPid,
}: {
  roots: readonly CmuxProcess[];
  rows: readonly TtyProcessRow[];
  byPid: ReadonlyMap<number, TtyProcessRow>;
}): ColdGraftError | undefined {
  const rooted = roots.flatMap((root) => {
    const row = byPid.get(root.pid);
    return row === undefined ? [] : [row];
  });
  const untethered = rooted.find((row) => row.tty === NO_TTY);
  if (untethered !== undefined) {
    return ColdGraftErrors.rootOnNoTty({ pid: untethered.pid });
  }
  const [first] = rooted;
  if (first === undefined) {
    return undefined;
  }
  // A token that is not `ttys<N>` names no device: the decoder takes any non-empty fourth field as the tty, and a
  // row misread that way was accepted as a tab.
  if (!isTtyName({ tty: first.tty })) {
    return ColdGraftErrors.rootOnUnrealTty({ pid: first.pid, tty: first.tty });
  }
  const second = rooted.find((row) => row.tty !== first.tty);
  if (second !== undefined) {
    return ColdGraftErrors.rootsOnTwoTtys({ first: first.tty, second: second.tty });
  }
  const placed = new Set(flattenProcessTreePids({ roots }));
  const stray = rows.find((row) => row.tty === first.tty && !placed.has(row.pid));
  if (stray !== undefined) {
    return ColdGraftErrors.strayOnTty({ name: rowName({ row: stray }), pid: stray.pid, tty: first.tty });
  }
  return forestOnTabTty({ byPid, placed, rows, tty: first.tty });
}

/**
 * The checks once the roots are known to sit on one tty and nothing on it is outside the forest: a forest member on
 * another real tty, or on none under a shell or `login`, then over the rows on the tab's tty a stopped or zombie
 * process, then a childless shell off the system path or started on a script.
 *
 * @param placed the pids of the forest
 * @param rows the whole process table
 * @param byPid the table by pid
 * @param tty the tab's tty
 * @returns the refusal, or `undefined` when every forest member is on the tab's tty or piped under a program, and every row on the tty is neither stopped nor exited, at a prompt shape, and asleep
 */
function forestOnTabTty({
  placed,
  rows,
  byPid,
  tty,
}: {
  placed: ReadonlySet<number>;
  rows: readonly TtyProcessRow[];
  byPid: ReadonlyMap<number, TtyProcessRow>;
  tty: string;
}): ColdGraftError | undefined {
  const elsewhere = rows.find(
    (row) => placed.has(row.pid) && row.tty !== tty && !(row.tty === NO_TTY && isUnderProgram({ byPid, row })),
  );
  if (elsewhere !== undefined) {
    return ColdGraftErrors.placedOnOtherTty({ pid: elsewhere.pid, tabTty: tty, tty: elsewhere.tty });
  }
  const stopped = rows.find(
    (row) => row.tty === tty && (row.state.startsWith(STOPPED_STATE) || row.state.startsWith(ZOMBIE_STATE)),
  );
  if (stopped !== undefined) {
    return ColdGraftErrors.stoppedOnTty({
      name: rowName({ row: stopped }),
      pid: stopped.pid,
      state: stopped.state,
      tty,
    });
  }
  const scripted = scriptedShellOnTabTty({ rows, tty });
  if (scripted !== undefined) {
    return scripted;
  }
  return busyShellOnTabTty({ rows, tty });
}

/**
 * A childless shell on the tab's tty that is on the CPU ({@link RUNNING_STATE}). A shell at its prompt sleeps in its
 * line editor — MEASURED, ten bare shells sampled `S`, `SN` or `S+` — so a childless shell sampled
 * running is executing a builtin loop that forked nothing (`spin() { while :; do :; done; }` installed as a `precmd`
 * hook), and every other column shows the prompt shape while a typed line queues behind it. The shell is read off BOTH table reads, so a prompt shell that happened to be redrawing at one sample is
 * refused once and read again on the next poll.
 *
 * @param rows the whole process table
 * @param tty the tab's tty
 * @returns the refusal, or `undefined` when every childless shell on the tty is asleep
 */
function busyShellOnTabTty({ rows, tty }: { rows: readonly TtyProcessRow[]; tty: string }): ColdGraftError | undefined {
  const parents = new Set(rows.map((row) => row.ppid));
  const busy = rows.find(
    (row) =>
      row.tty === tty &&
      !parents.has(row.pid) &&
      processClass({ name: rowName({ row }) }) === "shell" &&
      row.state.startsWith(RUNNING_STATE),
  );
  if (busy === undefined) {
    return undefined;
  }
  return ColdGraftErrors.shellBusyOnTty({ name: rowName({ row: busy }), pid: busy.pid, state: busy.state, tty });
}

/**
 * Whether a row's parent, in the table, is a program rather than a shell or `login`. A forest member on no tty is
 * placed only under one: a `claude`'s pipe-driven `zsh -c` children measurably sit on none, while a shell's or a
 * login's child on none is a tab member the tty's reader never reaches, and a parent the table does not hold is
 * refused the same way.
 *
 * @param byPid the table by pid
 * @param row the row
 * @returns `true` when the parent row is in the table and is a program
 */
function isUnderProgram({ byPid, row }: { byPid: ReadonlyMap<number, TtyProcessRow>; row: TtyProcessRow }): boolean {
  const parent = byPid.get(row.ppid);
  return parent !== undefined && processClass({ name: rowName({ row: parent }) }) === "program";
}

/**
 * A childless shell on the tab's tty whose command line is not an interactive shell's
 * ({@link isInteractiveShellArgv}): one reading a script or a `-c` string forks nothing while it waits on them, so both
 * reads show the childless shell a prompt shows, and the argv is the one column that says it is at no prompt (`exec /bin/zsh /tmp/commands.fifo` with no writer). One spelled by bare name
 * or by a path outside the system shell directories ({@link isSystemShellPath}) is refused first: a program at
 * `/tmp/zsh` is a shell to every name-only check, and a `login` on the tty is refused
 * unless it is `/usr/bin/login` ({@link isSystemLoginArgv}), since a program at `/tmp/login` that forks a real shell
 * and keeps reading the tty is a `login` to every name-only check too. A shell WITH a
 * child is not this check's subject — its child already makes the tab not a prompt — and a `claude`'s pipe-driven
 * `zsh -c` children measurably sit on no tty.
 *
 * @param rows the whole process table
 * @param tty the tab's tty
 * @returns the refusal, or `undefined` when every `login` on the tty is the system one and every childless shell on it was started as an interactive one
 */
function scriptedShellOnTabTty({
  rows,
  tty,
}: {
  rows: readonly TtyProcessRow[];
  tty: string;
}): ColdGraftError | undefined {
  const login = rows.find(
    (row) =>
      row.tty === tty && processClass({ name: rowName({ row }) }) === "login" && !isSystemLoginArgv({ argv: row.argv }),
  );
  if (login !== undefined) {
    return ColdGraftErrors.loginOffSystemPath({ argv: login.argv, pid: login.pid, tty });
  }
  const parents = new Set(rows.map((row) => row.ppid));
  const shell = rows.find(
    (row) =>
      row.tty === tty &&
      !parents.has(row.pid) &&
      processClass({ name: rowName({ row }) }) === "shell" &&
      !isInteractiveShellArgv({ argv: row.argv }),
  );
  if (shell === undefined) {
    return undefined;
  }
  const [name = ""] = shell.argv.trim().split(/\s+/u);
  return isSystemShellPath({ word: name })
    ? ColdGraftErrors.shellRunsScript({ argv: shell.argv, pid: shell.pid, tty })
    : ColdGraftErrors.shellOffSystemPath({ argv: shell.argv, pid: shell.pid, tty });
}

/**
 * The first pid in `set` on a pid's ancestor chain through the table, however many rows between. A listed pid under
 * another listed pid is grafted UNDER it and never rooted beside it (two listed pids with a table
 * row between them each became a root, and the lower one was placed twice). The chain stops at a pid the table does
 * not hold, one it already passed, or the pid itself — a chain that returns to it is a cycle, which the walk from that
 * root then refuses.
 *
 * @param pid the pid whose ancestors to walk
 * @param ppid its parent in the table
 * @param byPid the table by pid
 * @param set the pids looked for
 * @returns the first ancestor in `set`, or `undefined`
 */
export function ancestorIn({
  pid,
  ppid,
  byPid,
  set,
}: {
  pid: number;
  ppid: number;
  byPid: ReadonlyMap<number, ProcessRow>;
  set: ReadonlySet<number>;
}): number | undefined {
  const passed = new Set<number>();
  let cursor = ppid;
  while (cursor !== pid && !passed.has(cursor)) {
    if (set.has(cursor)) {
      return cursor;
    }
    passed.add(cursor);
    const row = byPid.get(cursor);
    if (row === undefined) {
      return undefined;
    }
    cursor = row.ppid;
  }
  return undefined;
}
