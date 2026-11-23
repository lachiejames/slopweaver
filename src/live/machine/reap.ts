/**
 * WHICH orphaned fleet shells to kill — the pure half of a reap verb the sweep runs every tick: it kills
 * orphaned fleet shells whose session is dead and reports what it killed, no judgement needed.
 *
 * ## The criterion, and why it needs no judgement
 *
 * A process is reaped when all three hold, computed from ONE `ps -ax -o pid=,ppid=,args=` snapshot:
 *
 * 1. **It is a fleet shell** — its argv sources a Claude Code shell snapshot
 *    (`~/.claude/shell-snapshots/snapshot-*.sh`). That is what a Bash tool call looks like on this machine,
 *    verified live, and it is what keeps this verb away from every unrelated orphan a laptop has.
 * 2. **It is orphaned** — its parent is `launchd`. Nothing is left to read its output or to be interrupted by
 *    the owner, which is the visibility property doctrine rule 2 exists for.
 * 3. **Its seat is dead** — no process that has NOT been reparented sources the same snapshot. The snapshot
 *    path is minted once per session and is the only identity that outlives the session, so this is the
 *    checkable form of "whose session is dead".
 *
 * Condition 3 is deliberately conservative in the safe direction: a live session holding one orphan and one
 * live shell on the same snapshot keeps its orphan this tick. That is a false NEGATIVE, and the next tick
 * takes it — the opposite mistake kills a running session's work.
 *
 * ## Why the whole descendant tree, deepest first
 *
 * MEASURED: the 64 orphaned shells were not themselves the cost — their children were, one dead
 * seat's test loops at 10-13% CPU each. Killing only the `zsh` reparents those children to `launchd`, which
 * MANUFACTURES the exact class this verb reaps, minus the argv that makes them findable. Deepest first so a
 * parent cannot fork a replacement between the two signals.
 *
 * ## The two hard guards
 *
 * Never `launchd` itself, and never this process or anything in its own parent chain. Without the second, a
 * reap run from inside a session whose own shell matched would kill its caller mid-report.
 *
 * ## The third guard: a pid is not an identity, so the plan carries what each one WAS
 *
 * The plan and the signal read two different instants — the production deps alone spend ~1.45 s inside
 * `top -l 2 -s 1` between them — and a pid the kernel recycled in that gap points at a different process.
 * At load 146, the condition this verb exists for, fork churn is at its highest and so is the chance of one.
 * So every target carries {@link ReapTarget.argvByPid}, the argv each pid had when it was SELECTED, and
 * {@link stillTheSameProcess} re-checks it against a fresh snapshot taken immediately before the signal. A
 * pid whose argv moved, or which is gone, is dropped rather than signalled.
 *
 * Pure: a snapshot in, a plan out. `../../cli/commands/machine/reap.ts` owns the one `process.kill`.
 */
import { type BrowserReapOutcome, renderBrowserReapLines } from "../../browser/sessionReapReport.js";
import type { ProcessRow } from "../standing/processes.js";
import type { DevServerPlan, StrayDevServer } from "./devServers.js";
import {
  childIndexOf,
  liveShellSnapshots,
  orphanedFleetShells,
  type ProcessCpu,
  type ProcessElapsed,
  shellSnapshotOf,
} from "./fleetLoad.js";
import { treeCpu, treeDeepestFirst } from "./processTree.js";
import { type RunawaySearch, runawaySearchLabel } from "./runawaySearch.js";

/** The pid every orphan reparents to, and the one pid nothing here may ever signal. */
const LAUNCHD_PID = 1;

/** How far up its own parent chain a reap climbs — a cycle in a racing `ps` snapshot must not hang the walk. */
const MAX_ANCESTRY_HOPS = 64;

/** One orphaned shell and everything under it — the unit a reap kills and reports.
 *
 * @internal
 */
export interface ReapTarget {
  /** The orphaned shell itself. */
  readonly shellPid: number;
  /** The seat it belonged to — the shell-snapshot path its argv sources. */
  readonly snapshot: string;
  /** Its whole tree, DEEPEST FIRST, itself last: the exact order the kills go out in. */
  readonly treePids: readonly number[];
  /**
   * What each pid in {@link treePids} was RUNNING when the plan selected it. A pid is not an identity across
   * two snapshots, so this is what a signal is re-checked against — see this module's third guard.
   */
  readonly argvByPid: Readonly<Record<string, string>>;
  /** The tree's summed `%CPU` — what reaping it gives back — or `undefined` when no sample was taken. */
  readonly cpuPct: number | undefined;
  /** How long the shell has been orphaned-or-running, or `undefined` when no elapsed reading was available. */
  readonly elapsedSeconds: number | undefined;
}

/** An orphan this plan deliberately left alone, and why — a reap that skips silently is not a report. */
interface ReapSkip {
  readonly shellPid: number;
  readonly snapshot: string;
  readonly why: string;
}

