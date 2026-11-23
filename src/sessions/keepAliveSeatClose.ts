/**
 * When a retired supervisor chair may be force-closed although its footer still counts a background shell: that
 * shell is the credential keep-alive (`claude watch`) the chair started at boot, and another watch outside the chair
 * keeps the stores alive once this one dies with its seat.
 *
 * MEASURED: four `/slopweaver:supervisor` workspaces were open at once where the owner expects one, or two
 * during a hand-off. Every chair runs `claude watch --wait` inside its own seat
 * (`skills/supervisor/reference/standing-sessions.md` § "The keep-alive dies with its seat"), and the design is that
 * the takeover's close kills the predecessor's watch while the successor's queued `--wait` watch takes over within
 * 15 seconds. But `judgeScreen` reads the footer's `1 shell` as `busy`, so `session close-done` held the retired
 * chairs every tick (one holding the LIVE watch, the next one a queued watch) and
 * they never closed. Reproduce: `slopweaver cmux processes --workspace <retired chair> --json` shows the watch's
 * node under the chair's own `claude`, and `slopweaver session standing --json` lists it in `keepAlive`.
 *
 * Pure: the screen, the seat's cmux process tree and one whole process-table read are read by the caller. What the
 * seat's shells run is `./keepAliveWatchShells.ts`.
 */
import { backgroundWorkOf } from "../cmux/backgroundWork.js";
import type { CmuxProcess } from "../cmux/client.js";
import { screenShowsQueuedMessage, screenShowsRunningTurn } from "../cmux/turnBusy.js";
import { claudeComposerAtBottom } from "../cmux/turnState.js";
import type { Result } from "../lib/result.js";
import { flattenProcessTreePids, standingWatchProcesses, type TtyProcessRow } from "../live/standing/processes.js";
import type { ProcessTableError } from "../live/standing/processTableErrors.js";
import { commandName } from "./keepAliveShellCommand.js";
import { type ShellFault, tableDescendants, watchShells } from "./keepAliveWatchShells.js";

/** One whole process-table read, each row with its state — `readProcessTableWhole`'s answer. */
export type WatchTable = Result<readonly TtyProcessRow[], ProcessTableError>;

/** Why a seat holding background work may not be force-closed as a keep-alive-only seat. */
type KeepAliveHoldReason =
  | "screen-unreadable"
  | "not-at-rest"
  | "no-background-shell"
  | "monitor-running"
  | "tree-unreadable"
  | "snapshot-unreadable"
  | "root-not-claude"
  | "other-background-shell"
  | "watch-shell-shared"
  | "watch-shell-awake"
  | "watch-shell-command"
  | "cover-retiring"
  | "sole-keep-alive";

/**
 * Whether a process can run: `ps` prints `T` for one stopped by a signal and `Z` for a zombie, and neither keeps a
 * store alive. A SIGSTOPed watch matched by its argv alone is not cover.
 */
function runnable({ state }: { state: string }): boolean {
  return !/^[TZ]/u.test(state);
}

/** Whether a keep-alive-only seat may take force, and why not when it may not. */
export type KeepAliveCloseDecision =
  | { readonly kind: "force"; readonly seatWatchPids: readonly number[]; readonly coverPids: readonly number[] }
  | { readonly kind: "held"; readonly reason: KeepAliveHoldReason; readonly detail: string };

type HeldDecision = Extract<KeepAliveCloseDecision, { readonly kind: "held" }>;

/**
 * Whether a process-table row is Claude Code itself: its executable is `claude` (`~/.local/bin/claude --session-id …`,
 * as `ps -o args= -p <seat's claude>` prints it) or `node` running the npm package's own entry point,
 * `…/node_modules/@anthropic-ai/claude-code/cli.js`. cmux names the node by its title, the version (`2.1.318`), so only
 * the row can say. A shell under any root does not count, and neither does any script under a directory
 * of that name. Argv names a program and never authenticates one, so this is identification only.
 */
function isClaudeRow({ argv }: { argv: string }): boolean {
  if (commandName({ argv }) === "claude") {
    return true;
  }
  const script = argv.split(" ")[1];
  return (
    commandName({ argv }) === "node" && script?.endsWith("/node_modules/@anthropic-ai/claude-code/cli.js") === true
  );
}

/** Whether `pid`, or any ancestor the table's parent links reach from it, is retiring. */
function withinRetiring({
  parentOf,
  pid,
  retiring,
}: {
  parentOf: ReadonlyMap<number, number>;
  pid: number;
  retiring: ReadonlySet<number>;
}): boolean {
  const visited = new Set<number>();
  for (let at: number | undefined = pid; at !== undefined && !visited.has(at); at = parentOf.get(at)) {
    if (retiring.has(at)) {
      return true;
    }
    visited.add(at);
  }
  return false;
}

