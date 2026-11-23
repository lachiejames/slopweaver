/**
 * Decoding what `top`, `sysctl` and `ps` actually PRINTED — the parse edge of `slopweaver machine capacity`,
 * pure, and split from `./capacity.ts` when that file crossed the size ratchet. The seam is one-way by
 * construction: nothing here knows a threshold, a verdict or a subject, so it can be read and tested on its
 * own, and `./capacity.ts` imports it rather than the other way round.
 *
 * Every shape here is a TOOL's output format rather than a domain concept, which is why the measurements
 * that justify reading these particular columns live in `./capacity.ts`'s header — this file answers only
 * "what did that text say".
 */

/** The three-number load average `top`'s own header line reports, same shape as `uptime`. */
export interface LoadAverage {
  readonly load1: number;
  readonly load5: number;
  readonly load15: number;
}

/** One process's memory footprint, decoded from `top`'s `mem` column — bytes, not yet classified. */
interface TopProcessFootprint {
  readonly pid: number;
  readonly footprintBytes: number;
}

/** How much swap is in use, decoded from `sysctl vm.swapusage`. */
export interface SwapUsage {
  readonly usedGb: number;
  readonly totalGb: number;
}

/**
 * How full the VM compressor is, decoded from `sysctl vm.compressor.segment.total vm.compressor.segment.limit
 * vm.compressor_segment_pages_compressed vm.compressor_segment_pages_compressed_limit` — the two ratios the
 * kernel's own panic line prints as "N% of compressed pages limit" and "N% of segments limit".
 */
export interface CompressorGauge {
  readonly segmentsUsed: number;
  readonly segmentsLimit: number;
  /** `segmentsUsed` as a whole percentage of `segmentsLimit` — the number the panic log graded BAD at 100. */
  readonly segmentsPct: number;
  /** Compressed pages as a whole percentage of their limit, or `undefined` when either oid was absent. */
  readonly compressedPagesPct: number | undefined;
}

const UNIT_MULTIPLIER: Readonly<Record<string, number>> = {
  B: 1,
  G: 1024 * 1024 * 1024,
  K: 1024,
  M: 1024 * 1024,
  T: 1024 * 1024 * 1024 * 1024,
};

/**
 * Decode `top -l 1 -o mem -stats pid,mem`'s report: the load-average header line, plus one footprint per
 * process in the table `-stats pid,mem` prints. A line that is not `<pid> <number><unit>` — every header,
 * blank line and the `PID  MEM` column heading itself — is skipped rather than failing the whole read.
 *
 * @param text the raw `top` output
 * @returns the decoded load average (`undefined` when the header line was not found) and every process row,
 *   in `top`'s own sort order
 */
export function parseTopMemReport({ text }: { text: string }): {
  readonly load: LoadAverage | undefined;
  readonly processes: readonly TopProcessFootprint[];
} {
  const loadMatch = /Load Avg:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/u.exec(text);
  // Every group in that pattern is mandatory, so a match proves all three are there — an honest `!` rather
  // than a zero, which would report a machine at load 0 on a header shape that changed under us.
  const load =
    loadMatch === null
      ? undefined
      : { load1: Number(loadMatch[1]!), load15: Number(loadMatch[3]!), load5: Number(loadMatch[2]!) };
  const processes: TopProcessFootprint[] = [];
  for (const line of text.split("\n")) {
    // A trailing `+`/`-` is top's change marker on a second-or-later sample (`top -l 2 -o mem -stats pid,mem`
    // prints them; `-l 1` does not): a dropped row would hide a heavy process from every reader of this list.
    const match = /^\s*(\d+)\s+(\d+(?:\.\d+)?)([BKMGT])[+-]?\s*$/u.exec(line);
    if (match === null) {
      continue;
    }
    // Same reasoning: all three groups are mandatory, and the unit group can only match a key this map has.
    const unit = match[3]!;
    processes.push({
      footprintBytes: Math.round(Number(match[2]!) * UNIT_MULTIPLIER[unit]!),
      pid: Number(match[1]!),
    });
  }
  return { load, processes };
}

/**
 * Decode `sysctl -n vm.loadavg`'s one line (`{ 8.97 10.36 10.04 }`) — the same three numbers `top`'s header
 * prints, without the second of `top` a spawn cannot afford on a healthy machine.
 *
 * @param text the raw `sysctl` output
 * @returns the load average, or `undefined` when the line did not parse
 */
export function parseSysctlLoadavg({ text }: { text: string }): LoadAverage | undefined {
  const match = /^\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}\s*$/u.exec(text.trim());
  // All three groups are mandatory, so a match proves each capture is present.
  return match === null ? undefined : { load1: Number(match[1]!), load15: Number(match[3]!), load5: Number(match[2]!) };
}

/**
 * Decode `sysctl vm.swapusage`'s one line (`vm.swapusage: total = 4096.00M used = 2461.94M free = …`).
 *
 * @param text the raw `sysctl` output
 * @returns the used/total swap in GB, or `undefined` when the line did not parse
 */