/** Everything one snapshot says to do. */
export interface ReapPlan {
  readonly targets: readonly ReapTarget[];
  readonly skipped: readonly ReapSkip[];
  /** How many processes the targets add up to, trees included. */
  readonly processCount: number;
  /** The targets' summed `%CPU`, or `undefined` when no sample was taken — never 0 for unmeasured. */
  readonly cpuPct: number | undefined;
}

/**
 * This process's own parent chain, itself included — the pids a reap may never signal. Without it, a reap run
 * from inside a session whose own shell matched would kill its caller mid-report.
 *
 * @param selfPid the process to climb from
 * @param processes the snapshot each hop's parent is read out of
 * @returns every pid on the chain, the caller included; just the caller when the snapshot does not carry it
 */
export function ownAncestry({
  selfPid,
  processes,
}: {
  selfPid: number;
  processes: readonly ProcessRow[];
}): ReadonlySet<number> {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const chain = new Set<number>([selfPid]);
  let current = selfPid;
  for (let hop = 0; hop < MAX_ANCESTRY_HOPS && current !== LAUNCHD_PID; hop += 1) {
    const row = byPid.get(current);
    if (row === undefined) {
      break;
    }
    // A self-parented row is a racing snapshot, not a chain — walking it would loop until the hop cap.
    if (row.ppid === current) {
      break;
    }
    chain.add(row.ppid);
    current = row.ppid;
  }
  return chain;
}

