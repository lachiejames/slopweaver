/**
 * WHICH processes a closed fleet worktree left behind — the pure half of the worktree-residue reaper.
 *
 * ## The class
 *
 * An nx workspace starts a daemon the first time a command in it runs and detaches it to `launchd`, so it
 * outlives the seat that started it. In one measured case five acme-admin worktree daemons (230-400 MB each) were
 * standing behind seats that had long closed, part of a machine held at load 45.9, and were killed by hand.
 * `../../cmux/fleetEnv.ts` stops a fleet-worktree seat starting one; this is what clears one that started
 * anyway — a seat booted before that prefix existed, a hand-opened shell, a tool that ignores the switch.
 *
 * ## The criterion, read from one `ps` snapshot and one `lsof` over its candidates
 *
 * A process is residue of a worktree when all three hold:
 *
 * 1. **It is a node process** — its argv's first token is a `node` binary. Every nx daemon and plugin worker
 *    is one, and nothing else this module could reach is its business.
 * 2. **It WORKS in the worktree** — `lsof` read its working directory as the worktree or under it. Compared
 *    by `worktreePathKey`, so `/private/tmp` and `worktrees.noindex` spellings of one tree agree, and bounded
 *    by `/` so `wt-1` never claims `wt-10`'s processes. A process whose argv merely NAMES the worktree is
 *    reported and left: a browser-session daemon run from a worktree's `node_modules` works under
 *    `$SLOPWEAVER_HOME` for seats outside it, and a cwd `lsof` did not return (it exits non-zero, and answers
 *    nothing, when one pid in its batch has gone) is no evidence either way. nx starts its daemon in the
 *    workspace root, so the class this exists for is placed by its cwd. Both found in review of this change.
 * 3. **It is orphaned** — its parent is `launchd`. A node process in the worktree whose parent is still
 *    running belongs to something live, and a seat legitimately works in a worktree it does not LIVE in
 *    (`./devServers.ts` measured a reap killing a server a live session was reading, nine times in one
 *    morning). Such a process is REPORTED as skipped with that reason, never signalled; if its owner dies it
 *    is orphaned and the next close or `machine reap` pass sees it.
 *
 * The caller owns the fourth condition, which needs registers this module does not read: no surviving live
 * workspace or open ledger row still holds the worktree (`../../cli/commands/cmux/worktreeResidue.ts`).
 *
 * ## The same guards `./reap.ts` keeps
 *
 * A target is its whole descendant tree, deepest first, so killing the daemon cannot reparent its workers to
 * `launchd` minus the argv that makes them findable. A tree running through this process's own parent chain
 * or through `launchd` is skipped. Every pid carries the argv it had when it was selected, for the re-check
 * immediately before the signal (`./reap.ts`'s `stillTheSameProcess`).
 *
 * Pure: a snapshot in, a plan out.
 */
import { basename } from "node:path";

import { WORKTREES_DIR_NAME, worktreePathKey } from "../../worktree/location.js";
import type { ProcessRow } from "../standing/processes.js";
import { childIndexOf } from "./fleetLoad.js";
import { treeDeepestFirst } from "./processTree.js";

/** The pid every orphan reparents to, and the one pid nothing here may ever signal. */
const LAUNCHD_PID = 1;

/** One residue process and everything under it — the unit a close reaps and reports. */
interface ResidueTarget {
  readonly rootPid: number;
  /** What it is, named without its argv — `nx daemon` or `node`. An argv can carry a token; a label cannot. */
  readonly label: string;
  /** Its whole tree, DEEPEST FIRST, itself last: the exact order the signals go out in. */
  readonly treePids: readonly number[];
  /** What each pid in {@link treePids} was running when selected — what the signal is re-checked against. */
  readonly argvByPid: Readonly<Record<string, string>>;
}

/** A node process rooted in the worktree that this plan deliberately left alone, and why. */
interface ResidueSkip {
  readonly pid: number;
  readonly label: string;
  readonly why: string;
}

