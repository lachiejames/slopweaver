/**
 * Which registry records are a seat that is running NOW — the record's own process, never one that inherited its pid.
 *
 * Claude Code leaves a session's registry file behind when the session dies, and the OS hands its pid to whatever
 * starts next. A pid alone would then paint a dead supervisor green off its old reorientation, or keep a dead worker
 * yellow for good. So a record is live only when the process at its pid started exactly when
 * the record says its own did: `TZ=UTC LC_ALL=C ps -o lstart=` prints `procStart` byte for byte
 * (`../claude/seatBootRead.ts`, measured 12 of 12).
 */
import { err, ok, type Result } from "#lib/result.js";
import type { SessionScan } from "../sessions/liveSessionStore.js";
import type { SessionRecord } from "../sessions/liveSessions.js";

/**
 * One `ps` row under the C locale: a pid, then a whole `lstart` stamp (`Www Mmm  D HH:MM:SS YYYY`) of a real weekday,
 * month, day and time, then padding. A stamp of that shape is taken as `/bin/ps` wrote it.
 */
const PROCESS_START_ROW =
  /^ *(\d+) ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: [1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d \d{4}) *$/u;

/**
 * Each pid's start stamp from one `ps -ax -o pid=,lstart=` listing.
 *
 * A row that is not a pid and a WHOLE stamp fails the whole read: a skipped row is a running process the caller would
 * call gone, and a truncated stamp one it would call a stranger, so either way a seat live elsewhere reads as resumable
 * and is typed a second time. MEASURED: 0 of 827 rows off that shape:
 * `TZ=UTC LC_ALL=C /bin/ps -ax -o pid=,lstart= | grep -cvE '^ *[0-9]+ (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] [0-9]{4} *$'`.
 *
 * @param text the listing's stdout, taken under `TZ=UTC LC_ALL=C`
 * @returns the start stamp per pid, blank lines skipped; the first unreadable row when there is one
 */
export function parseProcessStarts({ text }: { text: string }): Result<ReadonlyMap<number, string>, string> {
  const starts = new Map<number, string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const match = PROCESS_START_ROW.exec(line);
    if (match === null) {
      return err(`the process listing holds a row that is not a pid and a whole start stamp: ${JSON.stringify(line)}`);
    }
    starts.set(Number(match[1]), match[2]!);
  }
  return ok(starts);
}

/**
 * Whether a registry record is a live, interactive terminal session: its pid runs, and runs the process it recorded.
 *
 * A record with no start stamp cannot be told apart from a stranger on its pid, so it is not live.
 *
 * @param record the registry record
 * @param starts each running pid's start stamp
 * @returns true only when the process at the pid started when the record says its own did
 */
export function isLiveSeat({
  record,
  starts,
}: {
  record: SessionRecord;
  starts: ReadonlyMap<number, string>;
}): boolean {
  if (record.kind !== "interactive" || record.entrypoint !== "cli" || record.procStart === undefined) {
    return false;
  }
  return starts.get(record.pid) === record.procStart.trim();
}

/**
 * The live seats one registry scan holds — or why the scan cannot say. A file the scan refused is a session nobody can
 * name, so it might be the one a caller is about to call "not live" and act on: the whole read fails CLOSED rather
 * than answer for it (`../sessions/liveSessionStore.ts` chooses the same direction for a vanished file).
 * MEASURED: the real registry held 7 records and refused none, so a healthy machine pays nothing:
 * `node --input-type=module -e 'const m = await import("./dist-cli/sessions/liveSessionStore.js"); const s = m.scanSessions({ sessionsDir: process.env.HOME + "/.claude/sessions" }); console.log(s.records.length, s.refused)'`
 *
 * Unlike {@link isLiveSeat} this does NOT filter on `kind` or `entrypoint`: the decoder reads a wrong-typed field as
 * `""`, so a filter on one would drop a running session it could not read, and the cold path only asks whether a
 * session runs ANYWHERE. Any record whose pid runs the process it recorded counts. A running record
 * with no start stamp, or with no session id, fails the read: that process may be the session, and nothing can say
 * MEASURED: 9 of 9 records stamped: `jq -s '[.[] | .procStart | type]' ~/.claude/sessions/*.json`.
 *
 * @param scan what the registry scan found, the files it refused included
 * @param starts each running pid's start stamp
 * @returns every record whose own process runs now, or why the registry cannot say
 */
export function liveSeatsFromScan({
  scan,
  starts,
}: {
  scan: SessionScan;
  starts: ReadonlyMap<number, string>;
}): Result<readonly SessionRecord[], string> {
  return wholeRegistry({ scan }).andThen((records) => {
    const running = records.filter((record) => starts.has(record.pid));
    const unreadable = running.find((record) => record.procStart === undefined || record.sessionId === "");
    if (unreadable !== undefined) {
      return err(
        `a registry record on running pid ${String(unreadable.pid)} names no start stamp or session id, so whether its session is live cannot be read`,
      );
    }
    // Every running record carries a stamp: the find above refused the read on the first one that did not.
    return ok(running.filter((record) => starts.get(record.pid) === record.procStart!.trim()));
  });
}

/**
 * Every record one registry scan holds, or why the scan cannot say — failing closed on a refused file for the same
 * reason {@link liveSeatsFromScan} does: the reseat pass picks the record whose pid is in a tab, and a record it
 * could not read is one it would miss.
 *
 * @param scan what the registry scan found, the files it refused included
 * @returns every record, or the unreadable directory or refused files
 */
export function wholeRegistry({ scan }: { scan: SessionScan }): Result<readonly SessionRecord[], string> {
  if (scan.unreadable !== undefined) {
    return err(scan.unreadable);
  }
  if (scan.refused.length > 0) {
    return err(`the session registry holds files that would not read: ${scan.refused.join("; ")}`);
  }
  return ok(scan.records);
}
