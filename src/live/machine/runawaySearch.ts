/**
 * WHICH search processes inside a LIVE seat have run away — the pure half of the runaway-search fix.
 *
 * ## What happened, measured
 *
 * The owner's machine sat at 0% idle for about an hour and the console call kept dropping. `machine capacity` put 623%
 * CPU on one live seat (session `<session-id>`), whose tree held six `grep`/`ugrep` processes 20 to 58 minutes old
 * at about half a core each. They were its sub-agents' shell greps over
 * `$SLOPWEAVER_HOME/corpus/bronze/<source>/compact.jsonl` — single files of 1 to 17.5 GB — many launched with
 * `run_in_background: true`, several with a `-o -E ".{0,300}(a|b).{0,400}"` pattern that is slow on any file.
 *
 * Every existing reaper was blind to them by construction. `./reap.ts` takes a shell only when it is ORPHANED
 * and its seat DEAD; these shells' parent was the live `claude` process. `./fleetLoad.ts`'s culprit then named
 * the heaviest live session and proposed `kill <session pid>`, ending the whole seat to stop six children.
 *
 * ## The criterion — five facts from one snapshot, no judgement
 *
 * 1. **It is a search** — its argv's first word, by basename, is `grep`, `egrep`, `fgrep`, `ugrep`, `ug`, `rg`
 *    or `ggrep`. Claude Code 2.1.310's shell snapshot defines `grep` as its OWN binary exec'd with
 *    `ARGV0=ugrep`, so `ps` prints `ugrep -G --ignore-files --hidden …` while Activity Monitor labels the same
 *    process by its executable — `2.1.310`. Repro: `grep -n -A8 'function grep' ~/.claude/shell-snapshots/*.sh`.
 * 2. **It runs inside a LIVE seat's tool shell** — an ancestor IS `<zsh|bash|sh> -c source
 *    ~/.claude/shell-snapshots/snapshot-*.sh`, and above that a process whose program is `claude` and whose argv
 *    carries `--session-id` still stands. Both are matched by shape, never by a substring of some other argv.
 *    The shell keeps this away from every grep the owner types in a terminal, and from a Grep tool that runs a
 *    search as the session's direct child. The session keeps it off a dead seat's shells, which are
 *    `./reap.ts`'s orphan class already, so one process is never counted by both.
 * 3. **It is older than {@link RUNAWAY_SEARCH_AGE_SECONDS}** — Claude Code's Bash tool caps a foreground call
 *    at 600 000 ms, so past that no foreground tool call is still waiting on its output; what remains is a
 *    background task nobody reads until it ends. That is the checkable form of "no output consumer".
 * 4. **It is burning CPU** — at least {@link RUNAWAY_SEARCH_CPU_FLOOR_PCT}% in the sample. A stream filter
 *    (`tail -F log | grep --line-buffered …`) lives as long as its producer and sits near 0%, so it never
 *    qualifies however old it is. No sample at all selects nothing: an unmeasured search is not a runaway.
 * 5. **It is not in the caller's own parent chain** — the same guard every reaper here carries.
 *
 * ## What is killed: the search, never its shell or its seat
 *
 * The search pid alone — never its shell, a pipeline sibling, a descendant or its session. Its shell then runs
 * the rest of its command line and the tool call returns with whatever the search had printed, so the seat
 * lives and learns the call ended. A sibling reading its output may exit on SIGPIPE; that is the pipeline
 * ending, which is the point.
 *
 * ## What it is blind to, stated
 *
 * A runaway `find`/`bfs`, a search under `xargs` or `timeout` (the first word is then the wrapper — a
 * `timeout` is a bound anyway), and a search that is slow but under the CPU floor. The PreToolUse half
 * (`../../admit/diskScan.ts`) stops the measured shapes before they start; this is the backstop.
 *
 * Pure: a snapshot in, a list out. `../../cli/commands/machine/reap.ts` owns the one `process.kill`.
 */
import type { ProcessRow } from "../standing/processes.js";
import { briefDuration, claudeSessionIdOf, type ProcessCpu, type ProcessElapsed } from "./fleetLoad.js";

/**
 * A search older than this is past Claude Code's Bash foreground ceiling (600 000 ms), so no foreground tool
 * call can still be waiting on it. The ceiling is the Bash tool's own documented `timeout` maximum ("max
 * 600000 for a foreground command"), which the incident's background greps had set to the limit.
 */
export const RUNAWAY_SEARCH_AGE_SECONDS = 600;

/**
 * A search at or above this much of one core in the sample is doing work rather than waiting on a pipe. The
 * incident's six ran at about 50% each; an idle `tail -F | grep --line-buffered` reads 0.0.
 */
export const RUNAWAY_SEARCH_CPU_FLOOR_PCT = 20;

