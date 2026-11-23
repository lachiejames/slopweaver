/**
 * The CPU `machine capacity`'s process table cannot see — the pure half.
 *
 * ## Why a protected process is invisible to the rest of this gauge
 *
 * MEASURED: the verdict named the Docker VM as the top foreign hog while the owner's Activity Monitor showed
 * `com.example.endpoint.Agent` at 285.7% CPU and 6.58 GB — the largest CPU consumer on the machine.
 * Re-measured without sudo:
 *
 * - `top` leaves every endpoint-sensor process out of its table entirely — the systemextension and its XPC services
 *   under `/Applications/Endpoint.app`. The MDM agent's endpoint-security systemextension beside it IS listed, so
 *   this is the sensor's tamper protection refusing task stats, not a property of system extensions.
 * - `ps` still LISTS those processes, at `rss 0` and `time 0:00.00`.
 * - `powermetrics` and `footprint(1)` both need root, and `sudo -n` asks for a password, so neither is a
 *   source a sweep tick can read.
 *
 * ## What is established, and what is not
 *
 * A process is named HIDDEN only when both readings agree: `ps` lists it live (not a zombie) at `rss 0`, AND
 * the final sample of `top`'s own full table does not carry its pid. Zero RSS alone is not enough — a stopped
 * process paged out entirely reads the same in `ps`, but `top` still lists it.
 * On this machine the two readings together selected the eight endpoint-sensor processes out of 986. WHY it is hidden
 * is inferred, never measured, and a hidden process's memory has no unprivileged source, so nothing here
 * estimates it.
 *
 * The CPU reading is a RESIDUAL: `top`'s own `CPU usage:` header counts every process, hidden or not, while
 * its per-process rows count only the ones it may see. On the final sample of `top -l 2`, busy cores
 * (`(user% + sys%) x hw.ncpu / 100`) less the sum of the per-process `%CPU` rows read 2.2, 2.1 and 3.2 cores at
 * `-s 3` and 2.9, 1.0 and 2.0 cores at `-s 1`, the order of the owner's 285.7% screenshot. It also carries every
 * process that exited between samples — 8.7 cores during a `yarn validate:local` lap at load 25 — so it is
 * UNATTRIBUTED CPU, never "the sensor's CPU", and the verdict prints it only beside a hidden process.
 *
 * Reproduce: `ps -ax -o pid=,rss=,stat=,comm= | awk '$2==0 && $3 !~ /Z/'` for the zero-RSS set, and
 * `top -l 2 -s 1 -stats pid,cpu` for the table it is checked against and the two numbers the residual is the
 * difference of.
 */
import { posix } from "node:path";

/** One `ps -ax -o pid=,rss=,stat=,comm=` row — `comm` last, so its embedded spaces survive. */
export interface ProcessStatRow {
  readonly pid: number;
  /** Resident size in KiB. */
  readonly rssKb: number;
  readonly stat: string;
  readonly comm: string;
}

/** The final sample of `top -l 2 -stats pid,cpu`: busy CPU per its header, and what its own rows account for. */
export interface TopCpuSample {
  /** `user% + sys%` from the final sample's `CPU usage:` header — a percentage of the WHOLE machine. */
  readonly busyPct: number;
  /** `idle%` from the same header — the whole-machine figure Activity Monitor's CPU Load panel shows. */
  readonly idlePct: number;
  /** The sum of the final sample's per-process `%CPU` — 100 is one core. */
  readonly visiblePct: number;
  /** Every pid the final sample's table carries. */
  readonly visiblePids: readonly number[];
}

/** The CPU the process table cannot attribute, and which processes are hidden from it. */
export interface HiddenCpuReading {
  /**
   * `top`'s whole-machine idle percentage, or `undefined` when the sample was unreadable. Needs no core count,
   * and grades the load hold (`./capacityHolds.ts`'s `cpuLoadHolding`). Kept as `top` printed it, never rounded:
   * 19.96% rounded to one place reads 20 and would clear a hold the machine is under.
   */
  readonly idlePct: number | undefined;
  /** Busy cores per `top`'s header, or `undefined` when the sample or the core count was unreadable. */
  readonly busyCores: number | undefined;
  /** Cores `top`'s own rows account for, or `undefined` when the sample or the core count was unreadable. */
  readonly visibleCores: number | undefined;
  /** `busyCores - visibleCores`, floored at zero, or `undefined` when either side was unreadable. */
  readonly unattributedCores: number | undefined;
  /**
   * Labels of the live zero-RSS processes the sample's table does not carry, a systemextension first. Empty
   * when the sample was unreadable — without the table, "hidden from top" cannot be established.
   */
  readonly hiddenFromTop: readonly string[];
}

