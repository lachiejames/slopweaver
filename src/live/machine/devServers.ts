/**
 * WHICH docs dev servers are stray — the pure half of the stray-server census.
 *
 * The owner opened Activity Monitor, found NINE `next-server` processes and asked whether they were in use. Eight
 * were `yarn docs` servers that docs-site seats had started to look at their own pages and never stopped,
 * four of them in one worktree: nothing recorded that a server already existed, so every relaunch started
 * another one and Next silently took the next free port. `scripts/docs-site.sh` now keeps that record and
 * has a `--stop`, which fixes the servers a seat starts from here on. This module is the other half — the
 * ones already standing, and the ones a seat leaves behind when it dies before its `--stop` ever runs.
 *
 * ## The criterion, and why each half of it is safe
 *
 * A dev server is STRAY when one of three things holds. Two of them are about the seat that started it:
 *
 * 1. **Its seat is gone** — no live agent session sits in its worktree, AND no live session STARTED it. The
 *    server was started to look at a page, the session that was looking is over, and nothing is reading it.
 * 2. **Its board row is terminal** — `done`, `cancelled` or `rejected` by the DERIVED state
 *    (`../../handover/derivedRowState.ts`), never the authored `status:` line, which is the field that goes
 *    stale. The work shipped; the server outlived it.
 * 3. **It is a DUPLICATE** — a second, third or fourth server in one worktree. The longest-running one
 *    survives, because that is the one the run record names and the one a reader's tab is pointed at. This
 *    is the only member of the class that fires inside a LIVE seat, and it is the exact shape the owner found:
 *    four servers in one worktree on four consecutive ports.
 *
 * ## Unmeasured is never "nothing is live"
 *
 * {@link StrayDevServerInput.liveWorktrees}, {@link StrayDevServerInput.terminalSlugs} and
 * {@link StrayDevServerInput.liveStarterRootPids} are `undefined`-able on purpose, and `undefined` switches
 * that criterion OFF rather than treating the reading as empty. Criterion 1 needs TWO of them, so an
 * unreadable starter record set switches the whole seat criterion off rather than falling back to the
 * worktree half — the half that was measured killing servers in use.
 *
 * If the session registry could not be read and an empty list were taken at face value, criterion
 * 1 would hold for EVERY dev server on the machine — including the one under the seat running the reap. The
 * same discipline `../perf/report.ts` keeps for `hookOverruns`: "nothing was measured" and "nothing was
 * found" are opposite answers.
 *
 * ## What "its seat is gone" can and cannot see
 *
 * A seat is a live AGENT SESSION, read from Claude Code's own registry (`./devServerRead.ts` says why that
 * rather than cmux). So criterion 1 is narrower than "nobody is reading it": a `yarn docs` started by hand
 * from a plain terminal inside a fleet worktree, with no agent session live there, reads as seat-closed and
 * is taken. That is the known limit, stated rather than discovered — found by the
 * `never-kills-a-server-in-use` pass. The MAIN CHECKOUT is where that shape actually happens
 * and {@link inFleetWorktree} excludes it outright; a hand-started server inside a fleet worktree comes
 * back with one `bash scripts/docs-site.sh --start`.
 *
 * ## A seat does not only work in the worktree it LIVES in — {@link StrayDevServerInput.liveStarterRootPids}
 *
 * The worktree a server serves and the worktree its reader sits in are two different facts, and the first
 * version of this module read only the first. MEASURED: session
 * `<session-id>` — live, `busy`, registry cwd
 * `.claude/worktrees.noindex/<seat-worktree>` — ran `cd <sync-now worktree>
 * && bash scripts/docs-site.sh --start --port 3001` nine times in one morning, and once more after. No
 * registry row named the sync-now worktree, so criterion 1 held, `machine reap` killed the
 * server the seat was reading, and the seat started another — which is the server the owner watched
 * reappear under a worktree with no seat (four different pids over the morning). Reap was the restarter.
 *
 * So criterion 1 takes a second reading: the ROOT PIDS whose `scripts/docs-site.sh` run record names a
 * session that is still live. It is keyed on the root pid rather than on the worktree deliberately — a stale
 * record naming a live session would otherwise protect a different, hand-started server that later took the
 * same worktree. A live starter never rescues a DUPLICATE (criterion 3): four servers on four consecutive
 * ports in one worktree is the exact waste the owner found, and the keeper is the one the record names.
 *
 * The cost is one error in the safe direction: a live seat that starts a server and never returns to it
 * holds that server for its whole life. `../reap.ts`'s condition 3 already chose that asymmetry in the same
 * words — a false negative the next tick can take, against killing a running session's work. Its own death,
 * a terminal row and the first duplicate all still take such a server.
 *
 * Its residue, in the same direction: a record outlives the server it names, so if the kernel hands that
 * pid to a LATER dev server while the recorded starter is still live, the newcomer inherits a protection
 * that was never about it. Matching the recorded port too would narrow that, and it is deliberately not
 * done — the consequence is one server left standing a tick or two longer, criterion 3 takes it the moment
 * a second one joins it, and a criterion nobody can state simply is worse than a bounded false negative.
 *
 * ## What is never a target
 *
 * A `next build` — same binary, same family, not a server, and killing one destroys a build a seat is
 * waiting on. A process whose cwd could not be read: unclassifiable, so it is reported and left alone. A
 * pid in the reaping process's own ancestry. And the longest-running server of a worktree, unless that
 * worktree's seat is gone or its row is terminal.
 *
 * This module is the CRITERION only. What a dev server is, and how one is read off a `ps` snapshot, is
 * `./devServerCensus.ts`, which this folds: a file holding both grew past the 300-line bar the
 * `file-size-ratchet` gate keeps, and the seam between "which processes are servers" and "which of them
 * should end" is where it already wanted to split.
 *
 * Pure: a process snapshot, a cwd map and three optional readings in, a plan out.
 * `../../cli/commands/machine/reap.ts` owns the one `process.kill`.
 */

