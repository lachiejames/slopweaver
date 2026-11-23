/**
 * Decoding for `slopweaver machine series`. Pure.
 *
 * `top -l 2 -s 1 -stats pid,cpu,mem` gives the FINAL sample's load average and per-process `%CPU` and footprint.
 * Only the final sample is read, for the reason `./fleetLoad.ts#parseTopCpuRows` gives: the first sample's
 * per-process `%CPU` is always zero, because `top` has nothing to measure it over yet. That is also why this is
 * `top` and not `ps -o %cpu`: `ps` prints a decaying average over the process's life, which would draw a chart of
 * the past rather than of the last second. Measured on this machine, it prints rows such as
 * `56657  89.2 464M+` (the trailing `+`/`-` is `top`'s own change marker); reproduce with
 * `top -l 2 -s 1 -stats pid,cpu,mem | grep -E '^(Load Avg|PID)'`.
 *
 * Memory in use comes from `vm_stat`, never `top`'s `PhysMem` line, whose "used" counts the file cache. MEASURED
 * on this 48 GB machine: `PhysMem` said 47.0 GB used of 47.1 while Activity Monitor's sum (app memory,
 * wired and compressed) came to 44.7 GB of 48, so a chart off `PhysMem` sat pinned at its ceiling and said nothing.
 * Reproduce with `vm_stat` beside `top -l 1 | grep PhysMem`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { LoadAverage } from "./capacityParse.js";
import { type MachineSeriesError, MachineSeriesErrors } from "./seriesErrors.js";

/** One process in the final sample. */
interface TopProcessSample {
  readonly pid: number;
  /** `%CPU` over the one-second interval; 100 is one whole core. */
  readonly cpuPct: number;
  /** Its physical footprint, Activity Monitor's Memory column, in bytes. */
  readonly footprintBytes: number;
}

/** What the final sample says about the whole machine and each process in it. */
export interface MachineTopSnapshot {
  readonly load: LoadAverage;
  /** The `CPU usage:` header's idle percentage, or `undefined` when the header was absent or damaged. */
  readonly idlePct: number | undefined;
  readonly processes: readonly TopProcessSample[];
}

/**
 * The final sample's idle percentage, read only when its `user`, `sys` and `idle` sum to 100 within a point —
 * the same check `./hiddenCpu.ts` makes, since the two read the same header. Unrounded, as `top` printed it, so
 * 19.96% stays under the 20% floor.
 *
 * @returns the idle percentage, or `undefined` when no well-formed header is present
 */
function idleOf({ lines }: { lines: readonly string[] }): number | undefined {
  const header = lines
    .map((line) => /^CPU usage:\s*(\d+(?:\.\d+)?)% user,\s*(\d+(?:\.\d+)?)% sys,\s*(\d+(?:\.\d+)?)% idle/u.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  if (header === undefined) {
    return undefined;
  }
  const [user, sys, idle] = [Number(header[1]!), Number(header[2]!), Number(header[3]!)];
  if (Math.abs(user + sys + idle - 100) > 1) {
    return undefined;
  }
  return idle;
}

/** The `vm_stat` lines memory in use is summed from, Activity Monitor's Memory Used. */
const VM_STAT_FIELDS = {
  anonymous: "Anonymous pages",
  compressed: "Pages occupied by compressor",
  purgeable: "Pages purgeable",
  wired: "Pages wired down",
} as const;

/** `top`'s size units, as powers of 1024. */
const UNIT: Readonly<Record<string, number>> = {
  B: 1,
  G: 1024 ** 3,
  K: 1024,
  M: 1024 ** 2,
  T: 1024 ** 4,
};

/**
 * One `top` size (`464M`, `7041K`, `35G`) in bytes.
 *
 * @returns the bytes, or `undefined` when the text is not a size
 */
export function topBytes({ text }: { text: string }): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([BKMGT])$/u.exec(text);
  if (match === null) {
    return undefined;
  }
  // Both groups are mandatory, and the unit group can only match a key the table holds.
  return Math.round(Number(match[1]!) * UNIT[match[2]!]!);
}

/**
 * The lines of `top`'s last sample, each sample opening on its `Processes:` line.
 *
 * @returns the last sample's lines, or `undefined` when fewer than two samples were printed
 */