/** The search programs, by the basename of argv's first word — `ugrep` is Claude Code's own `grep`. */
const SEARCH_BINARIES: ReadonlySet<string> = new Set(["grep", "egrep", "fgrep", "ugrep", "ug", "rg", "ggrep"]);

/** How far up a parent chain the tool-shell and session climb goes — a racing snapshot's cycle must not hang it. */
const MAX_HOPS = 24;

/** The pid every orphan reparents to, where a climb stops. */
const LAUNCHD_PID = 1;

/** One runaway search, as a reap kills and reports it. */
export interface RunawaySearch {
  /** The search process itself. */
  readonly pid: number;
  /** Its program's basename — `grep`, `ugrep`, `rg`. */
  readonly binary: string;
  /** Its `%CPU` in the sample. */
  readonly cpuPct: number;
  /** How long it has been running. */
  readonly elapsedSeconds: number;
  /** The Claude Code tool shell it runs under. */
  readonly shellPid: number;
  /** The live session that owns that shell. */
  readonly sessionId: string;
  /** Exactly `[pid]` — the shape `./reap.ts`'s executor signals, which never widens to the shell or the seat. */
  readonly treePids: readonly number[];
  /** What the search was running when selected, for the pre-signal re-check against a recycled pid. */
  readonly argvByPid: Readonly<Record<string, string>>;
}

/**
 * The search program a process is running, when it is one.
 *
 * @param argv the full command line
 * @returns the program's basename when it is a search program, otherwise `undefined`
 */
export function searchBinaryOf({ argv }: { argv: string }): string | undefined {
  const first = argv.trimStart().split(/\s+/u)[0];
  if (first === undefined) {
    return undefined;
  }
  const binary = first.slice(first.lastIndexOf("/") + 1);
  if (!SEARCH_BINARIES.has(binary)) {
    return undefined;
  }
  return binary;
}

/** A pid's ancestors, nearest first, stopping at `launchd`, a missing row, a self-parent or {@link MAX_HOPS}. */
function ancestorsOf({ pid, byPid }: { pid: number; byPid: ReadonlyMap<number, ProcessRow> }): readonly ProcessRow[] {
  const chain: ProcessRow[] = [];
  const self = byPid.get(pid);
  let row = self === undefined ? undefined : byPid.get(self.ppid);
  while (row !== undefined && row.pid !== LAUNCHD_PID && chain.length < MAX_HOPS) {
    chain.push(row);
    row = row.ppid === row.pid ? undefined : byPid.get(row.ppid);
  }
  return chain;
}

/**
 * The WHOLE sourced word of a Claude Code tool shell: a snapshot file directly in `~/.claude/shell-snapshots/`,
 * ending `.sh`. A `shell-snapshots` directory anywhere else is not Claude Code's, and neither is a
 * word that merely starts with one, `snapshot-x.sh.evil`.
 */
