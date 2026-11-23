/**
 * The effectful half of `fseventsd-bloated`: read fseventsd's footprint and the voice call leases, then judge.
 *
 * Both reads are local, so a pass opens no connection (monitors read local state only). The footprint goes through the same `ps` and
 * `top` seams `machine capacity` reads a watched daemon by (`../live/machine/read.ts`), so fseventsd is found by its
 * exact binary path and never by a name a lookalike could carry.
 */
import { readdirSync, readFileSync } from "node:fs";

import { liveCallLeases } from "../desktop/buildStamp.js";
import { type CallLeaseSeams, readCallLeases } from "../desktop/callLeases.js";
import { logger } from "../lib/logger.js";
import { parseTopMemReport } from "../live/machine/capacityParse.js";
import { type MachineCapacityDeps, productionMachineCapacityDeps } from "../live/machine/read.js";

import {
  evaluateFseventsdBloated,
  FSEVENTSD_RESTART_LINE_BYTES,
  type FseventsdFootprint,
  fseventsdSpec,
  type LiveCallCount,
} from "./fseventsdBloated.js";
import { captureOnset, type OnsetCaptureSeams, productionOnsetSeams } from "./fseventsdOnset/capture.js";
import type { MonitorReading } from "./types.js";

/** The two process reads the footprint needs. */
export type FootprintSeams = Pick<MachineCapacityDeps, "comms" | "watchedTopReport">;

/** The footprint reads, and the onset capture a balloon's first read takes (`./fseventsdOnset/capture.ts`). */
export type FseventsdSeams = FootprintSeams & { readonly onset: OnsetCaptureSeams };

/**
 * fseventsd's footprint: its pid by exact binary path, then `top` over that pid. The heaviest wins if two run.
 *
 * @param seams the process table and the `top` read
 * @returns the footprint; an empty process table or a `top` that printed nothing for the pid is `unreadable`
 */
export function readFseventsdFootprint({ seams }: { seams: FootprintSeams }): FseventsdFootprint {
  const comms = seams.comms();
  if (comms.length === 0) {
    return { kind: "unreadable", why: "`ps -ax -o pid=,comm=` listed no process at all" };
  }
  const { comm } = fseventsdSpec();
  const pids = comms.filter((row) => row.comm === comm).map((row) => row.pid);
  if (pids.length === 0) {
    return { kind: "not-running" };
  }
  const text = seams.watchedTopReport({ pids });
  if (text === undefined) {
    return { kind: "unreadable", why: `\`top\` over fseventsd's pid ${pids.join(", ")} failed` };
  }
  const rows = parseTopMemReport({ text }).processes.filter((row) => pids.includes(row.pid));
  const heaviest = rows.toSorted((a, b) => b.footprintBytes - a.footprintBytes)[0];
  if (heaviest === undefined) {
    return { kind: "unreadable", why: `\`top\` printed no footprint for fseventsd's pid ${pids.join(", ")}` };
  }
  return { bytes: heaviest.footprintBytes, kind: "read", pid: heaviest.pid };
}

/**
 * How many voice call leases are live now.
 *
 * @param home the state home whose consoles' leases are read
 * @param seams the listing and the read
 * @param nowMs the instant a lease's `untilMs` is judged against
 * @returns the live count, or why the leases could not be read
 */
export function readLiveCalls({
  home,
  seams,
  nowMs,
}: {
  home: string;
  seams: CallLeaseSeams;
  nowMs: number;
}): LiveCallCount {
  const leases = readCallLeases({ home, seams });
  if (leases.isErr()) {
    return { kind: "unreadable", why: leases.error.message };
  }
  return { kind: "read", live: liveCallLeases({ leases: leases.value, nowMs }) };
}

/**
 * The real process reads: `ps` and `top`, through `machine capacity`'s own seams, and the onset capture's.
 *
 * @param home the state home, which `machine capacity`'s seams take for a disk read this monitor never makes
 * @returns the footprint seams and the onset capture's
 */
export function productionFseventsdSeams({ home }: { home: string }): FseventsdSeams {
  const { comms, watchedTopReport } = productionMachineCapacityDeps({ home, topN: 1 });
  return { comms, onset: productionOnsetSeams(), watchedTopReport };
}

/**
 * Take the onset capture when fseventsd reads over the restart line, and say on stderr when it failed or `ps`
 * did. A capture is evidence for a later investigation, never a change to this pass's reading: a `blindSpot` would
 * say the subject list may be short, which a failed capture is not, and it would change how the card settles.
 */
function captureIfBallooned({
  footprint,
  home,
  nowMs,
  seams,
}: {
  footprint: FseventsdFootprint;
  home: string;
  nowMs: number;
  seams: OnsetCaptureSeams;
}): void {
  if (footprint.kind !== "read" || footprint.bytes <= FSEVENTSD_RESTART_LINE_BYTES) {
    return;
  }
  const nowIso = new Date(nowMs).toISOString();
  const outcome = captureOnset({ bytes: footprint.bytes, home, nowIso, pid: footprint.pid, seams });
  const prefix = `fseventsd-bloated: the onset capture for pid ${String(footprint.pid)}`;
  if (outcome.isErr()) {
    logger.error({ msg: `${prefix} failed, and the next pass retries: ${outcome.error}` });
    return;
  }
  if (outcome.value.kind === "captured" && outcome.value.psProblem !== undefined) {
    logger.error({ msg: `${prefix} kept the log, but ps over its clients failed: ${outcome.value.psProblem}` });
  }
}

/**
 * Read and evaluate `fseventsd-bloated`, taking a balloon's onset capture on the way.
 *
 * @param home the state home the call leases live under, and the onset capture is written under
 * @param nowMs the instant a lease is judged live at
 * @param processes the process reads and the onset capture's, real in production and plain fakes in a test, so no
 *   test judges this machine or runs `log`
 * @returns the reading; a footprint or lease listing that could not be read is `unmeasurable`, never `clear` or `firing`
 */
export function readFseventsdBloated({
  home,
  nowMs,
  processes,
}: {
  home: string;
  nowMs: number;
  processes: FseventsdSeams;
}): MonitorReading {
  const footprint = readFseventsdFootprint({ seams: processes });
  const calls = readLiveCalls({
    home,
    nowMs,
    seams: { names: ({ path }) => readdirSync(path), readText: ({ path }) => readFileSync(path, "utf8") },
  });
  // After both reads, never between them: `log` may block for its whole bound, and a lease read taken after that
  // wait would judge a call that started during it against a footprint read before it.
  captureIfBallooned({ footprint, home, nowMs, seams: processes.onset });
  return evaluateFseventsdBloated({ calls, footprint });
}
