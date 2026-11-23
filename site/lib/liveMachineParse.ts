/**
 * The Fleet page's live machine reading, its parsers: the text `vm_stat`, `ps` and `sysctl` print, decoded into the
 * figures `./liveMachine.ts` attributes. Pure. `site/` never imports `src/`, so the memory figure restates
 * `src/live/machine/seriesParse.ts#parseVmStatUsedBytes` and the swapfile count `capacityParse.ts#countSwapfiles`;
 * `site/__tests__/unit/liveMachineMirror.test.ts` binds each copy to its original.
 */
import { err, ok, type Result } from "neverthrow";

/** One process as the live reading needs it: its parent, CPU time so far, resident memory and `comm` name. */
export interface LiveProcessStat {
  readonly pid: number;
  readonly ppid: number;
  /** User plus system CPU time the process has spent since it started. */
  readonly cpuTimeMs: number;
  readonly residentBytes: number;
  /** The full executable path `ps` prints as `comm`, spaces and all; never any part of argv. */
  readonly comm: string;
}

/** Why one live machine reading could not be taken. One union, scoped to this reading. */
export type LiveMachineError =
  | { readonly code: "READ_FAILED"; readonly message: string; readonly read: string }
  | { readonly code: "VM_STAT_INCOMPLETE"; readonly message: string; readonly field: string }
  | { readonly code: "CPU_COUNTERS_INVALID"; readonly message: string }
  | { readonly code: "INTERVAL_TOO_LONG"; readonly message: string; readonly elapsedMs: number };

/** The factories for {@link LiveMachineError}. */
export const LiveMachineErrors = {
  cpuCountersInvalid: (): LiveMachineError => ({
    code: "CPU_COUNTERS_INVALID",
    message: "the kernel's CPU counters did not move forward between two readings",
  }),
  intervalTooLong: ({ elapsedMs }: { elapsedMs: number }): LiveMachineError => ({
    code: "INTERVAL_TOO_LONG",
    elapsedMs,
    message: `the two snapshots were ${String(Math.round(elapsedMs / 1000))}s apart, past the ten-second bound, so CPU was not measured`,
  }),
  readFailed: ({ read }: { read: string }): LiveMachineError => ({
    code: "READ_FAILED",
    message: `${read} did not answer`,
    read,
  }),
  vmStatIncomplete: ({ field }: { field: string }): LiveMachineError => ({
    code: "VM_STAT_INCOMPLETE",
    field,
    message: `vm_stat printed no "${field}" line`,
  }),
} as const;

/** The four `vm_stat` lines memory in use is summed from, as `src/live/machine/seriesParse.ts` names them. */
const VM_STAT_FIELDS = {
  anonymous: "Anonymous pages",
  compressed: "Pages occupied by compressor",
  purgeable: "Pages purgeable",
  wired: "Pages wired down",
} as const;

/**
 * One `vm_stat` count, by its label.
 *
 * @returns the page count, or `undefined` when the line is absent
 */
function vmStatCount({ text, label }: { text: string; label: string }): number | undefined {
  const match = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, "mu").exec(text);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]);
}

/**
 * Memory in use as Activity Monitor sums it — app memory, wired and compressed, never the file cache:
 * `(anonymous - purgeable + wired + compressed) x page size`, every line required.
 *
 * @param text the whole `vm_stat` output
 * @returns the bytes in use, or which line was missing
 */
export function parseVmStatUsedBytes({ text }: { text: string }): Result<number, LiveMachineError> {
  const pageSize = /page size of (\d+) bytes/u.exec(text);
  if (pageSize === null) {
    return err(LiveMachineErrors.vmStatIncomplete({ field: "page size" }));
  }
  // Anonymous less purgeable, plus wired and compressed: each line's pages, signed by how it counts.
  let pages = 0;
  for (const { label, sign } of [
    { label: VM_STAT_FIELDS.anonymous, sign: 1 },
    { label: VM_STAT_FIELDS.purgeable, sign: -1 },
    { label: VM_STAT_FIELDS.wired, sign: 1 },
    { label: VM_STAT_FIELDS.compressed, sign: 1 },
  ]) {
    const count = vmStatCount({ label, text });
    if (count === undefined) {
      return err(LiveMachineErrors.vmStatIncomplete({ field: label }));
    }
    pages += sign * count;
  }
  return ok(pages * Number(pageSize.at(1)));
}

