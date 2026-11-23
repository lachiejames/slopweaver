/**
 * `slopweaver machine capacity` — RANKING the processes a reading names, split from `./capacity.ts` along the
 * seam between ranking processes and grading the machine: decode `top`, join each row to the `ps` tables
 * and the session registry, and pick the hogs out of the ranked list. Pure.
 */
import type { ProcessRow } from "../standing/processes.js";
import { basename, type LoadAverage, type ProcessComm, parseTopMemReport } from "./capacityParse.js";
import { classifyProcess, type ProcessClassification } from "./classify.js";
import { type ClaudeSession, owningSessionOf } from "./sessionOwner.js";

/** One ranked, classified process in the report — the shape both the JSON and the text renderer read. */
export interface RankedProcess {
  readonly pid: number;
  readonly label: string;
  readonly footprintBytes: number;
  readonly footprintGb: number;
  readonly classification: ProcessClassification;
  /**
   * The Claude Code session this process IS, or descends from, or `undefined` when its chain reaches no
   * registered session. A process with one is always `fleet`.
   */
  readonly session: ClaudeSession | undefined;
}

/**
 * Bytes to GB (÷1024³), rounded to one decimal — the precision the owner's own incident report used.
 *
 * @returns the size in GB, to one decimal place
 */
export function bytesToGb({ bytes }: { bytes: number }): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

/**
 * Whether a footprint is over a GB threshold, judged on the exact bytes — never on {@link bytesToGb}'s rounded
 * display value, which reads 8200M as `8` and would let a process just over an 8 GB threshold pass silent
 * (a process under the line rounds to it).
 *
 * @returns true when the exact byte count is strictly over the threshold
 */
export function overThresholdGb({ bytes, gb }: { bytes: number; gb: number }): boolean {
  return bytes > gb * 1024 * 1024 * 1024;
}

/**
 * A process's display label: `comm`'s own basename when one was read, else the first whitespace-delimited
 * token of its argv (a truncated fallback, only reached when the `comm` read itself failed), else `pid N`
 * when neither was read.
 */
function processLabel({
  comm,
  argv,
  pid,
}: {
  comm: string | undefined;
  argv: string | undefined;
  pid: number;
}): string {
  if (comm !== undefined && comm.length > 0) {
    return basename({ path: comm });
  }
  const first = argv?.trimStart().split(/\s+/u)[0];
  if (first === undefined || first.length === 0) {
    return `pid ${String(pid)}`;
  }
  return basename({ path: first });
}

/**
 * Decode `top`'s report and join every ranked process to the `ps` tables, so the builder itself only grades.
 *
 * @param topText the raw `top -l 1 -o mem -stats pid,mem` output, or `undefined` when the read failed
 * @param topN how many of `top`'s own rows the report keeps
 * @param processes the decoded argv table, for classification
 * @param comms the decoded `comm` table, for the display label
 * @returns the load-average header line and the ranked, classified, labelled processes
 */
export function rankTopProcesses({
  topText,
  topN,
  processes,
  comms,
  sessions,
}: {
  topText: string | undefined;
  topN: number;
  processes: readonly ProcessRow[];
  comms: readonly ProcessComm[];
  sessions: readonly ClaudeSession[];
}): { readonly load: LoadAverage | undefined; readonly ranked: readonly RankedProcess[] } {
  const argvByPid = new Map(processes.map((row) => [row.pid, row.argv]));
  const commByPid = new Map(comms.map((row) => [row.pid, row.comm]));
  const decoded = topText === undefined ? { load: undefined, processes: [] } : parseTopMemReport({ text: topText });
  const ranked = decoded.processes.slice(0, topN).map((process): RankedProcess => {
    const argv = argvByPid.get(process.pid);
    const comm = commByPid.get(process.pid);
    const session = owningSessionOf({ pid: process.pid, processes, sessions });
    return {
      classification: session === undefined ? classifyProcess({ argv }) : "fleet",
      footprintBytes: process.footprintBytes,
      footprintGb: bytesToGb({ bytes: process.footprintBytes }),
      label: processLabel({ argv, comm, pid: process.pid }),
      pid: process.pid,
      session,
    };
  });
  return { load: decoded.load, ranked };
}

/**
 * The hogs a ranked list names: the largest foreign process, and the processes sessions spawned — owned by a
 * session and not that session's own `claude` — the largest of them, and every one over the threshold.
 *
 * @returns the largest foreign process, the largest session-spawned child, and every child over the threshold
 */
export function hogsOf({ ranked, foreignAlertGb }: { ranked: readonly RankedProcess[]; foreignAlertGb: number }): {
  readonly topForeign: RankedProcess | undefined;
  readonly topFleetChild: RankedProcess | undefined;
  readonly fleetChildAlert: boolean;
  /** Every session-spawned child over the threshold, largest first — one alert clause each. */
  readonly alertingChildren: readonly RankedProcess[];
} {
  const children = ranked.filter((process) => process.session !== undefined && process.session.pid !== process.pid);
  const alertingChildren = children.filter((child) =>
    overThresholdGb({ bytes: child.footprintBytes, gb: foreignAlertGb }),
  );
  return {
    alertingChildren,
    fleetChildAlert: alertingChildren.length > 0,
    topFleetChild: children[0],
    topForeign: ranked.find((process) => process.classification === "foreign"),
  };
}
