/**
 * Reclaiming the worktrees of the seats a `session close-done` sweep has just closed — the effectful half of
 * `../../../sessions/closeDonePrune.ts`.
 *
 * Its own module rather than more of `./closeDone.ts`, along the same seam every verb here is split on: the
 * sweep decides which chats are over, and this decides what is left behind by the ones that were.
 *
 * ## Three reads that are rails rather than conveniences
 *
 * **The live workspace list is re-read AFTER the closes.** It is one of the two registers that say a tree is
 * in use, and the list gathered at the top of the sweep still holds every workspace this pass has since
 * closed. A list that FAILS to read reclaims nothing at all, with the reason printed: a socket that did not
 * answer is not a list of zero workspaces, which is the identical rail `worktree prune --apply` keeps.
 *
 * **The seats this pass swept are subtracted by ID, never by path.** A dispatch child reuses its parent's
 * checkout by design, so several live sessions share one directory and dropping every workspace at a path
 * would delete a tree another session is still working in. Subtracting the one workspace id leaves any
 * genuine co-tenant in the index, where it holds the tree exactly as it should.
 *
 * **The session ledger is re-read too**, for the same reason and with the same subtraction: a dry run
 * appends no `closed` event, so without it every seat would report itself as the live reference holding its
 * own worktree.
 *
 * ## It only ever touches a DECLARED main checkout's worktrees
 *
 * A seat under no declared checkout is left alone and said so. A session can be spawned anywhere, and
 * removing a directory outside this install's own worktree homes would be the sweep acting past its remit —
 * `docs/main-checkouts/declarations-and-freshness.md` is the register, and it is the one `worktree prune` reads too.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { logger } from "../../../lib/logger.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import type { CmuxHostSurface } from "../../../sessionHarness/cmuxHost.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import {
  decideSeatPrune,
  renderSeatPrune,
  repoOwningWorktree,
  type SeatPruneDecision,
  type SeatPruneOutcome,
} from "../../../sessions/closeDonePrune.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { worktreePathKey } from "../../../worktree/location.js";
import { applyVerdict, type PruneOutcome } from "../../../worktree/pruneApply.js";
import { scanWorktree } from "../../../worktree/pruneScan.js";
import { reclaimTrashDir } from "../../../worktree/reclaimTrash.js";
import { recyclePoolDir } from "../../../worktree/recyclePool.js";
import { liveReferenceIndex } from "../worktree/core.js";
import { type RepoContext, repoContext } from "./closeDoneRepoContext.js";

/** One seat this pass closed, and where it was standing. */
export interface ClosedSeat {
  /** The row's name, as the sweep prints it. */
  readonly name: string;
  /** The workspace's own directory, as cmux reported it. */
  readonly directory: string;
  /** cmux's id for that workspace, so it can be subtracted from the refreshed live list. */
  readonly workspaceId: string;
  /** The ledger key of the row that was closed, so it can be subtracted from the refreshed ledger. */
  readonly sessionKey: string;
}

/**
 * The seats a sweep closed, in the shape the reclaim addresses them by.
 *
 * A dry run closed nothing, and its `closed` outcomes are still the right input: the reclaim subtracts them
 * from the refreshed registers itself, so what it reports is what a real run would have done rather than
 * every seat holding its own worktree open.
 *
 * @param outcomes every row's outcome
 * @returns one entry per closed seat
 */
export function closedSeats({ outcomes }: { readonly outcomes: readonly CloseDoneOutcome[] }): readonly ClosedSeat[] {
  const seats: ClosedSeat[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind !== "closed") {
      continue;
    }
    const { row, workspace } = outcome.item;
    // A row with no slug is one that was never registered as a run — its ledger key is the only name it has,
    // and saying so out loud is the rule rather than reaching for `??`.
    let name = row.sessionKey;
    if (row.slug !== undefined) {
      name = row.slug;
    }
    seats.push({
      directory: workspace.currentDirectory,
      name,
      sessionKey: row.sessionKey,
      workspaceId: workspace.workspaceId,
    });
  }
  return seats;
}