/** One decimal place — the precision the rest of this gauge prints. */
function round1({ value }: { value: number }): number {
  return Math.round(value * 10) / 10;
}

/**
 * Decode a `ps -ax -o pid=,rss=,stat=,comm=` listing. A line that is not `<pid> <rss> <stat> <comm>` is
 * skipped rather than failing the whole read.
 *
 * @param text the raw listing
 * @returns one row per decodable line, in the order `ps` printed them
 */
export function parseProcessStatRows({ text }: { text: string }): readonly ProcessStatRow[] {
  const rows: ProcessStatRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const [pid, rss, stat] = trimmed.split(/\s+/u);
    const comm = trimmed.replace(/^\S+\s+\S+\s+\S+\s+/u, "");
    if (pid === undefined || rss === undefined || stat === undefined || comm === trimmed) {
      continue;
    }
    if (!/^\d+$/u.test(pid) || !/^\d+$/u.test(rss)) {
      continue;
    }
    rows.push({ comm, pid: Number(pid), rssKb: Number(rss), stat });
  }
  return rows;
}

/**
 * The final sample's `CPU usage:` header and its own table, or `undefined` when either is absent or damaged.
 * The table must carry exactly the `Processes: N total` its sample opened with: `top`'s own total counts only
 * the processes its table lists (920/920, 928/928, 945/945 on three captures, with the endpoint sensor's eight
 * hidden from both), so a table cut off at a row boundary is refused rather than summed.
 */
function parseOneSample({ lines }: { lines: readonly string[] }): TopCpuSample | undefined {
  const total = lines.length === 0 ? null : /^Processes:\s*(\d+) total/u.exec(lines[0]!);
  const header = lines
    .map((line) => /^CPU usage:\s*(\d+(?:\.\d+)?)% user,\s*(\d+(?:\.\d+)?)% sys,\s*(\d+(?:\.\d+)?)% idle/u.exec(line))
    .find((match) => match !== null);
  const headingIndex = lines.findIndex((line) => /^PID\s+%CPU\s*$/u.test(line));
  const rows = lines.slice(headingIndex + 1).filter((line) => line.trim().length > 0);
  if (total === null || header == null || headingIndex < 0 || rows.length === 0) {
    return undefined;
  }
  // top's user, sys and idle percentages summed to 99.98-99.99 on six captures.
  if (
    Number(total[1]) !== rows.length ||
    Math.abs(Number(header[1]) + Number(header[2]) + Number(header[3]) - 100) > 1
  ) {
    return undefined;
  }
  let visiblePct = 0;
  const visiblePids: number[] = [];
  for (const row of rows) {
    const [pid, cpu, extra] = row.trim().split(/\s+/u);
    if (pid === undefined || cpu === undefined || extra !== undefined) {
      return undefined;
    }
    if (!/^\d+$/u.test(pid) || !/^\d+(?:\.\d+)?$/u.test(cpu)) {
      return undefined;
    }
    visiblePct += Number(cpu);
    visiblePids.push(Number(pid));
  }
  return { busyPct: Number(header[1]) + Number(header[2]), idlePct: Number(header[3]), visiblePct, visiblePids };
}

/**
 * Decode `top -l 2 -s <n> -stats pid,cpu`. The FIRST sample's per-process `%CPU` is always zero — `top` has no
 * interval to measure over yet — so only the final sample is read, bound to its own header and table. A report
 * with fewer than two samples, no trailing newline, or a final sample lacking a header whose percentages sum to
 * 100, a table, a well-formed row, or the row count its own `Processes: N total` promises, is refused rather
 * than read as measured.
 *
 * @param text the raw `top` output
 * @returns the final sample's busy and visible percentages and its pids, or `undefined` when unreadable
 */
export function parseTopCpuSample({ text }: { text: string }): TopCpuSample | undefined {
  const samples: string[][] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("Processes:")) {
      samples.push([]);
    }
    samples.at(-1)?.push(line);
  }
  // top ends every report with a newline (six of six captures), so text without one was cut off.
  const complete = text.endsWith("\n") && samples.length >= 2;
  const last = samples.at(-1);
  return !complete || last === undefined ? undefined : parseOneSample({ lines: last });
}

/**
 * The processes hidden from `top`: live (not a zombie), reading zero resident memory in `ps`, and absent from
 * the sample's own table. A systemextension leads, then ascending pid, so the sensor itself — not one of its
 * helpers — is the name a verdict prints first.
 *
 * @param rows the decoded `ps` table
 * @param visiblePids every pid `top`'s final sample carries
 * @returns each hidden process's basename, de-duplicated, in that order
 */
