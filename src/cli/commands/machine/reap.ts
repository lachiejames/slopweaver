/**
 * `slopweaver machine reap` — kill the orphaned fleet shells whose seat is dead, stray docs dev servers, dead
 * openers' browser sessions and runaway searches inside live seats, and report what it killed.
 *
 * After a load incident: 64 orphaned `zsh` shells at 10-13% CPU each held
 * the machine at load 100-146 for over two hours against a hold of 22, and the supervisor reported the hold
 * every tick without ever finding them. Their ask was for a verb the sweep runs every tick that needs no
 * judgement — "had I known all the circumstances I would have just said kill them".
 *
 * So there is nothing to decide here: `../../../live/machine/reap.ts` computes the whole plan from one `ps`
 * snapshot and this file owns the single `process.kill`. `--dry-run` prints the plan and signals nothing,
 * which is the shape every test drives.
 *
 * Effectful shell only.
 */
import { execFileSync } from "node:child_process";

import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { devServers, servingPids } from "../../../live/machine/devServerCensus.js";
import {
  liveSeatWorktrees,
  readCwds,
  readLiveStarterRootPids,
  terminalRowSlugs,
} from "../../../live/machine/devServerRead.js";
import { type DevServerPlan, type StrayDevServerInput, strayDevServers } from "../../../live/machine/devServers.js";
import {
  type ProcessCpu,
  type ProcessElapsed,
  parseElapsedRows,
  parseTopCpuRows,
} from "../../../live/machine/fleetLoad.js";
import { ownAncestry, type ReapOutcome, type ReapPlan, reapPlan, renderReapLines } from "../../../live/machine/reap.js";
import { type RunawaySearch, runawaySearches, stillUnderLiveSeat } from "../../../live/machine/runawaySearch.js";
import { signalSelectedTrees } from "../../../live/machine/signalSelectedTrees.js";
import { type ProcessRow, parseProcessRows } from "../../../live/standing/processes.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { productionBrowserReapDeps } from "./browserReapDeps.js";
import { type BrowserReapDeps, reapBrowserSessions } from "./reapBrowser.js";

export const MACHINE_REAP_USAGE =
  "usage: slopweaver machine reap [--dry-run] [--json]\n" +
  "  Kill every ORPHANED fleet shell whose seat is dead, and their whole descendant trees, deepest first.\n" +
  "  A shell qualifies on three facts read from one `ps` snapshot: its argv sources a Claude Code shell\n" +
  "  snapshot (~/.claude/shell-snapshots/snapshot-*.sh), its parent is launchd, and NO un-reparented\n" +
  "  process shares that snapshot — so the session that made it is gone. Nothing else is ever signalled:\n" +
  "  never launchd, and never this process's own parent chain. Prints one line per shell it killed with\n" +
  "  the pid, the descendants, the CPU it gave back and the seat it belonged to, plus one line per orphan\n" +
  "  it deliberately left alone and why.\n" +
  "  It re-reads the table immediately before signalling and drops any pid whose argv moved, so a pid the\n" +
  "  kernel recycled between the plan and the kill is reported rather than signalled.\n" +
  "  It also reaps STRAY DOCS DEV SERVERS: a `next dev`/`next start` in a fleet\n" +
  "  worktree whose seat is gone, whose board row is done or closed, or which is a duplicate of a server\n" +
  "  already serving that worktree — the longest-running one always survives. Never a `next build`, never\n" +
  "  a server in the main checkout, and never one whose seat is live and row open.\n" +
  "  A seat is gone only when NO live session sits in the worktree AND no live session started the server:\n" +
  "  a session working in a worktree it does not live in is read off the docs-site run record, because a\n" +
  "  reap that took those servers is what made one reappear nine times in a morning.\n" +
  "  It also reaps BROWSER SESSIONS by the liveness of whoever opened them, never by age from open:\n" +
  "  a session whose opener's Claude Code pid is dead is closed, a background session idle past its\n" +
  "  15-minute expiry is closed whoever opened it, since no command may act through it, one\n" +
  "  whose owner is unknown and whose localhost page has nothing listening is closed, and a record no\n" +
  "  Playwright daemon holds any more is forgotten. A live opener's session in use, or shown in the\n" +
  "  foreground, is kept. A close the client cannot confirm is reported UNKNOWN, never retried, and defers the rest to the\n" +
  "  next tick; its daemon is sent SIGTERM only when exactly one still carries that session.\n" +
  "  It also reaps RUNAWAY SEARCHES inside LIVE seats: a grep, egrep, fgrep, ugrep, ug, rg or\n" +
  "  ggrep running under a Claude Code tool shell, older than 600s (the Bash tool's foreground ceiling, so no\n" +
  "  foreground call still waits on it) and at 20% cpu or more in the sample. Only the search is killed —\n" +
  "  never its shell, never its seat — and a search with no cpu sample is never taken.\n" +
  "  An unreadable process table reaps nothing at all.\n" +
  "  --dry-run plans and signals nothing. Exit 0 whatever it finds — an empty reap is a clean machine.";