/**
 * The seats a sweep PARKED, for the residue reap only: a parked seat's worktree is what its reseat reopens, so
 * the reclaim never sees one, while a daemon it left running is as orphaned as a done seat's.
 *
 * @param outcomes every row's outcome
 * @returns one entry per parked seat
 */
export function parkedSeats({ outcomes }: { readonly outcomes: readonly CloseDoneOutcome[] }): readonly ClosedSeat[] {
  return outcomes
    .filter((outcome) => outcome.kind === "parked")
    .map(({ item }) => ({
      directory: item.workspace.currentDirectory,
      name: item.row.slug,
      sessionKey: item.row.sessionKey,
      workspaceId: item.workspace.workspaceId,
    }));
}

/** What one reclaim pass did. */
export interface ReclaimReport {
  readonly outcomes: readonly SeatPruneOutcome[];
  /** The one reason nothing was judged at all, or `null` when the pass ran. */
  readonly refusal: string | null;
}

/** Everything the reclaim needs from its environment. */
export interface ReclaimDeps {
  readonly client: CmuxHostSurface;
  readonly home: string;
  readonly nowMs: number;
  readonly dryRun: boolean;
  /** Why no further tree may be deleted right now, or null — the machine's load gate in production. */
  readonly loadStop: () => string | null;
}

/**
 * Trees one sweep removes. A sweep runs inside the supervisor tick's reading budget and cannot pause between
 * two removals, so it takes one and leaves the rest, which the hourly `worktree prune` reaches paced
 * (`../../../worktree/prunePacing.ts`).
 */
const SEAT_REMOVALS_PER_SWEEP = 1;

/**
 * Reclaim what the seats this pass closed left behind.
 *
 * @param seats the seats that were closed, or would have been on a dry run
 * @param deps the client, the state home, the clock and whether effects are withheld
 * @returns one outcome per seat, or the reason none was judged
 */
export async function reclaimClosedSeats({
  seats,
  deps,
}: {
  readonly seats: readonly ClosedSeat[];
  readonly deps: ReclaimDeps;
}): Promise<ReclaimReport> {
  if (seats.length === 0) {
    return { outcomes: [], refusal: null };
  }
  const workspaces = await deps.client.listWorkspaces();
  if (workspaces.isErr()) {
    return {
      outcomes: [],
      refusal:
        `the live workspace list could not be re-read — ${workspaces.error.message}; no worktree was ` +
        "reclaimed, because a tree in use is indistinguishable from a closed one without it",
    };
  }
  const live = liveReferenceIndex({
    // The seat just closed can leave its own processes in the tree for a moment, and `cmux close`'s residue
    // reap is what judges those, so a process's cwd is not read as a hold here.
    cwds: new Map(),
    sessions: survivingRows({ home: deps.home, seats }),
    workspaces: survivingWorkspaces({ seats, workspaces: workspaces.value }),
  });
  const checkouts = mainCheckoutsFromProfile({ home: deps.home }).map((config) => config.path);
  const repos = new Map<string, RepoContext>();
  const outcomes = reclaimInTurn({
    loadStop: deps.loadStop,
    reclaim: ({ seat, paused }) => reclaimOne({ checkouts, deps, live, paused, repos, seat }),
    seats,
  });
  return { outcomes, refusal: null };
}

/**
 * Judge each closed seat in turn, letting at most {@link SEAT_REMOVALS_PER_SWEEP} of them reach a removal and
 * none while the load gate is shut. The gate is read before each seat, so a sweep that starts under the hold and
 * crosses it stops there.
 *
 * @param seats the seats this pass closed
 * @param loadStop why no tree may be deleted right now, or null
 * @param reclaim judges one seat, removing its tree only when `paused` is null, and says whether it tried
 * @returns one outcome per seat, in order
 * @internal
 */
