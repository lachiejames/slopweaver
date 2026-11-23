/**
 * The whole snapshot's heaviest processes by `%CPU`, each classified fleet or foreign, carrying the session
 * that owns it and how long it has been running — the reading `./anomaly.ts`'s single-process trigger fires
 * on, and the only one on this gauge that can SEE a culprit the fleet does not own.
 *
 * ## Why this is not `./capacity.ts`'s process table
 *
 * `MachineCapacityReport.processes` ranks by MEMORY FOOTPRINT — it is `top -o mem`, the Activity Monitor
 * column, and its whole point is the compressor panic. The runaway `bfs` is the other axis
 * entirely: a seat's `bfs` walking `/` at **three cores** while the machine sat at load 45.9. A footprint
 * ranking never surfaces that process, because a directory walk costs almost no memory.
 *
 * ## Why FOREIGN matters more here than anywhere else on this gauge
 *
 * `./fleetLoad.ts` attributes every process to the session that owns it, and a process no session owns
 * reaches it only as an ORPHANED FLEET SHELL — a `claude` tool shell whose seat died. That is the right
 * criterion for that module and it is blind to exactly the stale-daemon shape: five stale `nx` daemons owned by
 * nothing the fleet ever launched are invisible to session attribution and were a real part of that load.
 * So this module ranks the machine's processes rather than the fleet's, and says which side each one is on.
 *
 * ## It costs no extra subprocess
 *
 * Every input is already a `MachineCapacityDeps` seam (`./read.ts`): `processes()`, `cpuSample()` decoded by
 * `./fleetLoad.ts#parseTopCpuRows`, `elapsed()` decoded by its `parseElapsedRows`, and `comms()` decoded by
 * `./capacityParse.ts#parseCommRows`. This is a second fold over one snapshot, not a second reading of the
 * machine.
 *
 * ## The label is `comm`, never argv — and that is a leak boundary, not a preference
 *
 * A hog reaches a finding row, and a finding row reaches the fleet briefing. An argv can carry a token in a
 * flag value; a `comm` basename cannot. So the label is joined from the `comms` table and falls back to the
 * argv's FIRST whitespace token (the binary path) when no `comm` row exists — never to the rest of the line.
 */
import type { ProcessRow } from "../standing/processes.js";
import type { ProcessComm } from "./capacityParse.js";
import { classifyProcess, type ProcessClassification } from "./classify.js";
import { claudeSessionIdOf, type ProcessCpu, type ProcessElapsed } from "./fleetLoad.js";

/** How far up a parent chain a hog's session attribution climbs — a racing snapshot must not hang a gauge. */
const MAX_HOPS = 24;

/** The pid every orphan reparents to, which ends a climb. */
const LAUNCHD_PID = 1;

/** How many hogs a reading keeps. Bounded because this list reaches a JSONL row and a briefing clause. */
export const DEFAULT_HOG_LIMIT = 8;

/** One heavy process, named by what it is rather than by what it was invoked with. */
export interface CpuHog {
  readonly pid: number;
  /** The process's own `comm` basename — never its argv. See this module's header for why that is a boundary. */
  readonly label: string;
  /** Its `%CPU` from the final `top` sample — 100 is one whole core. */
  readonly cpuPct: number;
  /** How long it has been running, or `undefined` when the elapsed read carried no row for it. */
  readonly elapsedSeconds: number | undefined;
  readonly classification: ProcessClassification;
  /** The Claude Code session whose tree it sits in, or `undefined` when no session owns it. */
  readonly sessionId: string | undefined;
}

/** The heaviest processes on the machine, and whether a per-process CPU sample was available at all. */
export interface CpuHogReading {
  /** The heaviest processes, largest `%CPU` first, at most the limit asked for. */
  readonly hogs: readonly CpuHog[];
  /**
   * Whether the `top` CPU sample decoded to anything. False leaves {@link hogs} empty rather than reporting
   * a machine at zero — a gauge that cannot measure says so, per this repo's silent-failure rule.
   */
  readonly cpuAttributed: boolean;
}