const CLAUDE_SNAPSHOT_WORD = /^\/[^\s'"]*\/\.claude\/shell-snapshots\/snapshot-[^\s'"/]+\.sh$/u;

/** The shells Claude Code's Bash tool runs a command in. */
const TOOL_SHELLS: ReadonlySet<string> = new Set(["zsh", "bash", "sh"]);

/** The basename of a command line's first word. */
function programOf({ words }: { words: readonly string[] }): string {
  const first = words[0]!;
  return first.slice(first.lastIndexOf("/") + 1);
}

/**
 * The session id of a row that IS a `claude` process — its program `claude` and its argv carrying
 * `--session-id`. A session id in any other program's argv (`sleep --session-id x`) is not a seat. Every live seat here reads `…/.local/bin/claude --session-id <id>`:
 * `ps -ax -o pid=,args= | grep -E -- " --session-id " | grep -v -E "zsh -c|ugrep"`.
 */
function seatSessionIdOf({ argv }: { argv: string }): string | undefined {
  if (programOf({ words: argv.trimStart().split(/\s+/u) }) !== "claude") {
    return undefined;
  }
  return claudeSessionIdOf({ argv });
}

/**
 * Whether a row IS a Claude Code tool shell — `<zsh|bash|sh> -c source <~/.claude/shell-snapshots/snapshot-*.sh>`,
 * word for word, never a snapshot path anywhere in some other program's argv.
 */
function isToolShell({ argv }: { argv: string }): boolean {
  const words = argv.trimStart().split(/\s+/u);
  const snapshot = words[3];
  if (snapshot === undefined || !TOOL_SHELLS.has(programOf({ words }))) {
    return false;
  }
  return words[1] === "-c" && words[2] === "source" && CLAUDE_SNAPSHOT_WORD.test(snapshot);
}

/** The nearest tool shell above a pid and the live session above that, from one climb of its parent chain. */
function toolShellAndSession({
  pid,
  byPid,
}: {
  pid: number;
  byPid: ReadonlyMap<number, ProcessRow>;
}): { readonly shellPid: number; readonly sessionId: string } | undefined {
  const chain = ancestorsOf({ byPid, pid });
  const sessions = chain.map((row) => seatSessionIdOf({ argv: row.argv }));
  const sessionAt = sessions.findIndex((sessionId) => sessionId !== undefined);
  if (sessionAt < 0) {
    return undefined;
  }
  const shell = chain.slice(0, sessionAt).find((row) => isToolShell({ argv: row.argv }));
  if (shell === undefined) {
    return undefined;
  }
  return { sessionId: sessions[sessionAt]!, shellPid: shell.pid };
}

/**
 * Every runaway search in one snapshot — see this module's header for the five facts.
 *
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @param cpuRows the decoded per-process `%CPU` rows; empty means unmeasured, which selects nothing
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` rows
 * @param protectedPids pids never to select — the caller's own parent chain
 * @param ageSeconds the age line (defaults to {@link RUNAWAY_SEARCH_AGE_SECONDS})
 * @param cpuFloorPct the CPU line (defaults to {@link RUNAWAY_SEARCH_CPU_FLOOR_PCT})
 * @returns the runaway searches, largest `%CPU` first, then lowest pid
 */
export function runawaySearches({
  processes,
  cpuRows,
  elapsedRows,
  protectedPids,
  ageSeconds = RUNAWAY_SEARCH_AGE_SECONDS,
  cpuFloorPct = RUNAWAY_SEARCH_CPU_FLOOR_PCT,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  protectedPids: ReadonlySet<number>;
  ageSeconds?: number;
  cpuFloorPct?: number;
}): readonly RunawaySearch[] {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const cpuByPid = new Map(cpuRows.map((row) => [row.pid, row.cpuPct]));
  const elapsedByPid = new Map(elapsedRows.map((row) => [row.pid, row.seconds]));
  const found: RunawaySearch[] = [];
  for (const row of processes) {
    const binary = searchBinaryOf({ argv: row.argv });
    const cpuPct = cpuByPid.get(row.pid);
    const elapsedSeconds = elapsedByPid.get(row.pid);
    if (binary === undefined || cpuPct === undefined || elapsedSeconds === undefined) {
      continue;
    }
    if (cpuPct < cpuFloorPct || elapsedSeconds < ageSeconds || protectedPids.has(row.pid)) {
      continue;
    }
    const owner = toolShellAndSession({ byPid, pid: row.pid });
    if (owner === undefined) {
      continue;
    }
    found.push({
      argvByPid: { [String(row.pid)]: row.argv },
      binary,
      cpuPct,
      elapsedSeconds,
      pid: row.pid,
      sessionId: owner.sessionId,
      shellPid: owner.shellPid,
      treePids: [row.pid],
    });
  }
  return found.toSorted((a, b) => b.cpuPct - a.cpuPct || a.pid - b.pid);
}

/**
 * Whether a selected search still sits under the same live seat in a LATER table — the executor's re-check, so
 * a seat that ended between the plan and the signal leaves its search to the orphan class rather than to this
 * one. The SHELL must match too: a reused pid running the same argv under another
 * tool shell of the same seat is a different search.
 *
 * @param search the search the plan selected
 * @param processes the table re-read immediately before signalling
 * @returns true when the same tool shell and the same session are still above it
 */
export function stillUnderLiveSeat({
  search,
  processes,
}: {
  search: RunawaySearch;
  processes: readonly ProcessRow[];
}): boolean {
  const owner = toolShellAndSession({ byPid: new Map(processes.map((row) => [row.pid, row])), pid: search.pid });
  return owner !== undefined && owner.sessionId === search.sessionId && owner.shellPid === search.shellPid;
}

/**
 * What a set of runaway searches costs together, to one decimal — the figure the alert and the culprit both print.
 *
 * @param searches the runaway searches
 * @returns their summed `%CPU`, rounded to one decimal place
 */
export function searchCpuPct({ searches }: { searches: readonly RunawaySearch[] }): number {
  return Math.round(searches.reduce((sum, search) => sum + search.cpuPct, 0) * 10) / 10;
}

/**
 * One runaway search as a report line names it — pid, program, cost, age and the session it belongs to.
 * Never the argv: a search pattern can carry anything a session was looking for.
 *
 * @param search the runaway search
 * @returns the line's body, without the leading verb
 */
export function runawaySearchLabel({ search }: { search: RunawaySearch }): string {
  return (
    `runaway search ${String(search.pid)} (${search.binary}) · ${String(search.cpuPct)}% cpu · ` +
    `${briefDuration({ seconds: search.elapsedSeconds })} old · shell ${String(search.shellPid)} in session ${search.sessionId}`
  );
}