const FLAGS: FlagSpec = { boolean: ["dry-run", "json"], string: [] };

/** `--`-prefixed, for the help-truth ratchet. */
export const MACHINE_REAP_FLAG_NAMES: readonly string[] = ["--dry-run", "--json"];

/**
 * Parse `machine reap`'s flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseMachineReapArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** The read seams a reap needs, injected so a test never shells out and never signals anything real. */
export interface MachineReapDeps extends BrowserReapDeps {
  /**
   * The process table, or `undefined` when `ps` could not be read — never an empty table: every class here
   * reads an ABSENT process as dead, so an unreadable machine read as an empty one would reap everything.
   */
  readonly processes: () => readonly ProcessRow[] | undefined;
  readonly elapsed: () => readonly ProcessElapsed[];
  readonly cpuRows: () => readonly ProcessCpu[];
  /** Signal one pid; returns the reason it failed, or `undefined` when the signal went out. */
  readonly kill: (input: { pid: number }) => string | undefined;
  readonly selfPid: () => number;
  /**
   * Each candidate pid's working directory. A `next-server`'s own argv names nothing at all, so this is the
   * only reading that places one in a worktree — see `../../../live/machine/devServerRead.ts`.
   */
  readonly cwds: (input: { pids: readonly number[] }) => ReadonlyMap<number, string>;
  /** Worktrees holding a live seat, or `undefined` when the session registry could not be read. */
  readonly liveWorktrees: (input: { processes: readonly ProcessRow[] }) => readonly string[] | undefined;
  /**
   * The dev-server root pids whose docs-site run record names a session that is still live — a seat working
   * in a worktree it does not LIVE in, which is the shape a reap was measured killing mid-read. `undefined`
   * when those records could not be read.
   */
  readonly liveStarterRootPids: (input: { processes: readonly ProcessRow[] }) => ReadonlySet<number> | undefined;
  /** Which of these worktrees' board rows are terminal, or `undefined` when no row could be read. */
  readonly terminalSlugs: (input: { worktrees: readonly string[] }) => ReadonlySet<string> | undefined;
}

/** More stdout than a `ps`/`top` snapshot produces, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** How long any one read may block. Each is a single local snapshot — quick, or broken. */
const READ_TIMEOUT_MS = 10_000;

