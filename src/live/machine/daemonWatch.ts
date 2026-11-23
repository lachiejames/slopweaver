/**
 * The macOS daemons whose footprint `machine watch` reads, and how their pids are found.
 *
 * A module of its own because two layers need it and neither may import the other: the read seam
 * (`./read.ts`) asks `top` for exactly these pids, and the judge (`./anomaly.ts`) matches them by label. The
 * ordinary `top -o mem -n <topN>` read cannot carry this, because a daemon ranked sixteenth is not in it at
 * all — fifteen processes over 1.1 GiB and `fseventsd` at 1.05 GiB would
 * read clear. So a watched daemon is read by pid, beside the ranked list, whatever its rank.
 */

import type { ProcessComm } from "./capacityParse.js";

/** One watched daemon: its process label, and the one command that relieves it. */
export interface WatchedDaemonSpec {
  readonly label: string;
  /** The binary's full path, under SIP-protected `/System`, so no fleet process can stand in for it. */
  readonly comm: string;
  readonly relief: string;
}

/**
 * The watched daemons. Each is ROOT, so its relief is a hand step for the owner rather than a `kill` a seat could
 * run. The name says WATCHED, not guilty: a daemon here holds what its clients have not drained, and which
 * producer or consumer drove it is the dispatched investigation's question, not this list's claim.
 */
export const WATCHED_DAEMONS: readonly WatchedDaemonSpec[] = [
  {
    comm: "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd",
    label: "fseventsd",
    relief: "sudo killall fseventsd",
  },
];

/**
 * The pids of every running process whose command is EXACTLY a watched daemon's binary path. Identity is the
 * path, never a name or an argv: a label match would admit a lookalike, and the argv heuristic
 * in `./classify.ts` would call the real daemon fleet if its arguments ever named this tool — so a pid this
 * returns IS the daemon, and `./anomaly.ts` judges it without re-classifying it.
 *
 * @param comms the decoded `ps -ax -o pid=,comm=` table
 * @returns every matching pid, in table order; empty when none is running
 */
export function watchedDaemonPids({ comms }: { comms: readonly ProcessComm[] }): readonly number[] {
  return comms.filter((row) => WATCHED_DAEMONS.some((daemon) => daemon.comm === row.comm)).map((row) => row.pid);
}