import { basename } from "node:path";
import { sameDirectory } from "#lib/sameDirectory.js";

import { WORKTREES_DIR_NAME, worktreePathKey } from "../../worktree/location.js";
import type { ProcessRow } from "../standing/processes.js";
import { type DevServer, devServers, servingPids } from "./devServerCensus.js";
import type { ProcessCpu, ProcessElapsed } from "./fleetLoad.js";

/** Why one server is stray — the three halves of this module's criterion, in the order they are checked.
 *
 * @internal
 */
export type StrayReason = "seat-closed" | "row-terminal" | "duplicate";

/** One stray server and the reason it qualified — the unit a reap kills and reports. */
export interface StrayDevServer extends DevServer {
  readonly reason: StrayReason;
  /** The sentence the report prints — what caught it, in the owner's terms rather than the criterion's. */
  readonly why: string;
}

/** One server this plan deliberately left alone, and why. A sweep that skips silently is not a report.
 *
 * @internal
 */
export interface DevServerSkip {
  readonly servePid: number;
  /** The worktree it serves, or `undefined` when its cwd could not be read — which is why it was skipped. */
  readonly worktree: string | undefined;
  readonly why: string;
}

/** Everything one snapshot says about the dev servers standing on this machine. */
export interface DevServerPlan {
  readonly stray: readonly StrayDevServer[];
  readonly left: readonly DevServerSkip[];
}

/** What the classifier needs. Every optional reading is `undefined` when it could not be taken. */
export interface StrayDevServerInput {
  /** The decoded `ps -ax -o pid=,ppid=,args=` snapshot. */
  readonly processes: readonly ProcessRow[];
  /** Each candidate pid's current working directory, as `lsof -a -d cwd` reported it. */
  readonly cwdByPid: ReadonlyMap<number, string>;
  /** Worktrees that hold a live agent session, or `undefined` when that registry could not be read. */
  readonly liveWorktrees: readonly string[] | undefined;
  /** Slugs whose board row is terminal, or `undefined` when the board could not be read. */
  readonly terminalSlugs: ReadonlySet<string> | undefined;
  /**
   * The {@link DevServer.rootPid}s whose `scripts/docs-site.sh` run record names a session that is STILL
   * LIVE, or `undefined` when those records could not be read — which switches the seat criterion off
   * entirely rather than leaving its worktree half to fire alone. See this module's header on why a seat
   * working in a worktree it does not live in is the shape that made a reaped server reappear.
   */
  readonly liveStarterRootPids: ReadonlySet<number> | undefined;
  /** Pids nothing here may ever signal — the reaping process's own ancestry. */
  readonly protectedPids: ReadonlySet<number>;
  /** Per-process `%CPU`, for the cost a reap gives back. */
  readonly cpuRows: readonly ProcessCpu[];
  /** Per-process elapsed times, which also decide WHICH duplicate survives. */
  readonly elapsedRows: readonly ProcessElapsed[];
}