/** Everything one snapshot says to do about one worktree. */
export interface WorktreeResiduePlan {
  readonly worktree: string;
  readonly targets: readonly ResidueTarget[];
  readonly skipped: readonly ResidueSkip[];
}

/**
 * Whether an argv runs a `node` binary — its first whitespace token's basename is exactly `node`.
 *
 * @param argv the full command line as `ps` printed it
 * @returns whether this is a node process
 */
export function isNodeArgv({ argv }: { argv: string }): boolean {
  const first = argv.trimStart().split(/\s+/u)[0];
  if (first === undefined || first.length === 0) {
    return false;
  }
  return basename(first) === "node";
}

/**
 * Whether a path is a directory or sits under it, compared by `worktreePathKey` and bounded by `/`.
 *
 * @param path the absolute path to place
 * @param root the worktree it may be under
 * @returns whether `path` is `root` or a descendant of it
 */
export function pathRootedIn({ path, root }: { path: string; root: string }): boolean {
  const key = worktreePathKey({ path });
  const rootKey = worktreePathKey({ path: root });
  return key === rootKey || key.startsWith(`${rootKey}/`);
}

/**
 * The worktree a seat's directory sits in — the first entry under a checkout's worktrees directory, in its
 * `worktreePathKey` spelling. A reap addresses the WHOLE worktree, never the subdirectory a seat happened to
 * open in, so a seat in `wt/apps/web` and one at `wt` hold the same tree. Resolved before it is compared, so
 * a `..` spelling that climbs back out into the checkout is not a worktree at all.
 *
 * @param path the seat's directory, any spelling
 * @param checkout the main checkout that owns it
 * @returns the worktree's root, or `undefined` when the path is not inside one of the checkout's worktrees
 */
export function worktreeRootOf({ path, checkout }: { path: string; checkout: string }): string | undefined {
  const prefix = `${worktreePathKey({ path: checkout })}/.claude/${WORKTREES_DIR_NAME}/`;
  const key = worktreePathKey({ path });
  if (!key.startsWith(prefix)) {
    return undefined;
  }
  const [name] = key.slice(prefix.length).split("/");
  if (name === undefined || name === "") {
    return undefined;
  }
  return `${prefix}${name}`;
}

/**
 * Every live reference holding any part of a worktree — a live path at its root or anywhere under it. An exact
 * lookup misses a co-tenant working in a subdirectory, while the reap covers the whole tree. A live path ABOVE
 * the root does not hold it: the main checkout sits above every worktree, and its seats do not live in them.
 *
 * @param live resolved path key to the references still holding it
 * @param root the worktree root the reap would address
 * @returns the references holding it, empty when nothing does
 */
export function referencesHolding({
  live,
  root,
}: {
  live: ReadonlyMap<string, readonly string[]>;
  root: string;
}): readonly string[] {
  return [...live].flatMap(([path, refs]) => (pathRootedIn({ path, root }) ? refs : []));
}

/**
 * Whether any absolute path in an argv is rooted in the worktree — a bare token, or the value of a
 * `--flag=/path` token.
 *
 * @param argv the full command line as `ps` printed it
 * @param root the worktree
 * @returns whether the command line names a path inside it
 */
export function argvRootedIn({ argv, root }: { argv: string; root: string }): boolean {
  return argv
    .split(/\s+/u)
    .map((token) => token.slice(token.indexOf("=") + 1))
    .some((token) => token.startsWith("/") && pathRootedIn({ path: token, root }));
}

/**
 * The pids worth an `lsof` cwd read: orphaned node processes. Bounded, so the read never spans the table.
 *
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @returns the candidate pids
 */
export function residueCandidatePids({ processes }: { processes: readonly ProcessRow[] }): readonly number[] {
  return processes.filter((row) => row.ppid === LAUNCHD_PID && isNodeArgv({ argv: row.argv })).map((row) => row.pid);
}