/** One local snapshot's stdout, or `undefined` when it failed. */
function snapshotText({ file, args }: { file: string; args: readonly string[] }): string | undefined {
  try {
    return execFileSync(file, [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/**
 * The real seams: actual `ps`, `top` and `process.kill`.
 *
 * @returns the production {@link MachineReapDeps}
 */
export function productionMachineReapDeps(): MachineReapDeps {
  return {
    ...productionBrowserReapDeps({ home: slopweaverHome() }),
    cpuRows: () => {
      const text = snapshotText({ args: ["-l", "2", "-s", "1", "-stats", "pid,cpu"], file: "top" });
      return text === undefined ? [] : parseTopCpuRows({ text });
    },
    cwds: ({ pids }) => readCwds({ pids }),
    elapsed: () => {
      const text = snapshotText({ args: ["-ax", "-o", "pid=,etime="], file: "ps" });
      return text === undefined ? [] : parseElapsedRows({ text });
    },
    kill: ({ pid }) => {
      try {
        process.kill(pid, "SIGKILL");
        return undefined;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    liveStarterRootPids: ({ processes }) => readLiveStarterRootPids({ processes }),
    liveWorktrees: ({ processes }) => liveSeatWorktrees({ processes }),
    processes: () => {
      const text = snapshotText({ args: ["-ax", "-o", "pid=,ppid=,args="], file: "ps" });
      return text === undefined ? undefined : parseProcessRows({ text });
    },
    selfPid: () => process.pid,
    terminalSlugs: ({ worktrees }) => terminalRowSlugs({ worktrees }),
  };
}

/*
 * Gather what the stray-dev-server classifier needs, in the one order the readings allow.
 *
 * The cwd read is what bounds this: only a process already matching `next dev`/`next start` is asked for
 * one, and only the worktrees those cwds resolve to have their board rows read. Each of the optional
 * readings stay `undefined` when they fail — `../../../live/machine/devServers.ts`'s header says why that
 * is not the same as an empty list.
 */
function devServerInput({
  processes,
  cpuRows,
  elapsedRows,
  selfPid,
  deps,
}: {
  processes: readonly ProcessRow[];
  cpuRows: readonly ProcessCpu[];
  elapsedRows: readonly ProcessElapsed[];
  selfPid: number;
  deps: MachineReapDeps;
}): StrayDevServerInput {
  const cwdByPid = deps.cwds({ pids: servingPids({ processes }) });
  const worktrees = [
    ...new Set(devServers({ cpuRows, cwdByPid, elapsedRows, processes }).map((server) => server.worktree)),
  ];
  return {
    cpuRows,
    cwdByPid,
    elapsedRows,
    liveStarterRootPids: deps.liveStarterRootPids({ processes }),
    liveWorktrees: deps.liveWorktrees({ processes }),
    processes,
    protectedPids: ownAncestry({ processes, selfPid }),
    terminalSlugs: deps.terminalSlugs({ worktrees }),
  };
}

/**
 * Signal every pid the plan named, deepest first within each target, collecting what failed.
 *
 * It re-reads the process table FIRST and drops any pid whose argv has moved since the plan selected it. The
 * plan and the signal are seconds apart — the `top -l 2 -s 1` sample alone blocks ~1.45 s — and a pid the
 * kernel recycled in that window points at a different process, most likely at load 146 where fork churn is
 * highest and this verb is needed most.
 */
function executePlan({
  plan,
  devServerPlan,
  searches,
  deps,
}: {
  plan: ReapPlan;
  devServerPlan: DevServerPlan;
  searches: readonly RunawaySearch[];
  deps: MachineReapDeps;
}): Pick<ReapOutcome, "failed" | "killed"> {
  const signalled = signalSelectedTrees({
    kill: deps.kill,
    processes: rereadProcesses({ deps }),
    targets: [...plan.targets, ...devServerPlan.stray],
  });
  const killed = [...signalled.killed];
  const failed = [...signalled.failed];
  for (const search of searches) {
    const one = signalOneSearch({ deps, search });
    killed.push(...one.killed);
    failed.push(...one.failed);
  }
  return { failed, killed };
}

/** The process table read again now — empty when unreadable, so every target reads as moved and none is signalled. */
function rereadProcesses({ deps }: { deps: MachineReapDeps }): readonly ProcessRow[] {
  const reread = deps.processes();
  if (reread === undefined) {
    return [];
  }
  return reread;
}

/**
 * Signal one runaway search against a table read for it alone, immediately before its own signal — so killing
 * one search can never act on a table that predates the kill of another.
 * A search is this class's only while its seat lives: one whose seat ended since the plan is left, not taken.
 */
function signalOneSearch({
  search,
  deps,
}: {
  search: RunawaySearch;
  deps: MachineReapDeps;
}): Pick<ReapOutcome, "failed" | "killed"> {
  const rows = rereadProcesses({ deps });
  if (!stillUnderLiveSeat({ processes: rows, search })) {
    return {
      failed: [
        {
          pid: search.pid,
          why: "it is no longer a search under the same live seat — the seat ended, or the pid was reused",
        },
      ],
      killed: [],
    };
  }
  return signalSelectedTrees({ kill: deps.kill, processes: rows, targets: [search] });
}

/**
 * Run `machine reap` over injected seams — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `machine reap <tail>`)
 * @param deps the read and kill seams (defaults to the real `ps`/`top`/`process.kill`)
 * @returns `EXIT_OK` whatever it found (an empty reap is a clean machine), `EXIT_USAGE` on a bad flag
 */
export function runMachineReapWithDeps({
  argv,
  deps = productionMachineReapDeps(),
}: {
  argv: readonly string[];
  deps?: MachineReapDeps;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: MACHINE_REAP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMachineReapArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, MACHINE_REAP_USAGE].forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_USAGE;
  }
  const dryRun = parsed.value.values["dry-run"] === true;
  // ONE snapshot for both classes: an orphaned shell and a stray dev server are two readings of the same
  // instant, and taking the table twice would let them disagree about which processes existed.
  const processes = deps.processes();
  if (processes === undefined) {
    logger.out({ line: "machine reap: the process table could not be read — nothing reaped, nothing forgotten" });
    return EXIT_OK;
  }
  const cpuRows = deps.cpuRows();
  const elapsedRows = deps.elapsed();
  const selfPid = deps.selfPid();
  const plan = reapPlan({ cpuRows, elapsedRows, processes, selfPid });
  const devServerPlan = strayDevServers({
    input: devServerInput({ cpuRows, deps, elapsedRows, processes, selfPid }),
  });
  // Disjoint from the orphan plan by construction: a runaway search needs a LIVE session above its shell, and an
  // orphaned shell's parent is launchd, so no pid is ever selected by both.
  const protectedPids = ownAncestry({ processes, selfPid });
  const searches = runawaySearches({ cpuRows, elapsedRows, processes, protectedPids });
  const executed = dryRun ? { failed: [], killed: [] } : executePlan({ deps, devServerPlan, plan, searches });
  const outcome: ReapOutcome = {
    browser: reapBrowserSessions({ deps, dryRun, processes }),
    devServers: devServerPlan,
    dryRun,
    failed: executed.failed,
    killed: executed.killed,
    plan,
    searches,
  };
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(outcome) });
    return EXIT_OK;
  }
  for (const line of renderReapLines({ outcome })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run the `machine reap` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — see {@link runMachineReapWithDeps}
 */
export function runMachineReap(argv: readonly string[]): number {
  return runMachineReapWithDeps({ argv });
}

export const machineReapCommand = defineCommand({ run: runMachineReap });
