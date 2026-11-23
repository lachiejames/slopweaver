/**
 * Which FLEET process is burning the CPU `machine capacity` already grades — the pure half of the
 * fleet-culprit and orphan-shell asks.
 *
 * ## What was wrong, as measured
 *
 * The 1-minute load sat between 100 and 146 against a hold of 22 for over two hours. `machine capacity`
 * published a `capacity-hold` every sweep tick, and every one of them read, in full, `HOLD on cpu (1-min load
 * 146, hold at 22)`. That sentence is TRUE and it names nobody, so eleven consecutive supervisor ticks
 * reported the hold and none of them found the cause, and the owner had to come in and ask why everything was
 * ten times slower. Had the owner known the circumstances, the answer would have been to kill them.
 *
 * The cause was entirely fleet-owned and entirely visible in one `ps` snapshot: 64 orphaned `zsh` shells at
 * 10-13% CPU each (parent `launchd`, from one dead seat's shell snapshot and one seat's test loops), plus one
 * ask worker running nineteen tool calls in parallel, each stuck 43 minutes on its PreToolUse hooks.
 *
 * So this module answers the question the load average cannot: **whose**. It groups every fleet process by the
 * session that owns it, groups what no live session owns by the SHELL SNAPSHOT it was launched from, and reads
 * two per-session numbers that would have named the culprit that morning outright.
 *
 * ## The three argv shapes it reads, each verified live on this machine
 *
 * - A Claude Code **session** is `…/claude --session-id <uuid> --settings {…}`. The id is in the argv, so a
 *   session is nameable without the `~/.claude/sessions/<pid>.json` registry `./sessionOwner.ts` joins to.
 * - A Claude Code **tool shell** is `/bin/zsh -c source ~/.claude/shell-snapshots/snapshot-zsh-<ms>-<rand>.sh
 *   … && eval '<the command>'`. The snapshot path is minted once per session and is the only identity that
 *   SURVIVES that session's death — which is exactly what an orphan needs, since its parent chain is gone.
 * - A **PreToolUse hook** is a direct child of the session process running `scripts/pretooluse.sh`, the
 *   `hooks/pretooluse.ts` it execs, or the `.hook-build/pretooluse.mjs` bundle it prefers — one process for
 *   the event since the hooks folded into one, with the older per-guard `pretooluse-<name>` spellings still matched, because a
 *   long-lived seat can be running either. Reproduce all three with
 *   `ps -ax -o pid=,ppid=,etime=,args= | grep -E 'shell-snapshots|pretooluse|--session-id'`.
 *
 * ## Why the parallel count is MAX MULTIPLICITY OF ONE HOOK SCRIPT'S ROOTS, and what it is blind to
 *
 * `hooks/hooks.json` fires ONE PreToolUse hook per call since the fold and registered ten before it, several of
 * them matching `Bash`, so a single tool call produced that many concurrent hook processes. Counting hook
 * processes and dividing by the entry count would be arithmetic on an implementation detail that changes
 * whenever a hook is added — and it did change, by a factor of ten. Counting the largest number of
 * concurrent ROOT processes running THE SAME hook script never depended on it: one script fires once
 * per tool call either way, so nineteen live `pretooluse` roots (or, on an older seat, `pretooluse-poll-gate`)
 * under one session mean nineteen tool calls are in flight at that instant. A Claude Code main thread runs
 * one tool call at a time, so N in flight is N parallel agents — one main thread and N-1 sub-agents.
 *
 * ROOT is load-bearing and was measured missing: a shim `exec`s tsx, so its own `.sh` process is replaced,
 * but the tsx wrapper then spawns a LOADER child whose argv names the same `hooks/<script>.ts`. Counting
 * every matching row therefore doubled the reading — see {@link hookReading}'s own header for the live pids
 * and the repro. {@link SessionLoad.bootsInFlight} is the count that deliberately keeps both, because two
 * node boots per firing is the cost that moves the load average.
 *
 * That inference is stated rather than assumed, because the reading is blind in four ways and each matters:
 * a sub-agent that is thinking, or calling a tool no PreToolUse hook matches, is invisible; nothing on the
 * hook payload marks a sidechain, so this can never say WHICH of the calls is a sub-agent's (`isSidechain`
 * lives on the TRANSCRIPT record, `../../transcripts/record.ts`); a session whose hooks all return in
 * milliseconds reads 1 however many agents it is running, because the snapshot catches none of them mid-call;
 * and a Codex worker registers no Claude hooks at all, so it reads 0 rather than absent.
 *
 * Which is why the parallel count ALERTS and never HOLDS, while the hook stall does both — see
 * `./capacity.ts`'s own threshold header for where the two lines sit and why.
 */
