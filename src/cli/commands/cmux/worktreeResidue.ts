/**
 * Reaping what a closed seat's worktree left running — the effectful half of
 * `../../../live/machine/worktreeResidue.ts`, shared by `cmux close` and `session close-done` (measured: five stale
 * acme-admin nx daemons, 230-400 MB each, outliving their seats).
 *
 * ## The fourth condition lives here, because it needs the registers
 *
 * The planner decides from a process table. Whether the worktree is still IN USE is a different question,
 * answered the way `../session/closeDoneReclaim.ts` answers it before removing a tree: the live workspace
 * list re-read AFTER the close, and the session ledger's open rows, each minus the seats just closed (by
 * workspace id and ledger key, never by path, because a dispatch child shares its parent's checkout). A tree
 * another live seat still holds keeps every daemon in it — that seat may be the one using it. A list that
 * FAILS to read reaps nothing, with the reason: a socket that did not answer is not an empty list.
 *
 * ## A declared checkout's WHOLE worktree, never the checkout
 *
 * `worktreeRootOf` over `docs/main-checkouts/declarations-and-freshness.md`'s register — the same remit the tree reclaim keeps. A
 * main checkout's daemon is shared and long-lived, which is where a daemon pays for itself. A seat's
 * directory is widened to its worktree's root before anything is judged, and a live reference ANYWHERE under
 * that root holds it: an exact-path lookup let a seat closed at the root reap the daemon of a co-tenant still
 * working in `apps/web` (found in review of this change).
 *
 * ## SIGTERM, and a re-read before it
 *
 * nx's daemon cleans its socket up on SIGTERM, so it gets the polite signal. The table is read again
 * immediately before signalling and a pid whose argv moved is dropped rather than signalled
 * (`../../../live/machine/reap.ts`'s third guard). A close is never failed by its reap: every outcome is a
 * printed line, and the close already happened.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { Result } from "../../../lib/result.js";
import { readCwds } from "../../../live/machine/devServerRead.js";
import { ownAncestry } from "../../../live/machine/reap.js";
import { signalSelectedTrees } from "../../../live/machine/signalSelectedTrees.js";
import {
  referencesHolding,
  residueCandidatePids,
  type WorktreeResiduePlan,
  worktreeResiduePlan,
  worktreeRootOf,
} from "../../../live/machine/worktreeResidue.js";
import { readProcessSnapshot } from "../../../live/standing/inspect.js";
import type { ProcessRow } from "../../../live/standing/processes.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { liveReferenceIndex } from "../worktree/core.js";

/** The seams one reap needs, injected so a unit test never reads the real table and never signals anything. */
export interface ResidueDeps {
  /** One `ps -ax -o pid=,ppid=,args=` snapshot, decoded — empty when it could not be taken. */
  readonly processes: () => readonly ProcessRow[];
  /** Each candidate pid's working directory, from `lsof`. */
  readonly cwds: (input: { pids: readonly number[] }) => ReadonlyMap<number, string>;
  /** Signal one pid; the reason it failed, or `undefined` when the signal went out. */
  readonly kill: (input: { pid: number }) => string | undefined;
  readonly selfPid: () => number;
  /** Every declared main checkout — the remit a reap stays inside. */
  readonly mainCheckouts: () => readonly string[];
}

/**
 * The real seams: `ps`, `lsof`, `process.kill` with SIGTERM, and the profile's declared checkouts.
 *
 * @param home the state home whose profile declares the main checkouts
 * @returns the production {@link ResidueDeps}
 */