/**
 * Every pid a seat holds: the pids its cmux tree showed, and everything the process table places under one of them. A
 * tree can list a watch's launcher and not its loop, or miss a watch started under the seat's own one, while the
 * table, read after, shows both — and both die with the seat.
 *
 * @param treePids every pid the seat's cmux tree reads showed
 * @param rows one whole read of the process table
 * @returns the pids
 */
export function seatPids({
  treePids,
  rows,
}: {
  treePids: Iterable<number>;
  rows: readonly TtyProcessRow[];
}): ReadonlySet<number> {
  const roots = new Set(treePids);
  const pids = new Set(roots);
  for (const pid of roots) {
    for (const below of tableDescendants({ pid, rows })) {
      pids.add(below.pid);
    }
  }
  return pids;
}

/** One held decision, its detail spelled once. */
function held({ reason, detail }: { reason: KeepAliveHoldReason; detail: string }): HeldDecision {
  return { detail, kind: "held", reason };
}

/**
 * The shells the screen counts, or why the screen alone refuses: unreadable, a turn or a queued line, no host's
 * prompt at the bottom, no shell counted, or a Monitor running.
 */
function screenShells({ screen }: { screen: string | undefined }): number | HeldDecision {
  if (screen === undefined) {
    return held({ detail: "its screen could not be read", reason: "screen-unreadable" });
  }
  const atRest =
    !screenShowsQueuedMessage({ screen }) && !screenShowsRunningTurn({ screen }) && claudeComposerAtBottom({ screen });
  if (!atRest) {
    return held({ detail: "its screen does not prove the session at rest", reason: "not-at-rest" });
  }
  const work = backgroundWorkOf({ host: "claude-code", screen });
  if (work === undefined || work.shells === 0) {
    return held({ detail: "its footer counts no background shell", reason: "no-background-shell" });
  }
  if (work.monitors > 0) {
    return held({ detail: `its footer counts ${String(work.monitors)} Monitor(s)`, reason: "monitor-running" });
  }
  return work.shells;
}

/** The table's rows when the tree and table both read and every tree root is the seat's own claude, else why not. */
function readRows({
  table,
  tree,
}: {
  table: WatchTable;
  tree: readonly CmuxProcess[] | undefined;
}): { readonly rows: readonly TtyProcessRow[]; readonly tree: readonly CmuxProcess[] } | HeldDecision {
  if (tree === undefined || tree.length === 0) {
    return held({ detail: "cmux attributed no process tree to it", reason: "tree-unreadable" });
  }
  if (table.isErr()) {
    return held({ detail: `the process table did not read: ${table.error.message}`, reason: "snapshot-unreadable" });
  }
  const argvOf = new Map(table.value.map((row) => [row.pid, row.argv]));
  const foreign = tree.find((root) => {
    const argv = argvOf.get(root.pid);
    return argv === undefined || !isClaudeRow({ argv });
  });
  if (foreign !== undefined) {
    return held({
      detail: `its tree's root pid ${String(foreign.pid)} (${foreign.name}) is not its own claude`,
      reason: "root-not-claude",
    });
  }
  return { rows: table.value, tree };
}

/** The held decision one shell fault earns. */
function faultHeld({ fault }: { fault: ShellFault }): HeldDecision {
  switch (fault.kind) {
    case "stranger":
      return held({
        detail: `its keep-alive's shell also runs pid ${String(fault.pid)} (${fault.name})`,
        reason: "watch-shell-shared",
      });
    case "awake": {
      const shown = fault.state === undefined ? "is missing from the process table" : `reads ${fault.state}`;
      return held({
        detail: `its keep-alive's shell (pid ${String(fault.pid)}) ${shown}, not asleep on its watch`,
        reason: "watch-shell-awake",
      });
    }
    case "command":
      return held({
        detail: `its keep-alive's shell (pid ${String(fault.pid)}) runs something other than \`slopweaver claude watch\` and admitted read-only filters`,
        reason: "watch-shell-command",
      });
    default: {
      const unreachable: never = fault;
      return unreachable;
    }
  }
}