import type { ProcessRow } from "../standing/processes.js";
import { basename, type ProcessComm } from "./capacityParse.js";

/** One process's share of the machine, decoded from `top`'s `%CPU` column — 100 is one whole core. */
export interface ProcessCpu {
  readonly pid: number;
  readonly cpuPct: number;
}

/** How long one process has been running, decoded from `ps -ax -o pid=,etime=`. */
export interface ProcessElapsed {
  readonly pid: number;
  readonly seconds: number;
}

/** How many processes of a culprit's tree a finding row carries. Bounded: this list reaches a briefing. */
const DEFAULT_TREE_LIMIT = 12;

/**
 * One process inside a culprit's tree, as a finding row carries it.
 *
 * The label is a `comm`-style BASENAME and never a raw argv, and that is a leak boundary rather than a
 * display choice: an argv carries flag values, a flag value can carry a token, and these rows reach the
 * fleet briefing. `./cpuHogs.ts`'s header states the same rule for the same reason.
 */
export interface TreeProcess {
  readonly pid: number;
  /** The process's basename — never any part of its argv beyond the binary path. */
  readonly label: string;
  /** Its `%CPU`, or 0 when the sample carried no row for it. */
  readonly cpuPct: number;
  /** How long it has been running, or `undefined` when the elapsed read carried no row for it. */
  readonly elapsedSeconds: number | undefined;
}

/** One session's whole process tree, attributed — the row a culprit clause is built from. */
export interface SessionLoad {
  /** The `--session-id` its own argv carries. */
  readonly sessionId: string;
  /** The session process's pid, so a reader can reach it with one `ps -p`. */
  readonly pid: number;
  /** Every process in its tree, its own `claude` included. */
  readonly processCount: number;
  /** The tree's summed `%CPU` — 100 is one whole core. */
  readonly cpuPct: number;
  /**
   * Tool calls in flight at the instant of the snapshot: the largest number of concurrent processes running
   * any ONE PreToolUse hook script under this session. See this module's header for the inference and its
   * four blind spots.
   */
  readonly parallelToolCalls: number;
  /** The longest-running PreToolUse hook under this session, in seconds, or `undefined` when none is live. */
  readonly hookStallSeconds: number | undefined;
  /**
   * WHICH hook script that longest-running one is (`pretooluse-poll-gate`), or `undefined` when none is
   * live. `hookStallSeconds` without it reproduces, one hop out, the defect this whole module
   * exists to end: `a PreToolUse hook stalled 27m` is true and names nobody, so eleven ticks reported it
   * and none of them could act. The poll gate was the stall of that pass, found by hand.
   */
  readonly hookStallScript: string | undefined;
  /**
   * How many hook PROCESSES are live under this session — every firing's tsx wrapper AND the loader child
   * it spawns, which is the per-tool-call boot cost rather than the tool-call count. One PreToolUse row
   * in `hooks/hooks.json` matches `Bash`, and the firing is two node processes booting tsx, so this is the
   * number that moves the load average while {@link parallelToolCalls} stays flat.
   */
  readonly bootsInFlight: number;
  /**
   * The processes in its tree that are NOT PreToolUse hooks — the number that says whether this session has
   * spawned a runaway amount of work, as opposed to how many hooks its tool calls happen to fire.
   *
   * The distinction is the whole reason the field exists. `hooks/hooks.json` hands a `Bash` call to ONE
   * PreToolUse row (measured: `node -e` over the manifest, after ten entries folded into one;
   * the two disjoint rows still fire one per call), while `skills/loop-bot/reference/detective-fanout.md` records a MANDATORY fan-out
   * whose measured lap ran 28 readers. Twenty-eight in-flight calls at two node processes each is ~56 hook
   * processes under one session on completely correct work, so a threshold over {@link processCount} would
   * still fire every bot turn — the exact mistake this module's own footer refused to make with the
   * parallel-call count. The fold cut the multiplier, not the class: re-measure the entry count here rather
   * than trusting this number, because it has already moved once.
   */
  readonly nonHookProcessCount: number;
  /**
   * How many of this session's TOOL SHELLS are live — the `/bin/zsh -c source …/shell-snapshots/…` process
   * Claude Code launches for a `Bash` call. Zero while a `Bash` call is in flight means the command never
   * started, which is the one thing that separates a harness-side hold from a slow command
   * (`../perf/report.ts`'s `stuck` grade). A tool that is not `Bash` leaves no process here at all, so this
   * count says nothing about one.
   */
  readonly toolShellsInFlight: number;
  /** Its heaviest processes, largest `%CPU` first — the culprit tree a finding row carries. */
  readonly tree: readonly TreeProcess[];
}