export function productionResidueDeps({ home }: { home: string }): ResidueDeps {
  return {
    cwds: ({ pids }) => readCwds({ pids }),
    kill: ({ pid }) => {
      try {
        process.kill(pid, "SIGTERM");
        return undefined;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    mainCheckouts: () => mainCheckoutsFromProfile({ home }).map((config) => config.path),
    processes: () => {
      const snapshot = readProcessSnapshot();
      return snapshot.kind === "rows" ? snapshot.rows : [];
    },
    selfPid: () => process.pid,
  };
}

/**
 * The one read a reap needs from whatever hosts the seats: the live list, re-read after the close. The cmux host
 * surface (`../../../sessionHarness/cmuxHost.ts`) is one, its list the session harness's mapped back to cmux's rows.
 */
export interface LiveWorkspaceList {
  /**
   * Every live workspace, or why the list could not be read.
   *
   * @returns the list, or a failure carrying its message
   */
  readonly listWorkspaces: () => Promise<Result<readonly CmuxWorkspaceSummary[], { readonly message: string }>>;
}

/** One seat that was just closed, as the reap addresses it. */
export interface ResidueSeat {
  /** The workspace's own directory, as cmux reported it. */
  readonly directory: string;
  /** cmux's id for that workspace, subtracted from the refreshed live list. */
  readonly workspaceId: string;
  /** The ledger row that was closed, subtracted from the ledger — `undefined` for a workspace with no row. */
  readonly sessionKey: string | undefined;
}

/** What one seat's reap did. */
interface SeatResidue {
  readonly directory: string;
  /** The plan, or why the seat was not planned at all. */
  readonly judged:
    | { readonly kind: "planned"; readonly plan: WorktreeResiduePlan }
    | { readonly kind: "left-alone"; readonly why: string };
  readonly killed: readonly number[];
  readonly failed: readonly { readonly pid: number; readonly why: string }[];
}

/** What one reap pass did across every seat it was handed. */
export interface ResidueReport {
  readonly seats: readonly SeatResidue[];
  /** The one reason nothing was planned at all, or `null` when the pass ran. */
  readonly refusal: string | null;
}

/**
 * The live references still holding each path once the closed seats are subtracted — by workspace id and
 * ledger key, never by path, so a co-tenant sharing the directory still holds it.
 *
 * @param home the state home holding the session ledger
 * @param workspaces the live workspace list, re-read after the close
 * @param seats the seats that were just closed
 * @returns resolved path key to the references holding it
 */
function liveIndexAfterClose({
  home,
  workspaces,
  seats,
}: {
  home: string;
  workspaces: readonly CmuxWorkspaceSummary[];
  seats: readonly ResidueSeat[];
}): ReadonlyMap<string, readonly string[]> {
  const closedWorkspaces = new Set(seats.map((seat) => seat.workspaceId));
  const closedRows = new Set(seats.flatMap((seat) => (seat.sessionKey === undefined ? [] : [seat.sessionKey])));
  const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
  const sessions: readonly SessionItem[] = foldSessions({ events }).filter((row) => !closedRows.has(row.sessionKey));
  return liveReferenceIndex({
    // The processes standing in the tree are what this reap judges, so a process's cwd cannot be what holds
    // the tree from it: every daemon would hold its own worktree and none would ever be reaped.
    cwds: new Map(),
    sessions,
    workspaces: workspaces.filter((workspace) => !closedWorkspaces.has(workspace.workspaceId)),
  });
}

/** One seat left unplanned, and why. */
function leftAloneSeat({ directory, why }: { directory: string; why: string }): SeatResidue {
  return { directory, failed: [], judged: { kind: "left-alone", why }, killed: [] };
}

/** Signal one plan's targets, deepest first, re-checking each pid against a fresh table first. */
function executeResidue({
  plan,
  deps,
}: {
  plan: WorktreeResiduePlan;
  deps: ResidueDeps;
}): Pick<SeatResidue, "failed" | "killed"> {
  if (plan.targets.length === 0) {
    return { failed: [], killed: [] };
  }
  return signalSelectedTrees({ kill: deps.kill, processes: deps.processes(), targets: plan.targets });
}

/**
 * Reap every node process the closed seats' worktrees left running, where no live seat still holds the tree.
 *
 * @param seats the seats just closed, or that would have been on a dry run
 * @param client what answers the post-close workspace list — a cmux client, or the session harness's list
 * @param home the state home holding the session ledger
 * @param dryRun plan and report, signal nothing
 * @param deps the process, cwd, kill and checkout seams
 * @returns one entry per seat, or the reason none was planned
 */
export async function reapSeatResidue({
  seats,
  client,
  home,
  dryRun,
  deps,
}: {
  seats: readonly ResidueSeat[];
  client: LiveWorkspaceList;
  home: string;
  dryRun: boolean;
  deps: ResidueDeps;
}): Promise<ResidueReport> {
  if (seats.length === 0) {
    return { refusal: null, seats: [] };
  }
  const workspaces = await client.listWorkspaces();
  if (workspaces.isErr()) {
    return {
      refusal:
        `the live workspace list could not be re-read — ${workspaces.error.message}; nothing was reaped, ` +
        "because a tree another seat still holds is indistinguishable from a closed one without it",
      seats: [],
    };
  }
  const processes = deps.processes();
  if (processes.length === 0) {
    return { refusal: "the process table could not be read, so nothing was reaped", seats: [] };
  }
  const live = liveIndexAfterClose({ home, seats, workspaces: workspaces.value });
  const checkouts = deps.mainCheckouts();
  const cwdByPid = deps.cwds({ pids: residueCandidatePids({ processes }) });
  const protectedPids = ownAncestry({ processes, selfPid: deps.selfPid() });
  const report: SeatResidue[] = [];
  for (const seat of seats) {
    const root = checkouts
      .map((checkout) => worktreeRootOf({ checkout, path: seat.directory }))
      .find((candidate) => candidate !== undefined);
    if (root === undefined) {
      report.push(leftAloneSeat({ directory: seat.directory, why: "it is not a worktree of a declared checkout" }));
      continue;
    }
    const held = referencesHolding({ live, root });
    if (held.length > 0) {
      report.push(leftAloneSeat({ directory: root, why: `still held by ${held.join(", ")}` }));
      continue;
    }
    const plan = worktreeResiduePlan({ cwdByPid, processes, protectedPids, worktree: root });
    const executed = dryRun ? { failed: [], killed: [] } : executeResidue({ deps, plan });
    report.push({ directory: root, ...executed, judged: { kind: "planned", plan } });
  }
  return { refusal: null, seats: report };
}

/**
 * A closed seat's ledger key and its residue reap — what every close-and-reap shape does once the close lands:
 * `cmux close`'s and `handover park`'s, both through the session harness.
 *
 * @param client what answers the post-close workspace list
 * @param currentDirectory the closed seat's own directory
 * @param home the state home, for the ledger and the declared checkouts
 * @param ref the closed workspace's ref, echoed back
 * @param sessionKeyFor the open ledger row a closed workspace ref belongs to, if any
 * @param workspaceId the closed workspace's id, subtracted from the re-read list
 * @returns the ref, its ledger row key, and what the reap did
 */
export async function reapClosedSeat({
  client,
  currentDirectory,
  home,
  ref,
  sessionKeyFor,
  workspaceId,
}: {
  client: LiveWorkspaceList;
  currentDirectory: string;
  home: string;
  ref: string;
  sessionKeyFor: (input: { workspaceRef: string }) => string | undefined;
  workspaceId: string;
}): Promise<{ ref: string; sessionKey: string | undefined; residue: ResidueReport }> {
  const sessionKey = sessionKeyFor({ workspaceRef: ref });
  const seats = [{ directory: currentDirectory, sessionKey, workspaceId }];
  const residue = await reapSeatResidue({ client, deps: productionResidueDeps({ home }), dryRun: false, home, seats });
  return { ref, residue, sessionKey };
}

/** `pid 500 (+1 under it)` — one target named without its argv. */
function targetPhrase({ rootPid, treeSize }: { rootPid: number; treeSize: number }): string {
  const under = treeSize > 1 ? ` (+${String(treeSize - 1)} under it)` : "";
  return `pid ${String(rootPid)}${under}`;
}

/**
 * One reap pass as the lines a reader sees — one per target, skip and failure, and one per seat that had
 * nothing, so a quiet close still says it looked.
 *
 * @param report what the pass did
 * @param dryRun whether signals were withheld
 * @param verb the verb printing it, as each line's prefix
 * @returns the lines, in seat order
 */
export function renderResidueReport({
  report,
  dryRun,
  verb,
}: {
  report: ResidueReport;
  dryRun: boolean;
  verb: string;
}): readonly string[] {
  if (report.refusal !== null) {
    return [`${verb}: worktree residue — ${report.refusal}`];
  }
  const acted = dryRun ? "would reap" : "reaped";
  return report.seats.flatMap((seat) =>
    seatLines({ acted, head: `${verb}: worktree residue in ${seat.directory}`, seat }),
  );
}

/** One seat's lines: why it was left alone, or each target, skip and failure — or that it had none. */
function seatLines({ seat, head, acted }: { seat: SeatResidue; head: string; acted: string }): readonly string[] {
  if (seat.judged.kind === "left-alone") {
    return [`${head} — left alone: ${seat.judged.why}`];
  }
  const { plan } = seat.judged;
  const lines = [
    ...plan.targets.map(
      (target) =>
        `${head} — ${acted} ${target.label} ${targetPhrase({ rootPid: target.rootPid, treeSize: target.treePids.length })}`,
    ),
    ...plan.skipped.map((skip) => `${head} — left ${skip.label} pid ${String(skip.pid)}: ${skip.why}`),
    ...seat.failed.map((failure) => `${head} — did not signal pid ${String(failure.pid)}: ${failure.why}`),
  ];
  return lines.length === 0 ? [`${head} — none left running`] : lines;
}
