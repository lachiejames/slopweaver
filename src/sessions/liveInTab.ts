/**
 * Whether a cmux tab is running a LIVE Claude Code session, judged by the session's own process before anything about
 * the shell forest around it. Pure: what cmux reported for the tab, the process table and the live registry records
 * arrive as values.
 *
 * ## Why this is read before the graft, and never through it
 *
 * The graft (`./coldGraft.ts`) exists to prove a tab is a bare shell a typed line can safely reach, so it fails CLOSED
 * on every way the forest could hide a reader: a zombie on the tab's tty, a forest process on another tty or none, a
 * class cmux and `ps` disagree on, a root not under the cmux app, a shell outside the tty's foreground group, a pid
 * that left the table between two reads. Every one of those is ALSO what a working Claude session looks like from
 * outside: its shell sits in the background group while Claude holds the foreground, its own helpers run on `tty ??`,
 * a hook's `/bin/sh` sits where cmux last saw a `bash`, a finished child lingers `Z+` until it is reaped. MEASURED
 * (`$SLOPWEAVER_HOME/fleet/resume.jsonl`, and the handover
 * `fleet-resume-misreads-eight-live-seats-as-bare-shells-on-defunct-children-and-tty-mismatch`): run through the graft
 * first, eight live seats a pass were refused as unreadable bare shells and the live pinned chair as `NO_LIVE_SESSION`.
 *
 * So a tab is judged live on the session alone: a live registry record whose pid cmux reported for the tab, or whose
 * ancestry in the table reaches a pid cmux reported. Only `pid` and `ppid` are read while cmux reports any pid; no
 * process group, state or name is consulted, so none of those shapes can reach this answer.
 *
 * ## When cmux reports nothing for the tab
 *
 * cmux's attribution is a heuristic that can attribute NOTHING to a tab whose session runs: 0.65.2 did it under a
 * Claude prompt, and `cmux reseat` refused two running seats
 * `NO_LIVE_SESSION (no-process)` — one whose claude process had read BUSY and still ran
 * on its tab's `ttys001` afterwards. The pty itself
 * is the tie that survives: cmux sends each surface's `tty`, and `ps` places a process on its controlling tty. So with
 * no pid reported, a live record is in the tab when the tab is ONE surface with one tty and the record's own pid sits
 * on it in the table. Never the saved session cmux holds for the tab — historical intent, not a process: a tab
 * reseated elsewhere keeps the binding of a session now live in its successor.
 *
 * The callers that STOP what this names pass only start-stamp-validated live records (`../fleet/liveSeat.ts`), so a
 * reused pid on the tty is not a registry row's. The tty is never read while cmux
 * reports a pid: it is the fallback for empty attribution, not a rival to it. RESIDUE, stated: a tab whose cmux sends
 * no tty still reads `no-process` when attribution is empty, which types nothing into it.
 */
import type { CmuxProcess } from "../cmux/client.js";
import { flattenProcessTreePids, type ProcessRow, type TtyProcessRow } from "../live/standing/processes.js";
import type { SessionRecord } from "./liveSessions.js";

/** What cmux reported for one tab: its attributed trees, the tty pids it attributes to none, and its surfaces' ttys. */
export interface TabReport {
  /** How many surfaces the reply pooled for the tab: the tty tie holds for exactly one. */
  readonly surfaces: number;
  readonly trees: readonly CmuxProcess[];
  /** Each surface's own pty (`ttys001`), as `ps -o tty=` spells it. */
  readonly ttys: readonly string[];
  readonly unattributedTtyPids: readonly number[];
}

/**
 * Every pid cmux reported for the tab, attributed or listed.
 *
 * @param report what cmux reported for the tab
 * @returns those pids, each once
 */
export function reportedTabPids({ report }: { report: TabReport }): ReadonlySet<number> {
  return new Set([...flattenProcessTreePids({ roots: report.trees }), ...report.unattributedTtyPids]);
}

/**
 * Whether a pid is one cmux reported, or descends from one in the table. The walk up the parent column stops at a
 * pid the table does not hold or one it already passed, so a table that loops ends the walk rather than hanging it.
 *
 * @param pid the process to place
 * @param reported every pid cmux reported for the tab
 * @param byPid the process table by pid
 * @returns true when the pid or any table ancestor of it is reported
 */