export function hiddenFromTopLabels({
  rows,
  visiblePids,
}: {
  rows: readonly ProcessStatRow[];
  visiblePids: readonly number[];
}): readonly string[] {
  const visible = new Set(visiblePids);
  const hidden = rows
    .filter((row) => row.rssKb === 0 && !row.stat.includes("Z") && row.comm !== "<defunct>" && !visible.has(row.pid))
    .toSorted((a, b) => {
      const aExtension = a.comm.includes(".systemextension/") ? 0 : 1;
      const bExtension = b.comm.includes(".systemextension/") ? 0 : 1;
      return aExtension - bExtension || a.pid - b.pid;
    });
  return [...new Set(hidden.map((row) => posix.basename(row.comm)))];
}

/**
 * Read the sample, the core count and the `ps` table into one reading. Each number is `undefined` rather than
 * zero when an input it needs was unreadable, so an unmeasured residual never prints as `0 cores`.
 *
 * @param cpuSampleText the raw `top -l 2 -s 1 -stats pid,cpu` output, or `undefined` when the read failed
 * @param cores the machine's core count, which turns `top`'s whole-machine percentage into cores
 * @param statRows the decoded `ps -ax -o pid=,rss=,stat=,comm=` table
 * @returns the reading
 */
export function hiddenCpuReading({
  cpuSampleText,
  cores,
  statRows,
}: {
  cpuSampleText: string | undefined;
  cores: number | undefined;
  statRows: readonly ProcessStatRow[];
}): HiddenCpuReading {
  const sample = cpuSampleText === undefined ? undefined : parseTopCpuSample({ text: cpuSampleText });
  const coreCount = cores !== undefined && Number.isSafeInteger(cores) && cores > 0 ? cores : undefined;
  // All three numbers stand or fall together, so a reading never carries a lone visible figure.
  const visible = sample === undefined || coreCount === undefined ? undefined : sample.visiblePct / 100;
  const busy = sample === undefined || coreCount === undefined ? undefined : (sample.busyPct / 100) * coreCount;
  const unattributed = busy === undefined || visible === undefined ? undefined : Math.max(0, busy - visible);
  return {
    busyCores: busy === undefined ? undefined : round1({ value: busy }),
    hiddenFromTop: sample === undefined ? [] : hiddenFromTopLabels({ rows: statRows, visiblePids: sample.visiblePids }),
    idlePct: sample === undefined ? undefined : sample.idlePct,
    unattributedCores: unattributed === undefined ? undefined : round1({ value: unattributed }),
    visibleCores: visible === undefined ? undefined : round1({ value: visible }),
  };
}

/**
 * The clause the verdict folds in beside the top foreign hog — present only when a process is hidden from
 * `top`, because a residual with nothing hidden is processes that exited between samples, not a blind spot.
 *
 * @param reading the hidden-CPU reading
 * @returns e.g. `hidden from top: 'com.example.endpoint.Agent' +7 more, 2.9 cores of cpu unattributed`, or
 *   `undefined` when nothing is hidden
 */
export function hiddenCpuClause({ reading }: { reading: HiddenCpuReading }): string | undefined {
  const [first, ...rest] = reading.hiddenFromTop;
  if (first === undefined) {
    return undefined;
  }
  const names = rest.length === 0 ? `'${first}'` : `'${first}' +${String(rest.length)} more`;
  const cpu =
    reading.unattributedCores === undefined
      ? "unattributed cpu unmeasured"
      : `${String(reading.unattributedCores)} cores of cpu unattributed`;
  return `hidden from top: ${names}, ${cpu}`;
}

/**
 * The text report's lines for this reading: the residual when it was measured, and the hidden processes when
 * there are any.
 *
 * @param reading the hidden-CPU reading
 * @returns zero, one or two lines, in display order
 */
export function hiddenCpuLines({ reading }: { reading: HiddenCpuReading }): readonly string[] {
  const { busyCores, visibleCores, unattributedCores, hiddenFromTop, idlePct } = reading;
  const lines: string[] = [];
  const idle = idlePct === undefined ? "" : `${String(idlePct)}% idle, `;
  if (busyCores !== undefined && visibleCores !== undefined && unattributedCores !== undefined) {
    lines.push(
      `cpu: ${idle}${String(busyCores)} cores busy, ${String(visibleCores)} visible per process, ${String(unattributedCores)} unattributed`,
    );
  } else if (idlePct !== undefined) {
    lines.push(`cpu: ${String(idlePct)}% idle`);
  }
  if (hiddenFromTop.length > 0) {
    lines.push(`hidden from top (rss 0, absent from its table): ${hiddenFromTop.join(", ")}`);
  }
  return lines;
}