export function reclaimInTurn({
  seats,
  loadStop,
  reclaim,
}: {
  readonly seats: readonly ClosedSeat[];
  readonly loadStop: () => string | null;
  readonly reclaim: (input: { seat: ClosedSeat; paused: string | null }) => {
    readonly result: SeatPruneOutcome;
    readonly attempted: boolean;
  };
}): readonly SeatPruneOutcome[] {
  const outcomes: SeatPruneOutcome[] = [];
  let attempted = 0;
  for (const seat of seats) {
    const paused = attempted >= SEAT_REMOVALS_PER_SWEEP ? "this sweep already removed one tree" : loadStop();
    const outcome = reclaim({ paused, seat });
    attempted += outcome.attempted ? 1 : 0;
    outcomes.push(outcome.result);
  }
  return outcomes;
}

/**
 * Every live reference naming one worktree path, or none when no live session does.
 *
 * No entry in the index means no live session names this path — the point of subtracting the seats this
 * pass closed — and is a different statement from "the index could not be built", which cannot reach here.
 *
 *  live the refreshed live-reference index
 *  path the closed seat’s own directory
 *  the references holding that tree
 */
function heldRefs({
  live,
  path,
}: {
  readonly live: ReadonlyMap<string, readonly string[]>;
  readonly path: string;
}): readonly string[] {
  const held = live.get(worktreePathKey({ path }));
  if (held === undefined) {
    return [];
  }
  return held;
}

/**
 * Judge one closed seat's worktree: the repository it belongs to and the prune's decision on it, or why it
 * cannot be judged at all.
 *
 * @param seat the seat that was closed
 * @param checkouts every declared main checkout
 * @param live the refreshed live-reference index
 * @param repos the per-repository read cache
 * @param deps the clock and the state home
 * @returns the owning repository and the decision, or the reason no decision could be made
 */
function judgeSeat({
  seat,
  checkouts,
  live,
  repos,
  deps,
}: {
  readonly seat: ClosedSeat;
  readonly checkouts: readonly string[];
  readonly live: ReadonlyMap<string, readonly string[]>;
  readonly repos: Map<string, RepoContext>;
  readonly deps: ReclaimDeps;
}): { readonly unjudged: string } | { readonly repoRoot: string; readonly decision: SeatPruneDecision } {
  const repoRoot = repoOwningWorktree({ mainCheckouts: checkouts, path: seat.directory });
  if (repoRoot === undefined) {
    return { unjudged: "it is not a worktree of any declared main checkout — nothing here touches it" };
  }
  const context = repoContext({ repoRoot, repos });
  if (context.trunk === null) {
    return { unjudged: `${repoRoot}'s trunk ref could not be read, so no merge state can be judged` };
  }
  const entry = context.pathsByKey.get(worktreePathKey({ path: seat.directory }));
  if (entry === undefined) {
    return { unjudged: "git no longer lists it as a worktree of that repository" };
  }
  const decision = decideSeatPrune({
    facts: scanWorktree({
      liveRefs: heldRefs({ live, path: seat.directory }),
      mainCheckout: repoRoot,
      // The close-time sweep reads no pull-request register; the hourly `worktree prune` judges one.
      openPullRequests: [],
      repoRoot,
      runsDir: stateHomePaths({ home: deps.home }).runs,
      trunk: context.trunk,
      worktree: entry,
    }),
    nowMs: deps.nowMs,
  });
  return { decision, repoRoot };
}

/**
 * Judge and, when it is safe, reclaim one closed seat's worktree.
 *
 * @param seat the seat that was closed
 * @param checkouts every declared main checkout
 * @param live the refreshed live-reference index
 * @param repos the per-repository read cache
 * @param deps the clock and whether effects are withheld
 * @param paused why this seat's tree may not be deleted now, or null; a paused tree is left for the prune
 * @returns what happened to that seat's worktree, and whether a removal was attempted
 */