/** The seat's own watches, and the runnable ones outside it that no retiring seat holds. */
function watchesOf({
  retiring,
  rows,
  tree,
}: {
  retiring: ReadonlySet<number>;
  rows: readonly TtyProcessRow[];
  tree: readonly CmuxProcess[];
}): { readonly seatWatchPids: readonly number[]; readonly outside: readonly number[]; readonly cover: number[] } {
  const inTree = seatPids({ rows, treePids: flattenProcessTreePids({ roots: tree }) });
  const stateOf = new Map(rows.map((row) => [row.pid, row.state]));
  const watches = standingWatchProcesses({ processes: rows });
  const seatWatchPids = watches.filter((watch) => inTree.has(watch.pid)).map((watch) => watch.pid);
  const outside = watches
    .filter((watch) => !inTree.has(watch.pid) && runnable({ state: stateOf.get(watch.pid)! }))
    .map((watch) => watch.pid);
  // A watch dies with a retiring seat when it or any process above it is in one: a tree may list a watch's launcher
  // and not its loop, which the table still places under it.
  const parentOf = new Map(rows.map((row) => [row.pid, row.ppid]));
  const cover = outside.filter((pid) => !withinRetiring({ parentOf, pid, retiring }));
  return { cover, outside, seatWatchPids };
}

/**
 * Decide whether a seat whose only background work is the keep-alive may be force-closed.
 *
 * `force` needs ALL of: a screen at rest with no turn or queued line; a footer counting no Monitor and at least one
 * shell; exactly as many shells under the seat's `claude` as the footer counts, every one hosting a seat watch and
 * running nothing but that watch, its launcher, what it started and the read-only filters its own command pipes it
 * through, asleep, that command the keep-alive (`./keepAliveShellCommand.ts`); and
 * at least one standing watch OUTSIDE the seat — running or queued with `--wait`, not stopped, and in
 * no seat the caller is closing in the same pass — which takes over once this seat's dies. Anything less holds,
 * naming which: a guess here kills work, or the last keep-alive.
 *
 * @param screen the seat's rendered screen, or `undefined` when it could not be read
 * @param tree the process tree cmux attributes to the seat, or `undefined` when it could not be read
 * @param table one whole read of the process table, taken just now, each row with its state
 * @param retiring every pid inside a seat the caller has already closed, or reported closed, in this same pass — a
 *   watch dying with that seat, or one a dry run only pretended to close, is no cover
 * @returns `force` with the seat's watch pids and the ones covering for them, or `held` with why
 */
export function keepAliveOnlyCloseDecision({
  retiring,
  screen,
  table,
  tree,
}: {
  retiring: ReadonlySet<number>;
  screen: string | undefined;
  table: WatchTable;
  tree: readonly CmuxProcess[] | undefined;
}): KeepAliveCloseDecision {
  const shells = screenShells({ screen });
  if (typeof shells !== "number") {
    return shells;
  }
  const read = readRows({ table, tree });
  if ("kind" in read) {
    return read;
  }
  const { cover, outside, seatWatchPids } = watchesOf({ retiring, rows: read.rows, tree: read.tree });
  const found = watchShells({ rows: read.rows, seatWatchPids, tree: read.tree });
  if (found.hosting !== shells || found.shells !== shells) {
    return held({
      detail: `its footer counts ${String(shells)} shell(s); its tree holds ${String(found.shells)}, ${String(found.hosting)} of them running a keep-alive`,
      reason: "other-background-shell",
    });
  }
  if (found.fault !== undefined) {
    return faultHeld({ fault: found.fault });
  }
  if (cover.length === 0 && outside.length !== 0) {
    return held({
      detail: `its only cover (pid ${outside.join(", pid ")}) sits in a seat this pass closed; the next pass re-reads`,
      reason: "cover-retiring",
    });
  }
  if (cover.length === 0) {
    return held({
      detail: `it holds the only keep-alive (pid ${seatWatchPids.join(", pid ")}); start one elsewhere with \`claude watch --wait\` first`,
      reason: "sole-keep-alive",
    });
  }
  return { coverPids: cover, kind: "force", seatWatchPids };
}

/**
 * One line naming what a forced keep-alive close retires and what covers for it.
 *
 * @param decision a `force` decision
 * @returns the clause, for the caller's report line
 */
export function keepAliveForceNote({
  decision,
}: {
  decision: Extract<KeepAliveCloseDecision, { readonly kind: "force" }>;
}): string {
  const seat = decision.seatWatchPids.map((pid) => `pid ${String(pid)}`).join(", ");
  const cover = decision.coverPids.map((pid) => `pid ${String(pid)}`).join(", ");
  return `its keep-alive (${seat}) retires with it; ${cover} keeps the stores alive`;
}