export function parseSwapUsage({ text }: { text: string }): SwapUsage | undefined {
  const used = /used\s*=\s*([\d.]+)([MG])/u.exec(text);
  const total = /total\s*=\s*([\d.]+)([MG])/u.exec(text);
  if (used === null || total === null) {
    return undefined;
  }
  const toGb = ({ value, unit }: { value: string; unit: string }): number => Number(value) / (unit === "G" ? 1 : 1024);
  // Both groups of both patterns are mandatory, so a match proves each capture is present.
  return {
    totalGb: Math.round(toGb({ unit: total[2]!, value: total[1]! }) * 10) / 10,
    usedGb: Math.round(toGb({ unit: used[2]!, value: used[1]! }) * 10) / 10,
  };
}

/** The value of one `name: value` sysctl line in `text`, or `undefined` when the oid is absent or not a whole number. */
function sysctlUint({ text, oid }: { text: string; oid: string }): number | undefined {
  const escaped = oid.replaceAll(".", "\\.");
  const match = new RegExp(`^${escaped}:\\s*(\\d+)\\s*$`, "mu").exec(text);
  return match === null ? undefined : Number(match[1]);
}

/** `used` as a whole percentage of `limit`, or `undefined` when there is no limit to divide by. */
function wholePct({ used, limit }: { used: number; limit: number }): number | undefined {
  return limit > 0 ? Math.round((used / limit) * 100) : undefined;
}

/**
 * Decode the compressor's four `sysctl` lines into the two ratios the panic log grades. The segment pair is
 * mandatory — without it there is no gauge — while the compressed-pages pair is carried when present and
 * `undefined` otherwise, since the segment ratio is the one that reached 100% at the kernel panic.
 *
 * @param text the raw `sysctl` output, one `oid: value` line per oid
 * @returns the gauge, or `undefined` when `vm.compressor.segment.total`/`.limit` did not both parse
 */
export function parseCompressorSysctl({ text }: { text: string }): CompressorGauge | undefined {
  const segmentsUsed = sysctlUint({ oid: "vm.compressor.segment.total", text });
  const segmentsLimit = sysctlUint({ oid: "vm.compressor.segment.limit", text });
  const segmentsPct =
    segmentsUsed === undefined || segmentsLimit === undefined
      ? undefined
      : wholePct({ limit: segmentsLimit, used: segmentsUsed });
  if (segmentsUsed === undefined || segmentsLimit === undefined || segmentsPct === undefined) {
    return undefined;
  }
  const pages = sysctlUint({ oid: "vm.compressor_segment_pages_compressed", text });
  const pagesLimit = sysctlUint({ oid: "vm.compressor_segment_pages_compressed_limit", text });
  const compressedPagesPct =
    pages === undefined || pagesLimit === undefined ? undefined : wholePct({ limit: pagesLimit, used: pages });
  return { compressedPagesPct, segmentsLimit, segmentsPct, segmentsUsed };
}

/**
 * Count the swapfiles in a directory listing — the entries named `<prefix basename><digits>`, which is how
 * the kernel names them under `vm.swapfileprefix` (`/System/Volumes/VM/swapfile` → `swapfile0`, `swapfile1`,
 * …). The `sleepimage` beside them, and anything else, is not one.
 *
 * @param prefix the value of `sysctl -n vm.swapfileprefix` — a path whose basename is the name stem
 * @param entries the names in the prefix's directory
 * @returns how many entries are swapfiles
 */
export function countSwapfiles({ prefix, entries }: { prefix: string; entries: readonly string[] }): number {
  const stem = basename({ path: prefix.trim() });
  return entries.filter((entry) => entry.startsWith(stem) && /^\d+$/u.test(entry.slice(stem.length))).length;
}

/** One process's short command name, decoded from `ps -ax -o pid=,comm=` — never split on whitespace. */
export interface ProcessComm {
  readonly pid: number;
  /** The full path `comm` printed, spaces and all — `comm` is always the LAST field, so this is never truncated. */
  readonly comm: string;
}

/**
 * Decode a `ps -ax -o pid=,comm=` listing. `comm` is the sole trailing field, so — unlike an argv line, which
 * carries flag values a naive split would mistake for more fields — everything after the pid belongs to it,
 * spaces included: an app bundle's own path (`Google Chrome Helper (Renderer).app/…`) is common here.
 *
 * @param text the raw listing
 * @returns one row per decodable line, in the order `ps` printed them
 */
export function parseCommRows({ text }: { text: string }): readonly ProcessComm[] {
  const rows: ProcessComm[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const gap = trimmed.search(/\s/u);
    const pid = gap < 0 ? "" : trimmed.slice(0, gap);
    const comm = trimmed.slice(gap + 1).trimStart();
    if (!/^\d+$/u.test(pid) || comm.length === 0) {
      continue;
    }
    rows.push({ comm, pid: Number(pid) });
  }
  return rows;
}

/**
 * A path's own basename — the last `/`-delimited segment, or the whole path when it has none.
 *
 * @param path the path to take the last segment of
 * @returns the basename, or the whole path when it carries no separator
 */
export function basename({ path }: { path: string }): string {
  const segments = path.split("/");
  const base = segments.at(-1);
  return base === undefined || base.length === 0 ? path : base;
}