/** Every orphaned fleet shell that shares one shell snapshot — one seat's leftovers, grouped. */
export interface OrphanGroup {
  /** The `~/.claude/shell-snapshots/snapshot-*.sh` path every shell in this group sources. */
  readonly snapshot: string;
  /**
   * Whether an un-reparented process still sources this snapshot. A LIVE seat's orphan is a running session's
   * leftover rather than a dead seat's, `machine reap` will not take it, and counting it as a dead seat would
   * be a claim the reap verb then contradicts — so it is reported and excluded from the totals.
   */
  readonly seatLive: boolean;
  /** The orphaned shells themselves, not their descendants. */
  readonly pids: readonly number[];
  /** The group's summed `%CPU`, descendants included — what it is actually costing. */
  readonly cpuPct: number;
  /** The oldest shell in the group, in seconds, or `undefined` when no elapsed reading was available. */
  readonly oldestSeconds: number | undefined;
  /**
   * The group's heaviest processes, descendants included, largest `%CPU` first — the same {@link TreeProcess}
   * shape and the same `descendantPids` walk a session's tree is built from, so there is one tree mechanism
   * on this gauge rather than two that drift.
   */
  readonly tree: readonly TreeProcess[];
}

/** What the fleet is costing, and who is costing it. */
export interface FleetLoadReading {
  /** Every live session with at least one process, largest attributed CPU first. */
  readonly sessions: readonly SessionLoad[];
  /** Every orphan group, largest attributed CPU first. */
  readonly orphans: readonly OrphanGroup[];
  /** How many orphaned fleet shells stand on a DEAD seat — the reapable ones, across every group. */
  readonly orphanCount: number;
  /** The dead seats' orphans' summed `%CPU`, descendants included. */
  readonly orphanCpuPct: number;
  /** Whether a per-process CPU reading was available at all — without one every `cpuPct` here is zero. */
  readonly cpuAttributed: boolean;
}

/** The `--session-id <uuid>` a Claude Code session's own argv carries. */
const SESSION_ID_PATTERN = /--session-id[= ]([0-9a-fA-F-]{8,})/u;