/** How long a server has been up, or zero when no elapsed reading was taken for it. */
function upSeconds({ server }: { server: DevServer }): number {
  if (server.elapsedSeconds === undefined) {
    return 0;
  }
  return server.elapsedSeconds;
}

/**
 * Whether a server's directory is a FLEET worktree — the boundary that keeps the owner's own server safe.
 *
 * A worktree exists because a seat was opened for a row, so "the seat is gone" is a statement that can be
 * made about it. The main checkout is not that: `/…/slopweaver/site` is where the owner reads the docs,
 * from a terminal no session registry knows about, and a criterion built on seats would call that stray
 * within minutes. Measured — one of the three live Next processes on this machine was exactly
 * that server, in the main checkout.
 */
function inFleetWorktree({ worktree }: { worktree: string }): boolean {
  return worktreePathKey({ path: worktree }).includes(`/.claude/${WORKTREES_DIR_NAME}/`);
}

/** Whether any live agent session sits in this worktree — asked only when the registry WAS read. */
function seatIsLive({ worktree, liveWorktrees }: { worktree: string; liveWorktrees: readonly string[] }): boolean {
  return liveWorktrees.some((live) => sameDirectory({ left: live, right: worktree }));
}

/**
 * Whether a live session is reading this server — either because one sits in its worktree, or because the
 * session that STARTED it is still live. Both readings must have been taken; the caller checks that first.
 */
function serverHasAReader({
  server,
  liveWorktrees,
  liveStarterRootPids,
}: {
  server: DevServer;
  liveWorktrees: readonly string[];
  liveStarterRootPids: ReadonlySet<number>;
}): boolean {
  if (seatIsLive({ liveWorktrees, worktree: server.worktree })) {
    return true;
  }
  return liveStarterRootPids.has(server.rootPid);
}

/** The longest-running server of a group, which a `duplicate` verdict never touches. */
function longestRunning({ group }: { group: readonly DevServer[] }): DevServer {
  return group.reduce((oldest, server) => {
    if (upSeconds({ server }) > upSeconds({ server: oldest })) {
      return server;
    }
    return oldest;
  }, group[0]!); // callers only ever pass a non-empty group
}

/** The three criteria, in order, for one server — or `undefined` when none of them holds. */
function verdictFor({
  server,
  input,
  keeper,
}: {
  server: DevServer;
  input: StrayDevServerInput;
  keeper: DevServer;
}): { readonly reason: StrayReason; readonly why: string } | undefined {
  const slug = basename(server.worktree);
  const { liveStarterRootPids, liveWorktrees } = input;
  if (
    liveWorktrees !== undefined &&
    liveStarterRootPids !== undefined &&
    !serverHasAReader({ liveStarterRootPids, liveWorktrees, server })
  ) {
    return {
      reason: "seat-closed",
      why: `no live agent session sits in ${server.worktree}, and the session that started it is gone`,
    };
  }
  // `=== true` rather than a bare truthiness test: an absent reading is `undefined`, which is the
  // criterion switched OFF, and the two must never collapse into the same branch.
  if (input.terminalSlugs?.has(slug) === true) {
    return { reason: "row-terminal", why: `the board row ${slug} is done or closed` };
  }
  if (server.servePid !== keeper.servePid) {
    return {
      reason: "duplicate",
      why: `a second server in ${server.worktree} — pid ${String(keeper.servePid)} has been up longer and keeps serving it`,
    };
  }
  return undefined;
}

/**
 * Why a server that qualified on nothing was left alone, said in the terms the criteria were checked in.
 *
 * The third clause distinguishes the only server in a worktree from the KEEPER of a worktree that has
 * several — "the only server" printed beside a duplicate this same run is taking is a false sentence, and
 * the keeper line is the one a reader checks the duplicate verdict against.
 */