function underReported({
  pid,
  reported,
  byPid,
}: {
  pid: number;
  reported: ReadonlySet<number>;
  byPid: ReadonlyMap<number, ProcessRow>;
}): boolean {
  const passed = new Set<number>();
  for (let at: number | undefined = pid; at !== undefined && !passed.has(at); at = byPid.get(at)?.ppid) {
    if (reported.has(at)) {
      return true;
    }
    passed.add(at);
  }
  return false;
}

/**
 * Whether one process runs in the tab: its pid is one cmux reported for the tab, or the table puts it under one. What
 * ties a pass to the workspace an inherited `CMUX_WORKSPACE_ID` names, since a screen showing its line can be a copy.
 *
 * @param pid the process to place, the caller's own for a self-close
 * @param report what cmux reported for the tab
 * @param rows the process table read beside it
 * @returns true only when cmux reported a pid for the tab and the process is, or descends from, one of them
 */
export function pidInTab({
  pid,
  report,
  rows,
}: {
  pid: number;
  report: TabReport;
  rows: readonly ProcessRow[];
}): boolean {
  const reported = reportedTabPids({ report });
  return reported.size > 0 && underReported({ byPid: new Map(rows.map((row) => [row.pid, row])), pid, reported });
}

/**
 * The live records on the tab's own pty, for a tab cmux attributed no pid to: none unless the report is one surface
 * with one tty, and then each record whose own pid the table places on that tty.
 *
 * @param report what cmux reported for the tab, holding no pid
 * @param byPid the process table by pid, each row carrying its controlling tty
 * @param liveRecords the registry records whose own process runs now
 * @returns those records, in registry order
 */
function liveSessionsOnTabTty({
  report,
  byPid,
  liveRecords,
}: {
  report: TabReport;
  byPid: ReadonlyMap<number, TtyProcessRow>;
  liveRecords: readonly SessionRecord[];
}): readonly SessionRecord[] {
  const [tty] = report.ttys;
  if (report.surfaces !== 1 || report.ttys.length !== 1 || tty === undefined) {
    return [];
  }
  return liveRecords.filter((record) => byPid.get(record.pid)?.tty === tty);
}

/**
 * The live sessions whose own process runs in the tab: its pid is one cmux reported for the tab, or the table puts it
 * under one — or, when cmux reported no pid at all, the table puts it on the tab's one tty.
 *
 * @param report what cmux reported for the tab
 * @param rows the process table read beside it, each row with its controlling tty
 * @param liveRecords the registry records whose own process runs now
 * @returns those records, in registry order; none when cmux reported nothing for the tab and the tty ties none
 */
export function liveSessionsInTab({
  report,
  rows,
  liveRecords,
}: {
  report: TabReport;
  rows: readonly TtyProcessRow[];
  liveRecords: readonly SessionRecord[];
}): readonly SessionRecord[] {
  const reported = reportedTabPids({ report });
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  if (reported.size === 0) {
    return liveSessionsOnTabTty({ byPid, liveRecords, report });
  }
  return liveRecords.filter((record) => underReported({ byPid, pid: record.pid, reported }));
}

/**
 * The live sessions whose process tree TOUCHES the tab: one {@link liveSessionsInTab} names, or one with a pid cmux
 * reported for the tab among its descendants in the table (cmux reporting only a
 * session's child left the tab to the graft). For the never-type answer alone — a session's child in a tab is reason
 * enough not to type there, never reason to nudge it — so the chair's hosting check stays on the narrower read.
 *
 * @param report what cmux reported for the tab
 * @param rows the process table read beside it, each row with its controlling tty
 * @param liveRecords the registry records whose own process runs now
 * @returns those records, in registry order; with no pid reported, exactly {@link liveSessionsInTab}'s tty tie
 */
export function liveSessionsTouchingTab({
  report,
  rows,
  liveRecords,
}: {
  report: TabReport;
  rows: readonly TtyProcessRow[];
  liveRecords: readonly SessionRecord[];
}): readonly SessionRecord[] {
  const reported = reportedTabPids({ report });
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  if (reported.size === 0) {
    return liveSessionsOnTabTty({ byPid, liveRecords, report });
  }
  return liveRecords.filter(
    (record) =>
      underReported({ byPid, pid: record.pid, reported }) ||
      [...reported].some((pid) => underReported({ byPid, pid, reported: new Set([record.pid]) })),
  );
}