function finalSample({ text }: { text: string }): readonly string[] | undefined {
  const samples: string[][] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("Processes:")) {
      samples.push([]);
    }
    samples.at(-1)?.push(line);
  }
  if (samples.length < 2) {
    return undefined;
  }
  return samples.at(-1);
}

/**
 * The process rows under the heading, each `<pid> <cpu> <size>[+-]`. A line that is not that shape is skipped: `top`
 * prints nothing else under the heading, so a skipped line is a process that exited mid-print, never a number.
 *
 * @returns the rows
 */
function processRows({ lines }: { lines: readonly string[] }): readonly TopProcessSample[] {
  const rows: TopProcessSample[] = [];
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(\d+(?:\.\d+)?)\s+(\S+?)[+-]?\s*$/u.exec(line);
    if (match === null) {
      continue;
    }
    const footprintBytes = topBytes({ text: match[3]! });
    if (footprintBytes === undefined) {
      continue;
    }
    rows.push({ cpuPct: Number(match[2]!), footprintBytes, pid: Number(match[1]!) });
  }
  return rows;
}

/**
 * Decode the final sample of `top -l 2 -s 1 -stats pid,cpu,mem`. Every machine-wide figure is required: a sample
 * missing one is an error naming it, never a zero.
 *
 * @param text the whole `top` output
 * @returns the snapshot, or which part was missing
 */
export function parseMachineSeriesTop({ text }: { text: string }): Result<MachineTopSnapshot, MachineSeriesError> {
  const lines = finalSample({ text });
  if (lines === undefined) {
    return err(MachineSeriesErrors.topNoSecondSample());
  }
  const loadMatch = lines
    .map((line) => /^Load Avg:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/u.exec(line))
    .find((match): match is RegExpExecArray => match !== null);
  if (loadMatch === undefined) {
    return err(MachineSeriesErrors.topNoLoad());
  }
  const heading = lines.findIndex((line) => /^PID\s+%CPU\s+MEM\s*$/u.test(line));
  if (heading < 0) {
    return err(MachineSeriesErrors.topNoProcessHeading());
  }
  return ok({
    idlePct: idleOf({ lines }),
    load: { load1: Number(loadMatch[1]!), load15: Number(loadMatch[3]!), load5: Number(loadMatch[2]!) },
    processes: processRows({ lines: lines.slice(heading + 1) }),
  });
}

/**
 * One `vm_stat` count, `<label>:   <n>.`.
 *
 * @returns the count, or `undefined` when the line is absent
 */
function vmStatCount({ text, label }: { text: string; label: string }): number | undefined {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${label}:`));
  const match = line === undefined ? null : /:\s*(\d+)\.?\s*$/u.exec(line);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]!);
}

/**
 * Memory in use as Activity Monitor sums it: app memory (anonymous pages less purgeable), wired and compressed,
 * each line required, so a print missing one is the error naming it, never a smaller sum.
 *
 * @param text the whole `vm_stat` output
 * @returns the bytes in use, or which line was missing
 */
export function parseVmStatUsedBytes({ text }: { text: string }): Result<number, MachineSeriesError> {
  const pageSize = /page size of (\d+) bytes/u.exec(text);
  if (pageSize === null) {
    return err(MachineSeriesErrors.vmStatIncomplete({ field: "page size" }));
  }
  const anonymous = vmStatCount({ label: VM_STAT_FIELDS.anonymous, text });
  const purgeable = vmStatCount({ label: VM_STAT_FIELDS.purgeable, text });
  const wired = vmStatCount({ label: VM_STAT_FIELDS.wired, text });
  const compressed = vmStatCount({ label: VM_STAT_FIELDS.compressed, text });
  if (anonymous === undefined) {
    return err(MachineSeriesErrors.vmStatIncomplete({ field: VM_STAT_FIELDS.anonymous }));
  }
  if (purgeable === undefined) {
    return err(MachineSeriesErrors.vmStatIncomplete({ field: VM_STAT_FIELDS.purgeable }));
  }
  if (wired === undefined) {
    return err(MachineSeriesErrors.vmStatIncomplete({ field: VM_STAT_FIELDS.wired }));
  }
  if (compressed === undefined) {
    return err(MachineSeriesErrors.vmStatIncomplete({ field: VM_STAT_FIELDS.compressed }));
  }
  return ok((anonymous - purgeable + wired + compressed) * Number(pageSize[1]!));
}