/** The shell snapshot a Claude Code tool shell sources — minted per session, and it outlives the session. */
const SHELL_SNAPSHOT_PATTERN = /(\/[^\s'"]*\/shell-snapshots\/snapshot-[^\s'"]+\.sh)/u;

/**
 * A PreToolUse hook process, by the script it runs. Both spellings: the shim and the module it execs.
 *
 * Three things widened when the ten hooks folded into one, and each
 * closes a way this gauge could have gone blind to the only hook process that now exists — which is the
 * exact failure mode it was built to catch. The `-<name>` half is OPTIONAL (`scripts/pretooluse.sh`,
 * `hooks/pretooluse.ts`); `.hook-build/` is a third directory, because the prebuilt bundle is what `node`
 * actually runs on the fast path; and `.mjs` is a third extension for the same reason. All three spellings
 * are asserted in `unit/live/machine/fleetLoad.test.ts` rather than left for the next reader to notice.
 */
const HOOK_SCRIPT_PATTERN = /\/(?:scripts|hooks|\.hook-build)\/(pretooluse(?:-[a-z0-9-]+)?)\.(?:sh|ts|mjs)\b/u;

/** The pid every orphan reparents to. */
const LAUNCHD_PID = 1;

/** How far up a parent chain attribution climbs — a cycle in a racing `ps` snapshot must not hang a gauge. */
const MAX_HOPS = 24;

/**
 * The Claude Code session id a process's own argv declares, when it is a session process.
 *
 * @param argv the full command line
 * @returns the session id, or `undefined` when this argv is not a session's own
 */
export function claudeSessionIdOf({ argv }: { argv: string }): string | undefined {
  const match = SESSION_ID_PATTERN.exec(argv);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * The shell snapshot a Claude Code tool shell sources.
 *
 * @param argv the full command line
 * @returns the absolute snapshot path, or `undefined` when this argv sources none
 */
export function shellSnapshotOf({ argv }: { argv: string }): string | undefined {
  const match = SHELL_SNAPSHOT_PATTERN.exec(argv);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * The PreToolUse hook script a process is running.
 *
 * @param argv the full command line
 * @returns the stem (`pretooluse`, or an older per-guard `pretooluse-poll-gate`), or `undefined` when this argv
 *   runs no hook
 */
export function hookScriptOf({ argv }: { argv: string }): string | undefined {
  const match = HOOK_SCRIPT_PATTERN.exec(argv);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

/**
 * Decode `ps -ax -o pid=,etime=`'s elapsed column. `etime` prints three shapes — `MM:SS`, `HH:MM:SS` and
 * `DD-HH:MM:SS` — and all three are read; anything else is skipped rather than failing the whole listing.
 *
 * @param text the raw listing
 * @returns one row per decodable line, in the order `ps` printed them
 */
export function parseElapsedRows({ text }: { text: string }): readonly ProcessElapsed[] {
  const rows: ProcessElapsed[] = [];
  for (const line of text.split("\n")) {
    const [pid, etime, extra] = line.trim().split(/\s+/u);
    if (pid === undefined || etime === undefined || extra !== undefined || !/^\d+$/u.test(pid)) {
      continue;
    }
    const seconds = elapsedSeconds({ etime });
    if (seconds !== undefined) {
      rows.push({ pid: Number(pid), seconds });
    }
  }
  return rows;
}

/**
 * One `etime` value as whole seconds.
 *
 * @param etime the column's text — `MM:SS`, `HH:MM:SS` or `DD-HH:MM:SS`
 * @returns the elapsed seconds, or `undefined` when the text is none of those shapes
 */
export function elapsedSeconds({ etime }: { etime: string }): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(etime.trim());
  if (match === null) {
    return undefined;
  }
  const [days, hours, minutes, secs] = [match[1], match[2], match[3], match[4]].map((part) => {
    if (part === undefined) {
      return 0;
    }
    return Number(part);
  });
  return days! * 86_400 + hours! * 3600 + minutes! * 60 + secs!;
}

/**
 * Decode the per-process `%CPU` rows of `top -l 2 -s 1 -stats pid,cpu`'s FINAL sample — the same text
 * `./hiddenCpu.ts` reads its whole-machine residual from, so attribution costs no extra subprocess. The first
 * sample's per-process `%CPU` is always zero (`top` has no interval to measure over yet), which is why only
 * the last one is read.
 *
 * @param text the raw `top` output
 * @returns one row per process in the final sample, empty when the text carries no second sample
 */
export function parseTopCpuRows({ text }: { text: string }): readonly ProcessCpu[] {
  const samples: string[][] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith("Processes:")) {
      samples.push([]);
    }
    samples.at(-1)?.push(line);
  }
  const last = samples.at(-1);
  if (samples.length < 2 || last === undefined) {
    return [];
  }
  const headingIndex = last.findIndex((line) => /^PID\s+%CPU\s*$/u.test(line));
  if (headingIndex < 0) {
    return [];
  }
  const rows: ProcessCpu[] = [];
  for (const line of last.slice(headingIndex + 1)) {
    const [pid, cpu, extra] = line.trim().split(/\s+/u);
    if (pid === undefined || cpu === undefined || extra !== undefined) {
      continue;
    }
    if (/^\d+$/u.test(pid) && /^\d+(?:\.\d+)?$/u.test(cpu)) {
      rows.push({ cpuPct: Number(cpu), pid: Number(pid) });
    }
  }
  return rows;
}

/** The indexes every walk over one snapshot shares, built once rather than per process. */
interface SnapshotIndex {
  readonly byPid: ReadonlyMap<number, ProcessRow>;
  readonly cpuByPid: ReadonlyMap<number, number>;
  readonly elapsedByPid: ReadonlyMap<number, number>;
  /** Each pid's `comm` basename, when a `comm` listing was supplied — the only safe label source. */
  readonly commByPid: ReadonlyMap<number, string>;
  /** The session process's pid, for each pid whose argv declares a session id. */
  readonly sessionIdByPid: ReadonlyMap<number, string>;
}

/** Build the four lookups {@link fleetLoadReading} walks, from one snapshot's three tables. */
function indexSnapshot({
  processes,
  cpuRows,
  elapsedRows,
  comms,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  comms: readonly ProcessComm[];
}): SnapshotIndex {
  const sessionIdByPid = new Map<number, string>();
  for (const row of processes) {
    const sessionId = claudeSessionIdOf({ argv: row.argv });
    if (sessionId !== undefined) {
      sessionIdByPid.set(row.pid, sessionId);
    }
  }
  return {
    byPid: new Map(processes.map((row) => [row.pid, row])),
    commByPid: new Map(comms.map((row) => [row.pid, row.comm])),
    cpuByPid: new Map(cpuRows.map((row) => [row.pid, row.cpuPct])),
    elapsedByPid: new Map(elapsedRows.map((row) => [row.pid, row.seconds])),
    sessionIdByPid,
  };
}

/**
 * The session process a row is, or descends from: climb the parent chain, itself first, to the first pid whose
 * own argv declares a `--session-id`. A pid missing from the snapshot, a self-parented row, `launchd` or
 * {@link MAX_HOPS} ends the climb with no owner — which is what makes an orphan an orphan.
 */
function owningSessionPid({ pid, index }: { pid: number; index: SnapshotIndex }): number | undefined {
  let current: number | undefined = pid;
  for (let hop = 0; hop < MAX_HOPS && current !== undefined && current !== LAUNCHD_PID; hop += 1) {
    const row = index.byPid.get(current);
    if (row === undefined) {
      return undefined;
    }
    if (index.sessionIdByPid.has(current)) {
      return current;
    }
    current = row.ppid === row.pid ? undefined : row.ppid;
  }
  return undefined;
}

/*
 * Every pid under this session that is ITSELF a hook process, so the fold below can tell a firing’s root
 * from the tsx loader child it spawns. Built in its own pass because a child can appear in `ps` output
 * before its parent does.
 */
function hookPidsOf({ hookRows }: { hookRows: readonly ProcessRow[] }): ReadonlySet<number> {
  const pids = new Set<number>();
  for (const row of hookRows) {
    if (hookScriptOf({ argv: row.argv }) !== undefined) {
      pids.add(row.pid);
    }
  }
  return pids;
}

/**
 * One session's parallel-tool-call count, boot count, longest hook stall and the script that stall runs.
 *
 * **One firing is more than one process, which is why the ROOT filter is here rather than a divisor.** A
 * hook shim `exec`s tsx, so the shim's own `.sh` process is replaced rather than added — but the tsx
 * wrapper then spawns a loader child, and BOTH argvs name the same `hooks/<script>.ts`. Measured live
 * pid 93104 `…/.bin/tsx …/hooks/pretooluse-main-checkout-edit-guard.ts` with child pid 93353
 * `node --require …/tsx/dist/preflight.cjs --import …/tsx/dist/loader.mjs …/hooks/…-edit-guard.ts`. So
 * counting every matching row doubled the in-flight tool calls, and the fan-out alert fired at half the
 * concurrency it advertises. Repro:
 * `ps -ax -o pid=,ppid=,etime=,args= | grep -E 'pretooluse-[a-z-]+\.(sh|ts)'` during a busy seat's turn.
 *
 * A ROOT is a hook process whose parent is not itself a hook process of this session — exactly one per
 * firing, whatever tsx does underneath, so this survives a change to how the shim boots.
 */
function hookReading({ hookRows, index }: { hookRows: readonly ProcessRow[]; index: SnapshotIndex }): {
  readonly parallelToolCalls: number;
  readonly bootsInFlight: number;
  readonly hookStallSeconds: number | undefined;
  readonly hookStallScript: string | undefined;
} {
  const hookPids = hookPidsOf({ hookRows });
  const perScript = new Map<string, number>();
  let longest: number | undefined;
  let longestScript: string | undefined;
  let boots = 0;
  for (const row of hookRows) {
    const script = hookScriptOf({ argv: row.argv });
    if (script === undefined) {
      continue;
    }
    boots += 1;
    if (!hookPids.has(row.ppid)) {
      const seen = perScript.get(script);
      perScript.set(script, seen === undefined ? 1 : seen + 1);
    }
    const seconds = index.elapsedByPid.get(row.pid);
    if (seconds === undefined) {
      continue;
    }
    if (longest === undefined || seconds > longest) {
      longest = seconds;
      longestScript = script;
    }
  }
  return {
    bootsInFlight: boots,
    hookStallScript: longestScript,
    hookStallSeconds: longest,
    parallelToolCalls: Math.max(0, ...perScript.values()),
  };
}

/** One pid's label: its `comm` basename, else its argv's BINARY PATH basename — never a flag value. */
function treeLabel({ pid, index }: { pid: number; index: SnapshotIndex }): string {
  const comm = index.commByPid.get(pid);
  if (comm !== undefined && comm.trim().length > 0) {
    return basename({ path: comm.trim() });
  }
  const first = index.byPid.get(pid)?.argv.trimStart().split(/\s+/u)[0];
  if (first !== undefined && first.length > 0) {
    return basename({ path: first });
  }
  return `pid ${String(pid)}`;
}

/** The heaviest members of a pid set, as the {@link TreeProcess} rows a finding row carries. */
function treeOf({
  pids,
  index,
  limit,
}: {
  pids: readonly number[];
  index: SnapshotIndex;
  limit: number;
}): readonly TreeProcess[] {
  return pids
    .map((pid): TreeProcess => ({
      cpuPct: round1({ value: cpuOf({ index, pid }) }),
      elapsedSeconds: index.elapsedByPid.get(pid),
      label: treeLabel({ index, pid }),
      pid,
    }))
    .toSorted((a, b) => b.cpuPct - a.cpuPct)
    .slice(0, Math.max(0, limit));
}

/** Round a percentage to one decimal — the precision the rest of this gauge prints. */
function round1({ value }: { value: number }): number {
  return Math.round(value * 10) / 10;
}

/** Fold the processes one session owns into its {@link SessionLoad} row. */
function sessionLoadsOf({
  processes,
  index,
  treeLimit,
}: {
  processes: readonly ProcessRow[];
  index: SnapshotIndex;
  treeLimit: number;
}): readonly SessionLoad[] {
  const owned = new Map<number, ProcessRow[]>();
  for (const row of processes) {
    const sessionPid = owningSessionPid({ index, pid: row.pid });
    if (sessionPid === undefined) {
      continue;
    }
    const bucket = owned.get(sessionPid);
    if (bucket === undefined) {
      owned.set(sessionPid, [row]);
      continue;
    }
    bucket.push(row);
  }
  const loads: SessionLoad[] = [];
  for (const [sessionPid, rows] of owned) {
    const sessionId = index.sessionIdByPid.get(sessionPid);
    if (sessionId === undefined) {
      continue;
    }
    const hooks = hookReading({ hookRows: rows, index });
    loads.push({
      bootsInFlight: hooks.bootsInFlight,
      cpuPct: round1({ value: rows.reduce((sum, row) => sum + cpuOf({ index, pid: row.pid }), 0) }),
      hookStallScript: hooks.hookStallScript,
      hookStallSeconds: hooks.hookStallSeconds,
      nonHookProcessCount: rows.filter((row) => hookScriptOf({ argv: row.argv }) === undefined).length,
      parallelToolCalls: hooks.parallelToolCalls,
      pid: sessionPid,
      processCount: rows.length,
      sessionId,
      toolShellsInFlight: rows.filter((row) => shellSnapshotOf({ argv: row.argv }) !== undefined).length,
      tree: treeOf({ index, limit: treeLimit, pids: rows.map((row) => row.pid) }),
    });
  }
  return loads.toSorted((a, b) => b.cpuPct - a.cpuPct);
}

/** One pid's `%CPU`, or zero when the sample did not carry it — a process `top` never listed costs nothing here. */
function cpuOf({ index, pid }: { index: SnapshotIndex; pid: number }): number {
  const measured = index.cpuByPid.get(pid);
  if (measured === undefined) {
    return 0;
  }
  return measured;
}

/** Every pid in a process's whole descendant tree, itself included, from one snapshot. */
function descendantPids({
  root,
  childrenByPpid,
}: {
  root: number;
  childrenByPpid: ReadonlyMap<number, number[]>;
}): readonly number[] {
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift()!; // the loop condition proves the queue is non-empty
    // A childless pid is the common case, so the absence is an early continue rather than an empty literal.
    const children = childrenByPpid.get(pid);
    if (children === undefined) {
      continue;
    }
    for (const child of children) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

/**
 * Children by parent pid, for one snapshot — the index a descendant walk needs. A self-parented row is left
 * out, because a racing `ps` snapshot can print one and a walk over it would never terminate.
 *
 * @param processes the whole `ps -ax -o pid=,ppid=,args=` snapshot
 * @returns each pid's children, absent for a pid with none
 */
export function childIndexOf({ processes }: { processes: readonly ProcessRow[] }): ReadonlyMap<number, number[]> {
  const children = new Map<number, number[]>();
  for (const row of processes) {
    if (row.ppid === row.pid) {
      continue;
    }
    const bucket = children.get(row.ppid);
    if (bucket === undefined) {
      children.set(row.ppid, [row.pid]);
      continue;
    }
    bucket.push(row.pid);
  }
  return children;
}

/**
 * Every ORPHANED fleet shell in a snapshot: a Claude Code tool shell (its argv sources a shell snapshot) whose
 * parent is `launchd`. Nothing is left to read its output or to be interrupted by the owner, which is the
 * visibility property doctrine rule 2 is built on.
 *
 * @param processes the whole `ps -ax -o pid=,ppid=,args=` snapshot
 * @returns the orphaned shells, in snapshot order
 */
export function orphanedFleetShells({ processes }: { processes: readonly ProcessRow[] }): readonly ProcessRow[] {
  return processes.filter((row) => row.ppid === LAUNCHD_PID && shellSnapshotOf({ argv: row.argv }) !== undefined);
}

/**
 * The shell snapshots a LIVE session is still using — every snapshot named by a process that has not been
 * reparented. A snapshot in this set has a session behind it; one that is not is a dead seat's leftover.
 *
 * @param processes the whole snapshot
 * @returns the live snapshot paths
 */
export function liveShellSnapshots({ processes }: { processes: readonly ProcessRow[] }): ReadonlySet<string> {
  const live = new Set<string>();
  for (const row of processes) {
    if (row.ppid === LAUNCHD_PID) {
      continue;
    }
    const snapshot = shellSnapshotOf({ argv: row.argv });
    if (snapshot !== undefined) {
      live.add(snapshot);
    }
  }
  return live;
}

/** Group the orphaned shells by the snapshot they were launched from, summing each group's whole cost. */
function orphanGroupsOf({
  processes,
  index,
  treeLimit,
}: {
  processes: readonly ProcessRow[];
  index: SnapshotIndex;
  treeLimit: number;
}): readonly OrphanGroup[] {
  const children = childIndexOf({ processes });
  const live = liveShellSnapshots({ processes });
  const bySnapshot = new Map<
    string,
    { pids: number[]; treePids: number[]; cpuPct: number; oldestSeconds: number | undefined }
  >();
  for (const row of orphanedFleetShells({ processes })) {
    const snapshot = shellSnapshotOf({ argv: row.argv })!; // `orphanedFleetShells` already proved it has one
    const tree = descendantPids({ childrenByPpid: children, root: row.pid });
    const cpuPct = tree.reduce((sum, pid) => sum + cpuOf({ index, pid }), 0);
    const seconds = index.elapsedByPid.get(row.pid);
    const seen = bySnapshot.get(snapshot);
    if (seen === undefined) {
      bySnapshot.set(snapshot, { cpuPct, oldestSeconds: seconds, pids: [row.pid], treePids: [...tree] });
      continue;
    }
    seen.pids.push(row.pid);
    seen.treePids.push(...tree);
    seen.cpuPct += cpuPct;
    if (seconds !== undefined && (seen.oldestSeconds === undefined || seconds > seen.oldestSeconds)) {
      seen.oldestSeconds = seconds;
    }
  }
  return [...bySnapshot.entries()]
    .map(([snapshot, group]): OrphanGroup => ({
      cpuPct: round1({ value: group.cpuPct }),
      oldestSeconds: group.oldestSeconds,
      pids: group.pids,
      seatLive: live.has(snapshot),
      snapshot,
      tree: treeOf({ index, limit: treeLimit, pids: group.treePids }),
    }))
    .toSorted((a, b) => b.cpuPct - a.cpuPct);
}

/**
 * Attribute one snapshot's whole fleet: what each live session's tree costs, what it has in flight and how
 * long its longest hook has been stalled, and what every dead seat's orphans are still burning.
 *
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @param cpuRows the decoded per-process `%CPU` rows ({@link parseTopCpuRows}); an empty list leaves every
 *   `cpuPct` at zero and `cpuAttributed` false, rather than claiming a measurement that was not taken
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` rows ({@link parseElapsedRows})
 * @param comms the decoded `ps -ax -o pid=,comm=` rows — every tree LABEL's source, and the reason a tree
 *   never carries an argv; an empty list leaves each label on its binary path's basename
 * @param treeLimit how many processes each culprit tree keeps (defaults to {@link DEFAULT_TREE_LIMIT})
 * @returns the reading
 */
export function fleetLoadReading({
  processes,
  cpuRows,
  elapsedRows,
  comms = [],
  treeLimit = DEFAULT_TREE_LIMIT,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  comms?: readonly ProcessComm[];
  treeLimit?: number;
}): FleetLoadReading {
  const index = indexSnapshot({ comms, cpuRows, elapsedRows, processes });
  const orphans = orphanGroupsOf({ index, processes, treeLimit });
  const dead = orphans.filter((group) => !group.seatLive);
  return {
    cpuAttributed: cpuRows.length > 0,
    orphanCount: dead.reduce((sum, group) => sum + group.pids.length, 0),
    orphanCpuPct: round1({ value: dead.reduce((sum, group) => sum + group.cpuPct, 0) }),
    orphans,
    sessions: sessionLoadsOf({ index, processes, treeLimit }),
  };
}

/*
 * The two per-session lines, and why only one of them HOLDS.
 *
 * MEASURED, the incident this module exists for: one ask worker held nineteen tool calls in
 * flight, each stuck 43 minutes on its PreToolUse hooks, while a hook at rest returns in under a second
 * (four live hook processes read `00:01` on this machine; reproduce with
 * `ps -ax -o pid=,etime=,args= | grep pretooluse`). That is three to four orders of magnitude, which is the
 * kind of gap a threshold can sit in without argument.
 *
 * The PARALLEL COUNT cannot hold, and getting that wrong would be worse than not measuring it.
 * `skills/loop-bot/SKILL.md` makes the detective fan-out MANDATORY — "spawn N Haiku sub-agents IN PROCESS …
 * N is COUNTED off the probe, never chosen" — and `skills/loop-bot/reference/detective-fanout.md` records a
 * measured lap of 28 readers, which is how it should be done. Nineteen
 * parallel agents is INSIDE a bot turn's normal range. A hold on the count would fire on correct work every
 * bot turn, and a supervisor would learn within a day to ignore it. So it ALERTS, it names the culprit, and
 * it never stops a spawn.
 *
 * Both numbers are first measurements to ratchet, never to argue past — the same treatment
 * `./capacity.ts`'s compressor and swapfile holds carry.
 */

/** A PreToolUse hook still running after this many seconds HOLDS: measured normal is under one second. */
export const DEFAULT_HOOK_STALL_HOLD_SECONDS = 300;

/** Tool calls in flight at or above this ALERT — above a fan-out wave, below the measured 19. Never a hold. */
export const DEFAULT_PARALLEL_CALL_ALERT = 8;

/**
 * The orphan groups a reap will actually take — a LIVE seat's orphan is a running session's leftover, and
 * counting it as a dead seat would be a claim `machine reap` then contradicts.
 *
 * @param reading the fleet attribution
 * @returns the dead seats' groups, largest attributed CPU first
 */
export function deadSeatOrphans({ reading }: { reading: FleetLoadReading }): readonly OrphanGroup[] {
  return reading.orphans.filter((group) => !group.seatLive);
}

/**
 * A shell snapshot path as the seat a reader recognises — its own file name, never the whole path.
 *
 * @param snapshot the snapshot file's absolute path
 * @returns its file name without the `snapshot-` prefix and `.sh` suffix
 */
export function snapshotLabel({ snapshot }: { snapshot: string }): string {
  const name = snapshot.split("/").at(-1)!; // `split` always yields at least one segment
  return name.replace(/^snapshot-/u, "").replace(/\.sh$/u, "");
}

/**
 * Seconds as the coarse duration a one-line clause wants.
 *
 * @param seconds the elapsed time to describe
 * @returns `18s` under 90 seconds, `43m` under 90 minutes, `26h` above that — one significant scale, never two
 */
export function briefDuration({ seconds }: { seconds: number }): string {
  if (seconds < 90) {
    return `${String(Math.round(seconds))}s`;
  }
  if (seconds < 5400) {
    return `${String(Math.round(seconds / 60))}m`;
  }
  return `${String(Math.round(seconds / 360) / 10)}h`;
}

/**
 * Every session whose longest PreToolUse hook has been stalled past the line — the reading that HOLDS.
 *
 * @param reading the fleet attribution
 * @param stallHoldSeconds the line (defaults to {@link DEFAULT_HOOK_STALL_HOLD_SECONDS})
 * @returns the stalled sessions, largest attributed CPU first
 */
export function stalledSessions({
  reading,
  stallHoldSeconds = DEFAULT_HOOK_STALL_HOLD_SECONDS,
}: {
  reading: FleetLoadReading;
  stallHoldSeconds?: number;
}): readonly SessionLoad[] {
  return reading.sessions.filter(
    (session) => session.hookStallSeconds !== undefined && session.hookStallSeconds >= stallHoldSeconds,
  );
}

/**
 * How a session's longest live hook is named in a report line — the script when the snapshot resolved one,
 * and the honest generic when it did not, never a blank that reads as "no hook".
 *
 * @param script the hook script stem the snapshot resolved, when it resolved one
 * @returns `poll-gate hook` for a resolved script, `oldest PreToolUse hook` otherwise
 */
export function stalledHookLabel({ script }: { script: string | undefined }): string {
  if (script === undefined) {
    return "oldest PreToolUse hook";
  }
  return `${script.replace(/^pretooluse-/u, "")} hook`;
}

/**
 * The text report's fleet lines: one per live session that is costing something, then one per orphan group.
 *
 * @param reading the fleet attribution
 * @param topN how many session rows to print (defaults to 5 — the report already lists processes by memory)
 * @returns the lines, in display order, empty when nothing fleet-owned was found
 */
export function fleetLoadLines({ reading, topN = 5 }: { reading: FleetLoadReading; topN?: number }): readonly string[] {
  const lines: string[] = [];
  for (const session of reading.sessions.slice(0, topN)) {
    const stall =
      session.hookStallSeconds === undefined
        ? "no hook running"
        : `${stalledHookLabel({ script: session.hookStallScript })} ${briefDuration({ seconds: session.hookStallSeconds })}`;
    lines.push(
      `  ${String(session.cpuPct).padStart(6)}% cpu  session ${session.sessionId} (pid ${String(session.pid)}) · ${String(session.processCount)} procs · ${String(session.parallelToolCalls)} in flight · ${String(session.bootsInFlight)} boots · ${stall}`,
    );
  }
  for (const group of reading.orphans) {
    const route = group.seatLive ? "seat still live, not reapable" : "slopweaver machine reap";
    lines.push(
      `  ${String(group.cpuPct).padStart(6)}% cpu  ORPHANS ${String(group.pids.length)} shell(s) from seat ${snapshotLabel({ snapshot: group.snapshot })} — ${route}`,
    );
  }
  return lines;
}