/** A residue process's label: `nx daemon` when its argv runs nx's daemon, `node` otherwise. */
function labelOf({ argv }: { argv: string }): string {
  if (/\/nx\/\S*daemon/u.test(argv)) {
    return "nx daemon";
  }
  return "node";
}

/**
 * Where one node process stands relative to the worktree: `works-in` it by its read cwd, `argv-only` when it
 * only NAMES it — working elsewhere, or with a cwd `lsof` did not return — or `undefined` for neither. Only
 * `works-in` is ever reaped; an `argv-only` one is reported with why (criterion 2 in the header).
 */
function placementOf({
  row,
  cwdByPid,
  worktree,
}: {
  row: ProcessRow;
  cwdByPid: ReadonlyMap<number, string>;
  worktree: string;
}): { readonly kind: "works-in" } | { readonly kind: "argv-only"; readonly why: string } | undefined {
  const cwd = cwdByPid.get(row.pid);
  if (cwd !== undefined && pathRootedIn({ path: cwd, root: worktree })) {
    return { kind: "works-in" };
  }
  if (!argvRootedIn({ argv: row.argv, root: worktree })) {
    return undefined;
  }
  if (cwd === undefined) {
    return { kind: "argv-only", why: "it names the worktree but its working directory could not be read" };
  }
  return { kind: "argv-only", why: `it names the worktree but works in ${cwd}, so a seat elsewhere may use it` };
}

/**
 * Decide one worktree: which orphaned node processes rooted in it to reap, which rooted ones to leave and why.
 *
 * @param worktree the closed seat's directory
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` snapshot
 * @param cwdByPid the working directory of each {@link residueCandidatePids} pid `lsof` could answer for
 * @param protectedPids this process's own parent chain, which no target may run through
 * @returns the plan
 */
export function worktreeResiduePlan({
  worktree,
  processes,
  cwdByPid,
  protectedPids,
}: {
  worktree: string;
  processes: readonly ProcessRow[];
  cwdByPid: ReadonlyMap<number, string>;
  protectedPids: ReadonlySet<number>;
}): WorktreeResiduePlan {
  const children = childIndexOf({ processes });
  const argvByPid = new Map(processes.map((row) => [row.pid, row.argv]));
  const targets: ResidueTarget[] = [];
  const skipped: ResidueSkip[] = [];
  const parented: ProcessRow[] = [];
  // Every pid under an orphan this plan decided about, reaped or not — its descendants are that decision's.
  const covered = new Set<number>();
  for (const row of processes.filter((candidate) => isNodeArgv({ argv: candidate.argv }))) {
    const placement = placementOf({ cwdByPid, row, worktree });
    if (placement === undefined) {
      continue;
    }
    const label = labelOf({ argv: row.argv });
    if (row.ppid !== LAUNCHD_PID) {
      parented.push(row);
      continue;
    }
    if (placement.kind === "argv-only") {
      skipped.push({ label, pid: row.pid, why: placement.why });
      continue;
    }
    const treePids = treeDeepestFirst({ childrenByPpid: children, root: row.pid });
    treePids.forEach((pid) => covered.add(pid));
    if (treePids.some((pid) => protectedPids.has(pid) || pid === LAUNCHD_PID)) {
      skipped.push({ label, pid: row.pid, why: "this process's own parent chain runs through it" });
      continue;
    }
    targets.push({
      // Every tree pid came from this same snapshot, so each one has its argv.
      argvByPid: Object.fromEntries(treePids.map((pid) => [String(pid), String(argvByPid.get(pid))])),
      label,
      rootPid: row.pid,
      treePids,
    });
  }
  // A parented node process under an orphan decided above — an nx plugin worker under its daemon — goes with
  // that tree, so only one standing on its own is reported as left alone.
  for (const row of parented.filter((candidate) => !covered.has(candidate.pid))) {
    skipped.push({
      label: labelOf({ argv: row.argv }),
      pid: row.pid,
      why: `its parent ${String(row.ppid)} is still running, so something live owns it`,
    });
  }
  return { skipped, targets, worktree };
}
