/**
 * The cmux APP's process, picked out of one `ps` listing — never the `cmux` CLI bundled beside it, which shares its
 * name and runs in every seat's shell — and whether a process descends from it, which is why a restart may not be
 * run from inside cmux: the verb would be killed with the app it is restarting.
 *
 * Pure: the listing's text in, rows and answers out. The listing is `./reviveEffects.ts`.
 */
import { lstartMs } from "#lib/lstart.js";
import { err, ok, type Result } from "#lib/result.js";

/** The app's executable, as `ps -o comm=` prints it for `/Applications/cmux.app` or any other install of it. */
const APP_SUFFIX = ".app/Contents/MacOS/cmux";

/**
 * Whether a `ps` command or argv is the cmux APP's — `/Applications/cmux.app/Contents/MacOS/cmux` or any other install
 * of the bundle — and never the `cmux` CLI beside it. Over an `args=` column the executable is the first field.
 *
 * @param command the `comm=` or `args=` column
 * @returns true for the app's executable
 */
export function isCmuxAppCommand({ command }: { command: string }): boolean {
  const [executable] = command.split(" ");
  return executable?.endsWith(APP_SUFFIX) === true;
}

/** One `ps -ax -o pid=,ppid=,lstart=,comm=` row. */
export interface PsRow {
  readonly pid: number;
  readonly ppid: number;
  /** The start stamp `lstart` prints under the C locale: weekday, month, day, clock time, year. */
  readonly start: string;
  readonly command: string;
}

/** `pid`, `ppid` and the five `lstart` fields come before the command. */
const HEAD_FIELDS = 7;

/** A whole field of digits. */
const DIGITS = /^\d+$/u;

/**
 * One row: `pid ppid` then the five `lstart` fields, then the command — which may itself carry spaces. Scanned
 * field by field rather than matched whole, so no line can make the parse backtrack.
 */
function parseRow({ line }: { line: string }): PsRow | undefined {
  const fields = /\S+/gu;
  const head: { text: string; from: number; to: number }[] = [];
  for (let match = fields.exec(line); match !== null; match = fields.exec(line)) {
    head.push({ from: match.index, text: match[0], to: fields.lastIndex });
    if (head.length === HEAD_FIELDS) {
      break;
    }
  }
  const pid = head[0];
  const ppid = head[1];
  const startFrom = head[2];
  const startTo = head[HEAD_FIELDS - 1];
  if (pid === undefined || ppid === undefined || startFrom === undefined || startTo === undefined) {
    return undefined;
  }
  const command = line.slice(startTo.to).trim();
  if (command === "" || !DIGITS.test(pid.text) || !DIGITS.test(ppid.text)) {
    return undefined;
  }
  return { command, pid: Number(pid.text), ppid: Number(ppid.text), start: line.slice(startFrom.from, startTo.to) };
}

/**
 * Parse the listing, skipping any line that is not a row.
 *
 * @param text the listing `ps -ax -o pid=,ppid=,lstart=,comm=` printed
 * @returns every row
 */
export function parsePsRows({ text }: { text: string }): readonly PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const row = parseRow({ line });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Parse the listing WHOLE: a line that is not a row fails the read, never skipped. For a caller concluding a process
 * is ABSENT — a skipped row is a running process it would never see.
 *
 * @param text the listing `ps -ax -o pid=,ppid=,lstart=,comm=` printed
 * @returns every row, blank lines skipped; the first unreadable line when there is one
 */
export function parsePsRowsStrict({ text }: { text: string }): Result<readonly PsRow[], string> {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const row = parseRow({ line });
    if (row === undefined) {
      return err(
        `the process listing holds a line that is not a pid, ppid, start and command: ${JSON.stringify(line)}`,
      );
    }
    rows.push(row);
  }
  return ok(rows);
}

/**
 * When a process started, from its `lstart`. The listing runs under `TZ=UTC` (`./reviveEffects.ts`) and the stamp
 * carries no zone, so it is read as UTC here: parsed as local time it would land the zone's offset away.
 *
 * @param start the stamp, in the C-locale `lstart` shape
 * @returns epoch milliseconds, or `undefined` when the stamp is not that shape or names no real instant
 */
export function psStartMs({ start }: { start: string }): number | undefined {
  return lstartMs({ text: start });
}

/**
 * The running cmux app, the lowest pid when somehow more than one runs, so the pick is stable between probes.
 *
 * @param rows the listing
 * @returns its row, or `undefined` when cmux is not running
 */
export function cmuxAppOf({ rows }: { rows: readonly PsRow[] }): PsRow | undefined {
  const apps = rows.filter((row) => row.command.endsWith(APP_SUFFIX));
  return apps.toSorted((left, right) => left.pid - right.pid)[0];
}

/**
 * The running cmux app when exactly one runs. Two say nothing about which one's refs a client reached, so a caller
 * that compares refs across time gets no answer rather than the lowest pid's.
 *
 * @param rows the listing
 * @returns its row, or `undefined` when none or more than one runs
 */
export function soleCmuxAppOf({ rows }: { rows: readonly PsRow[] }): PsRow | undefined {
  const apps = rows.filter((row) => row.command.endsWith(APP_SUFFIX));
  return apps.length === 1 ? apps[0] : undefined;
}

/**
 * Whether `pid` is `ancestorPid` or runs under it, walking parents through the listing.
 *
 * @param rows the listing
 * @param pid the process asked about
 * @param ancestorPid the process it may run under
 * @returns whether it does
 */
export function descendsFrom({
  rows,
  pid,
  ancestorPid,
}: {
  rows: readonly PsRow[];
  pid: number;
  ancestorPid: number;
}): boolean {
  const parents = new Map(rows.map((row) => [row.pid, row.ppid]));
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 1 && !seen.has(current)) {
    if (current === ancestorPid) {
      return true;
    }
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}