function reclaimOne({
  seat,
  checkouts,
  live,
  repos,
  deps,
  paused,
}: {
  readonly seat: ClosedSeat;
  readonly checkouts: readonly string[];
  readonly live: ReadonlyMap<string, readonly string[]>;
  readonly repos: Map<string, RepoContext>;
  readonly deps: ReclaimDeps;
  readonly paused: string | null;
}): { readonly result: SeatPruneOutcome; readonly attempted: boolean } {
  const base = { name: seat.name, path: seat.directory, removed: false };
  const kept = ({ reason }: { reason: string }): { result: SeatPruneOutcome; attempted: boolean } => ({
    attempted: false,
    result: { ...base, reason },
  });
  const judged = judgeSeat({ checkouts, deps, live, repos, seat });
  if ("unjudged" in judged) {
    return kept({ reason: judged.unjudged });
  }
  const { decision, repoRoot } = judged;
  if (decision.kind === "keep") {
    return kept({ reason: decision.reason });
  }
  if (deps.dryRun) {
    return { attempted: false, result: { ...base, reason: decision.verdict.reason, removed: true } };
  }
  if (paused !== null) {
    return kept({ reason: `left for the hourly worktree prune — ${paused}` });
  }
  const outcome = applyVerdict({
    bulkTrash: reclaimTrashDir({ repoRoot }),
    recyclePool: recyclePoolDir({ repoRoot }),
    repoRoot,
    verdict: decision.verdict,
  });
  return { attempted: true, result: reclaimOutcome({ base, outcome, reason: decision.verdict.reason }) };
}

/**
 * One applied removal as the seat's outcome, where `declined` is read against `treeRemoved`.
 *
 * `declined` carries the reason from EITHER step: the tree's removal, or the branch deletion asked for after
 * the tree went. A squash-merged branch is never an ancestor of the trunk, so the second keeps it routinely,
 * and reading it as the first reported gone trees as kept — measured on two ticks of one handoff run:
 * "git declined the removal — error: the branch '…' is not fully merged" over directories that
 * no longer existed.
 *
 * @param base the seat's name and path, with `removed: false`
 * @param outcome what the removal did
 * @param reason the verdict's own sentence for why the tree could go
 * @returns the seat's outcome
 * @internal
 */
export function reclaimOutcome({
  base,
  outcome,
  reason,
}: {
  readonly base: Omit<SeatPruneOutcome, "reason">;
  readonly outcome: Pick<PruneOutcome, "declined" | "failed" | "treeRemoved">;
  readonly reason: string;
}): SeatPruneOutcome {
  if (outcome.failed) {
    return { ...base, reason: `the removal FAILED part-way and left the directory — ${String(outcome.declined)}` };
  }
  if (!outcome.treeRemoved) {
    return { ...base, reason: `git declined the removal — ${String(outcome.declined)}` };
  }
  if (outcome.declined !== null) {
    return { ...base, reason: `${reason}; branch kept — ${outcome.declined}`, removed: true };
  }
  return { ...base, reason, removed: true };
}

/** The live workspaces minus the ones this pass closed, matched by id so a co-tenant still holds its tree. */
function survivingWorkspaces({
  workspaces,
  seats,
}: {
  readonly workspaces: readonly CmuxWorkspaceSummary[];
  readonly seats: readonly ClosedSeat[];
}): readonly CmuxWorkspaceSummary[] {
  const closed = new Set(seats.map((seat) => seat.workspaceId));
  return workspaces.filter((workspace) => !closed.has(workspace.workspaceId));
}

/** The ledger's open rows minus the ones this pass closed — a dry run appends no `closed` event. */
function survivingRows({
  home,
  seats,
}: {
  readonly home: string;
  readonly seats: readonly ClosedSeat[];
}): readonly SessionItem[] {
  const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
  const closed = new Set(seats.map((seat) => seat.sessionKey));
  return foldSessions({ events }).filter((row) => !closed.has(row.sessionKey));
}

/**
 * Print one reclaim pass.
 *
 * @param report what the pass did
 * @param dryRun whether effects were withheld
 * @returns nothing; the lines go to the verb's own channels
 */
export function printReclaim({ report, dryRun }: { readonly report: ReclaimReport; readonly dryRun: boolean }): void {
  if (report.refusal !== null) {
    logger.error({ msg: `session close-done: ${report.refusal}` });
    return;
  }
  report.outcomes.forEach((outcome) => {
    logger.out({ line: renderSeatPrune({ dryRun, outcome }) });
  });
}