/** The basename of a path — the last segment, or the whole string when it carries no separator. */
function basenameOf({ path }: { path: string }): string {
  const last = path.split("/").at(-1);
  if (last === undefined || last.length === 0) {
    return path;
  }
  return last;
}

/**
 * One pid's display label: its `comm` basename, else its argv's first whitespace token (the binary path)
 * as a basename, else the pid rendered — never any later part of the argv.
 */
function labelFor({
  pid,
  commByPid,
  argvByPid,
}: {
  pid: number;
  commByPid: ReadonlyMap<number, string>;
  argvByPid: ReadonlyMap<number, string>;
}): string {
  const comm = commByPid.get(pid);
  if (comm !== undefined && comm.trim().length > 0) {
    return basenameOf({ path: comm.trim() });
  }
  const argv = argvByPid.get(pid);
  const first = argv?.trimStart().split(/\s+/u)[0];
  if (first !== undefined && first.length > 0) {
    return basenameOf({ path: first });
  }
  return `pid ${String(pid)}`;
}

/**
 * The Claude Code session a pid sits under: climb the parent chain, itself first, to the first process whose
 * own argv declares a `--session-id`. The same walk `./fleetLoad.ts` does, over the same index shape.
 */
function owningSessionIdOf({
  pid,
  rowByPid,
  sessionIdByPid,
}: {
  pid: number;
  rowByPid: ReadonlyMap<number, ProcessRow>;
  sessionIdByPid: ReadonlyMap<number, string>;
}): string | undefined {
  let current: number | undefined = pid;
  for (let hop = 0; hop < MAX_HOPS && current !== undefined && current !== LAUNCHD_PID; hop += 1) {
    const owner = sessionIdByPid.get(current);
    if (owner !== undefined) {
      return owner;
    }
    const row = rowByPid.get(current);
    if (row === undefined) {
      return undefined;
    }
    current = row.ppid === row.pid ? undefined : row.ppid;
  }
  return undefined;
}

/**
 * Rank one snapshot's processes by `%CPU`, classify each, and attribute it to a session when one owns it.
 *
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @param cpuRows the decoded per-process `%CPU` rows; an empty list yields no hogs and `cpuAttributed` false
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` rows, which qualify a hog as sustained
 * @param comms the decoded `ps -ax -o pid=,comm=` rows, which supply every label
 * @param limit how many hogs to keep (defaults to {@link DEFAULT_HOG_LIMIT})
 * @returns the reading
 */
export function cpuHogReading({
  processes,
  cpuRows,
  elapsedRows,
  comms,
  limit = DEFAULT_HOG_LIMIT,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  comms: readonly ProcessComm[];
  limit?: number;
}): CpuHogReading {
  if (cpuRows.length === 0) {
    return { cpuAttributed: false, hogs: [] };
  }
  const rowByPid = new Map(processes.map((row) => [row.pid, row]));
  const argvByPid = new Map(processes.map((row) => [row.pid, row.argv]));
  const commByPid = new Map(comms.map((row) => [row.pid, row.comm]));
  const elapsedByPid = new Map(elapsedRows.map((row) => [row.pid, row.seconds]));
  const sessionIdByPid = new Map<number, string>();
  for (const row of processes) {
    const sessionId = claudeSessionIdOf({ argv: row.argv });
    if (sessionId !== undefined) {
      sessionIdByPid.set(row.pid, sessionId);
    }
  }
  const hogs = cpuRows
    .toSorted((a, b) => b.cpuPct - a.cpuPct)
    .slice(0, Math.max(0, limit))
    .map((row): CpuHog => {
      const sessionId = owningSessionIdOf({ pid: row.pid, rowByPid, sessionIdByPid });
      // A process a session owns is fleet whatever its argv says — the same precedence `./capacity.ts` uses.
      let classification: ProcessClassification = classifyProcess({ argv: argvByPid.get(row.pid) });
      if (sessionId !== undefined) {
        classification = "fleet";
      }
      return {
        classification,
        cpuPct: row.cpuPct,
        elapsedSeconds: elapsedByPid.get(row.pid),
        label: labelFor({ argvByPid, commByPid, pid: row.pid }),
        pid: row.pid,
        sessionId,
      };
    });
  return { cpuAttributed: true, hogs };
}