function leftAloneBecause({
  input,
  groupSize,
  server,
}: {
  input: StrayDevServerInput;
  groupSize: number;
  server: DevServer;
}): string {
  const { liveStarterRootPids, liveWorktrees, terminalSlugs } = input;
  const unmeasured: string[] = [];
  if (liveWorktrees === undefined) {
    unmeasured.push("the live agent sessions could not be read");
  }
  if (liveStarterRootPids === undefined) {
    unmeasured.push("the docs-site run records could not be read");
  }
  if (terminalSlugs === undefined) {
    unmeasured.push("the board could not be read");
  }
  if (liveWorktrees === undefined || liveStarterRootPids === undefined || terminalSlugs === undefined) {
    return `${unmeasured.join(" and ")}, so that criterion was not applied`;
  }
  // Named only when NO seat sits in the worktree: with one there, the sentences below are the true ones and
  // this one would describe the reader that happens to be furthest from the server.
  if (!seatIsLive({ liveWorktrees, worktree: server.worktree }) && liveStarterRootPids.has(server.rootPid)) {
    return "the session that started it is still live, in a worktree of its own";
  }
  if (groupSize > 1) {
    return `its seat is live, its row is open, and of the ${String(groupSize)} servers in its worktree it has been up longest`;
  }
  return "its seat is live, its row is open, and it is the only server in its worktree";
}

/**
 * Decide one snapshot: which dev servers are stray, which are left and why.
 *
 * @param input the snapshot and the three optional readings — see this module's header on why `undefined`
 *   switches a criterion off rather than reading as an empty result
 * @returns the plan
 */
export function strayDevServers({ input }: { input: StrayDevServerInput }): DevServerPlan {
  const byWorktree = groupByWorktree({
    servers: devServers({
      cpuRows: input.cpuRows,
      cwdByPid: input.cwdByPid,
      elapsedRows: input.elapsedRows,
      processes: input.processes,
    }),
  });
  const stray: StrayDevServer[] = [];
  const left: DevServerSkip[] = [...unreadableCwdSkips({ input })];
  for (const [worktree, group] of byWorktree) {
    const verdicts = classifyGroup({ group, input, worktree });
    stray.push(...verdicts.stray);
    left.push(...verdicts.left);
  }
  return { left, stray };
}

/** The census indexed by the worktree each server serves, which is the unit a duplicate verdict compares. */
function groupByWorktree({ servers }: { servers: readonly DevServer[] }): ReadonlyMap<string, DevServer[]> {
  const byWorktree = new Map<string, DevServer[]>();
  for (const server of servers) {
    const group = byWorktree.get(server.worktree);
    if (group === undefined) {
      byWorktree.set(server.worktree, [server]);
      continue;
    }
    group.push(server);
  }
  return byWorktree;
}

/**
 * A serving pid whose cwd the `lsof` could not answer for is REPORTED, never dropped: with no working
 * directory there is no worktree, so not one of the three criteria could be evaluated against it.
 */
function unreadableCwdSkips({ input }: { input: StrayDevServerInput }): readonly DevServerSkip[] {
  return servingPids({ processes: input.processes })
    .filter((servePid) => !input.cwdByPid.has(servePid))
    .map((servePid) => ({
      servePid,
      why: "its working directory could not be read, so no criterion could be evaluated",
      worktree: undefined,
    }));
}

/** One worktree's servers, split into what this plan takes and what it leaves with the reason printed. */
function classifyGroup({
  group,
  input,
  worktree,
}: {
  group: readonly DevServer[];
  input: StrayDevServerInput;
  worktree: string;
}): { readonly left: readonly DevServerSkip[]; readonly stray: readonly StrayDevServer[] } {
  const keeper = longestRunning({ group });
  const stray: StrayDevServer[] = [];
  const left: DevServerSkip[] = [];
  for (const server of group) {
    if (server.treePids.some((pid) => input.protectedPids.has(pid))) {
      left.push({ servePid: server.servePid, why: "this process's own parent chain runs through it", worktree });
      continue;
    }
    if (!inFleetWorktree({ worktree })) {
      left.push({ servePid: server.servePid, why: "it is not in a fleet worktree — no seat owns it", worktree });
      continue;
    }
    const verdict = verdictFor({ input, keeper, server });
    if (verdict === undefined) {
      left.push({
        servePid: server.servePid,
        why: leftAloneBecause({ groupSize: group.length, input, server }),
        worktree,
      });
      continue;
    }
    stray.push({ ...server, reason: verdict.reason, why: verdict.why });
  }
  return { left, stray };
}