/**
 * `ps`'s `time` column in milliseconds. macOS prints minutes, which run past sixty, then seconds to the hundredth
 * (`4571:18.13`); a `[dd-]hh:mm:ss` form is read too, so another `ps` is not misread as minutes.
 *
 * @returns the milliseconds, or `undefined` for a shape neither form matches
 */
export function cpuTimeMsOf({ time }: { time: string }): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/u.exec(time);
  if (match === null) {
    return undefined;
  }
  // A form with no day or hour field has spent none: zero there is the reading, not a fallback.
  const dayField = match.at(1);
  const hourField = match.at(2);
  const days = dayField === undefined ? 0 : Number(dayField);
  const hours = hourField === undefined ? 0 : Number(hourField);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return Math.round((((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000);
}

/**
 * Decode `ps -axww -o pid=,ppid=,time=,rss=,comm=`. `comm` is the sole trailing field, so everything after the
 * fourth column is it, spaces included (`Google Chrome Helper (Renderer).app/…`). A line that will not decode is
 * counted rather than guessed at.
 *
 * @param text the raw listing
 * @returns the rows, and how many lines were refused
 */
export function parseProcessStats({ text }: { text: string }): {
  readonly rows: readonly LiveProcessStat[];
  readonly refused: number;
} {
  const rows: LiveProcessStat[] = [];
  let refused = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/u.exec(line);
    const time = match?.at(3);
    const cpuTimeMs = time === undefined ? undefined : cpuTimeMsOf({ time });
    const comm = match?.at(5);
    if (match === null || cpuTimeMs === undefined || comm === undefined) {
      refused += 1;
      continue;
    }
    rows.push({
      comm: comm.trim(),
      cpuTimeMs,
      pid: Number(match[1]),
      ppid: Number(match[2]),
      residentBytes: Number(match[4]) * 1024,
    });
  }
  return { refused, rows };
}

/**
 * Decode `ps -axww -o pid=,args=`: every pid's whole command line, which only classifies a process as fleet and finds
 * a session's `--session-id`. It is never displayed.
 *
 * @param text the raw listing
 * @returns argv by pid
 */
export function parseArgvRows({ text }: { text: string }): ReadonlyMap<number, string> {
  const argv = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    const args = match?.at(2);
    if (match !== null && args !== undefined) {
      argv.set(Number(match[1]), args);
    }
  }
  return argv;
}

/**
 * The compressor's segments in use against their limit, a whole percentage — the figure the supervisor's memory
 * hold is graded on (`src/live/machine/capacityParse.ts#parseCompressorSysctl`).
 *
 * @param text `sysctl vm.compressor.segment.total vm.compressor.segment.limit`'s output
 * @returns the percentage, or `undefined` when either line is absent or the limit is zero
 */
export function compressorSegmentsPctOf({ text }: { text: string }): number | undefined {
  const used = /^vm\.compressor\.segment\.total:\s*(\d+)\s*$/mu.exec(text);
  const limit = /^vm\.compressor\.segment\.limit:\s*(\d+)\s*$/mu.exec(text);
  if (used === null || limit === null || Number(limit[1]) <= 0) {
    return undefined;
  }
  return Math.round((Number(used[1]) / Number(limit[1])) * 100);
}

/**
 * How many entries are swapfiles: named `<prefix basename><digits>`, the way the kernel names them under
 * `vm.swapfileprefix` (`/System/Volumes/VM/swapfile` → `swapfile0`). The `sleepimage` beside them is not one.
 *
 * @param prefix `sysctl -n vm.swapfileprefix`'s value
 * @param entries the names in the prefix's directory
 * @returns the count
 */
export function countSwapfiles({ prefix, entries }: { prefix: string; entries: readonly string[] }): number {
  const trimmed = prefix.trim();
  const stem = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return entries.filter((entry) => entry.startsWith(stem) && /^\d+$/u.test(entry.slice(stem.length))).length;
}