/** A measured percentage, or zero — only ever reached when a sample WAS taken, so it never invents one. */
function numberOr({ value }: { value: number | undefined }): number {
  if (value === undefined) {
    return 0;
  }
  return value;
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
 * Whether a pid is still the process the plan selected — its argv in a FRESH snapshot equals what it was
 * when the plan was computed. A pid the plan never recorded, or one that is gone, is not the same process.
 *
 * @param target anything carrying the argv each pid had when it was selected — an orphaned shell's
 *   {@link ReapTarget} or a stray dev server's ({@link ./devServers.ts}), which is why this takes the bag
 *   rather than either type
 * @param pid the pid about to be signalled
 * @param current the fresh snapshot's argv by pid
 * @returns whether the signal may go out
 */
export function stillTheSameProcess({
  target,
  pid,
  current,
}: {
  target: { readonly argvByPid: Readonly<Record<string, string>> };
  pid: number;
  current: ReadonlyMap<number, string>;
}): boolean {
  const selected = target.argvByPid[String(pid)];
  if (selected === undefined) {
    return false;
  }
  return current.get(pid) === selected;
}

/**
 * Decide one snapshot: which orphaned fleet shells to reap, which to leave and why.
 *
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @param cpuRows the decoded per-process `%CPU` rows, for the cost this reap gives back
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` rows
 * @param selfPid this process's own pid, whose whole ancestry is excluded from every target
 * @returns the plan
 */
export function reapPlan({
  processes,
  cpuRows,
  elapsedRows,
  selfPid,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  selfPid: number;
}): ReapPlan {
  const live = liveShellSnapshots({ processes });
  const children = childIndexOf({ processes });
  const cpuByPid = new Map(cpuRows.map((row) => [row.pid, row.cpuPct]));
  const elapsedByPid = new Map(elapsedRows.map((row) => [row.pid, row.seconds]));
  const protectedPids = ownAncestry({ processes, selfPid });
  const argvByPid = new Map(processes.map((row) => [row.pid, row.argv]));
  const targets: ReapTarget[] = [];
  const skipped: ReapSkip[] = [];
  for (const shell of orphanedFleetShells({ processes })) {
    const snapshot = shellSnapshotOf({ argv: shell.argv })!; // `orphanedFleetShells` already proved it has one
    if (live.has(snapshot)) {
      skipped.push({ shellPid: shell.pid, snapshot, why: "its seat still has a live shell on this snapshot" });
      continue;
    }
    const treePids = treeDeepestFirst({ childrenByPpid: children, root: shell.pid });
    if (treePids.some((pid) => protectedPids.has(pid) || pid === LAUNCHD_PID)) {
      skipped.push({ shellPid: shell.pid, snapshot, why: "this process's own parent chain runs through it" });
      continue;
    }
    targets.push({
      argvByPid: Object.fromEntries(
        treePids.map((pid) => [String(pid), argvOf({ byPid: argvByPid, pid })]).filter(([, argv]) => argv !== ""),
      ),
      cpuPct: treeCpu({ cpuByPid, cpuRows, treePids }),
      elapsedSeconds: elapsedByPid.get(shell.pid),
      shellPid: shell.pid,
      snapshot,
      treePids,
    });
  }
  return {
    cpuPct:
      cpuRows.length === 0
        ? undefined
        : Math.round(targets.reduce((sum, target) => sum + numberOr({ value: target.cpuPct }), 0) * 10) / 10,
    processCount: targets.reduce((sum, target) => sum + target.treePids.length, 0),
    skipped,
    targets,
  };
}

/** What one reap RUN did — the plan, plus what the kills actually achieved. */
export interface ReapOutcome {
  readonly plan: ReapPlan;
  /**
   * The stray docs dev servers this run found — a second class, planned by
   * `./devServers.ts` from the SAME `ps` snapshot and killed by the same executor.
   */
  readonly devServers: DevServerPlan;
  /**
   * The browser interaction sessions this run judged and what it did to them — a
   * third class, judged by whether each session's OPENER is alive and never by age
   * (`../../browser/sessionReap.ts`), from the same snapshot.
   */
  readonly browser: BrowserReapOutcome;
  /**
   * The runaway searches inside LIVE seats — a fourth class, selected by `./runawaySearch.ts`
   * from the same snapshot. Only the search is killed; its shell and its seat live on.
   */
  readonly searches: readonly RunawaySearch[];
  /** Pids this run signalled successfully. */
  readonly killed: readonly number[];
  /** Pids whose signal failed, with the reason — a process that exited between snapshot and signal is one. */
  readonly failed: readonly { readonly pid: number; readonly why: string }[];
  /** Whether this run only planned. */
  readonly dryRun: boolean;
}

/** One stray dev server as a line names it — pid, port, tree size, cost, age, worktree and what caught it. */
function devServerLabel({ server }: { server: StrayDevServer }): string {
  const cpu = server.cpuPct === undefined ? "cpu unmeasured" : `${String(server.cpuPct)}% cpu`;
  const age = server.elapsedSeconds === undefined ? "age unread" : `${String(server.elapsedSeconds)}s old`;
  const port = server.port === undefined ? "port unnamed" : `port ${String(server.port)}`;
  return (
    `dev server ${String(server.servePid)} on ${port} + ${String(server.treePids.length - 1)} process(es) · ` +
    `${cpu} · ${age} · ${server.worktree} — ${server.why}`
  );
}

/**
 * The report a reap prints. Every line names a pid, because a reap nobody can check is exactly the invisible
 * act doctrine rule 6 forbids — the verb exists to report what it killed.
 *
 * @param outcome what the run planned and did
 * @returns the lines, in display order, with the summary last
 */
export function renderReapLines({ outcome }: { outcome: ReapOutcome }): readonly string[] {
  const lines: string[] = [];
  const verb = outcome.dryRun ? "WOULD REAP" : "REAPED";
  for (const target of outcome.plan.targets) {
    const cpu = target.cpuPct === undefined ? "cpu unmeasured" : `${String(target.cpuPct)}% cpu`;
    const age = target.elapsedSeconds === undefined ? "age unread" : `${String(target.elapsedSeconds)}s old`;
    lines.push(
      `${verb} shell ${String(target.shellPid)} + ${String(target.treePids.length - 1)} descendant(s) · ${cpu} · ${age} · seat ${target.snapshot}`,
    );
  }
  for (const server of outcome.devServers.stray) {
    lines.push(`${verb} ${devServerLabel({ server })}`);
  }
  // A search whose signal failed is named once, by the failure line below — never also as REAPED.
  const failedPids = new Set(outcome.failed.map((failure) => failure.pid));
  for (const search of outcome.searches.filter((row) => !failedPids.has(row.pid))) {
    lines.push(`${verb} ${runawaySearchLabel({ search })} — the seat is left running`);
  }
  for (const skip of outcome.plan.skipped) {
    lines.push(`left shell ${String(skip.shellPid)} alone: ${skip.why}`);
  }
  for (const skip of outcome.devServers.left) {
    lines.push(`left dev server ${String(skip.servePid)} alone: ${skip.why}`);
  }
  for (const failure of outcome.failed) {
    lines.push(`could not signal ${String(failure.pid)}: ${failure.why}`);
  }
  // The browser class prints its own lines and its own count; the process summary stays LAST, as it always was.
  lines.push(...renderBrowserReapLines({ dryRun: outcome.dryRun, outcome: outcome.browser }));
  const cpu = outcome.plan.cpuPct === undefined ? "cpu unmeasured" : `${String(outcome.plan.cpuPct)}% cpu`;
  lines.push(
    `machine reap: ${verb.toLowerCase()} ${String(outcome.plan.targets.length)} orphaned fleet shell(s), ${String(outcome.plan.processCount)} process(es), ${cpu}, ${String(outcome.devServers.stray.length)} stray dev server(s) and ${String(outcome.searches.length)} runaway search(es) — ${String(outcome.plan.skipped.length + outcome.devServers.left.length)} left alone, ${String(outcome.failed.length)} signal(s) failed`,
  );
  return lines;
}
