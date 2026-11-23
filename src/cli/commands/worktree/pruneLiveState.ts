/**
 * The live registers `worktree prune` reads, and the two checks `--apply` asks of them right before it
 * touches a tree: may it be removed, and may its `node_modules` be dropped.
 *
 * Four registers say a tree is in use. Three hold it by PATH — an open session in the ledger, a live cmux
 * workspace, and any live process whose working directory is at or under the tree, which is what a background
 * agent or a shell working there leaves. The fourth holds it by BRANCH, and only while the tree is WARM: an open
 * pull request of theirs whose head is the branch the tree has out, judged against `--older-than` by the same
 * function the scan's coldness rule uses. A tree with an old commit and an untouched top directory reads cold
 * on its activity stamp alone, and the hourly apply once removed one tree a background agent was
 * working in and another whose pull request was open and waiting on CI; each of those two is one of the
 * registers here. A COLD tree under an open pull request goes, and its pushed branch recreates it.
 *
 * Every check reads the registers FRESH, once per tree, because the scan's copy can be a whole `--scan-budget`
 * plus `--budget` old by the last tree, and `git worktree remove` or a recursive delete of `node_modules`
 * under a process standing in the tree exits 0 either way. What remains is one read's
 * width: a session opening in a cold tree between that read and the destructive call, which only a lock shared
 * with every session launch would close.
 */
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type CmuxError, cmuxDidNotAnswer } from "../../../cmux/errors.js";
import { githubToken } from "../../../config.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import { type OpenHead, readOwnOpenHeads } from "../../../live/github/ownOpenHeads.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { readEveryCwd } from "../../../live/machine/devServerRead.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { foldSessions, parseSessionLog, type SessionEvent } from "../../../sessions/session.js";
import { sessionLogPath } from "../../../sessions/sessionStore.js";
import { liveReferencesTo } from "../../../worktree/location.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { openPullRequestHold, renderAge } from "../../../worktree/pruneColdness.js";
import { coldNow } from "../../../worktree/pruneDeps.js";
import { activityNowMs } from "../../../worktree/pruneScan.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../exitCodes.js";
import { liveReferenceIndex } from "./core.js";

/** The live-reference indexes, and why any register could not be read whole. */
export interface LiveState {
  /** Resolved path → the references holding it: sessions, workspaces and live processes. */
  readonly index: ReadonlyMap<string, readonly string[]>;
  /** Branch name → the open pull requests of their whose head it is. */
  readonly byBranch: ReadonlyMap<string, readonly string[]>;
  /** One reason per register that could not be read whole, for display; empty when every one was. */
  readonly unreadable: readonly string[];
  /**
   * Which register failed, typed — the ONLY input {@link liveComplete} and {@link liveDeferrable} decide from, so
   * no separately settable flag can claim a deferral the registers do not bear out.
   */
  readonly failed: {
    readonly ledger: boolean;
    /** The workspace list's own error, or null when it read whole. */
    readonly workspaces: CmuxError | null;
    readonly cwds: boolean;
    readonly openHeads: boolean;
  };
}

/**
 * Whether every live register read whole.
 *
 * @param live the registers as read
 * @returns true when no register failed
 */
export function liveComplete({ live }: { live: LiveState }): boolean {
  const { cwds, ledger, openHeads, workspaces } = live.failed;
  return !ledger && !cwds && !openHeads && workspaces === null;
}

/**
 * Whether the state is incomplete ONLY because cmux did not answer the workspace list in time
 * ({@link cmuxDidNotAnswer}). Asking again later is then the whole fix, so an `--apply` DEFERS rather than fails.
 * An unparseable ledger, an `lsof` failure or a GitHub read (bad credentials reads the same as a blip) is not:
 * alone or beside a cmux timeout, it stays a failure, and a scheduled row is held on it.
 *
 * @param live the registers as read
 * @returns true when the cmux timeout is the one and only failure
 */
export function liveDeferrable({ live }: { live: LiveState }): boolean {
  const { cwds, ledger, openHeads, workspaces } = live.failed;
  if (ledger || cwds || openHeads || workspaces === null || workspaces.code === "SOCKET_UNAVAILABLE") {
    return false;
  }
  return INVENTORY_METHODS.has(workspaces.method) && cmuxDidNotAnswer({ error: workspaces });
}

/**
 * The two calls the strict workspace inventory makes (`src/cmux/strictInventory.ts`). A timeout on any OTHER
 * method in that slot is not the read this decision is about, so it does not defer.
 */
const INVENTORY_METHODS: ReadonlySet<string> = new Set(["window.list", "workspace.list"]);

/**
 * Every event in the session ledger, streamed a line at a time, or null when the ledger exists and could not
 * be read whole. An absent ledger is a home that never tracked a session, which is readable and empty; one
 * line that does not parse may be the only record of a session standing in a cold tree, so it is not.
 *
 * @returns the events, or null
 */
function sessionLedgerEvents(): readonly SessionEvent[] | null {
  const events: SessionEvent[] = [];
  let unreadable = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const parsed = parseSessionLog({ text: line });
        events.push(...parsed.events);
        unreadable += parsed.unreadable.length;
      },
      path: sessionLogPath(),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    logger.error({ msg: `worktree prune: the session ledger ${sessionLogPath()} could not be read` });
    return null;
  }
  if (unreadable > 0) {
    logger.error({
      msg: `worktree prune: the session ledger ${sessionLogPath()} has ${String(unreadable)} unparseable line(s)`,
    });
    return null;
  }
  return events;
}

/**
 * Each open pull request's head branch, mapped to the references it makes.
 *
 * @param heads every open pull request of theirs
 * @returns branch name → `open pull request <owner/repo>#<n>` for each pull request with that head
 */
function branchIndex({ heads }: { heads: readonly OpenHead[] }): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const head of heads) {
    const label = `open pull request ${head.repo}#${String(head.number)}`;
    const held = index.get(head.branch);
    if (held === undefined) {
      index.set(head.branch, [label]);
    } else {
      held.push(label);
    }
  }
  return index;
}

/**
 * The live state four register reads make.
 *
 * **Any register failing is incomplete**, and incomplete live state keeps every tree: reading an unreadable
 * register as "no sessions", "no processes" or "no open pull requests" would let `--apply` delete a tree in
 * use. Each failure is named in `unreadable`, so the refusal that follows says which read it was.
 *
 * @param events the session ledger's events, null when it could not be read whole
 * @param workspaces the live workspace list, or why it could not be read
 * @param cwds every live process's working directory by pid, or why the process table could not be read
 * @param openHeads every open pull request of theirs, or why that list could not be read whole
 * @returns the indexes, and every register that could not be read
 */
export function liveStateFrom({
  events,
  workspaces,
  cwds,
  openHeads,
}: {
  events: readonly SessionEvent[] | null;
  workspaces: Result<readonly CmuxWorkspaceSummary[], CmuxError>;
  cwds: Result<ReadonlyMap<number, string>>;
  openHeads: Result<readonly OpenHead[], GithubLiveError>;
}): LiveState {
  const unreadable = [
    ...(events === null ? ["the session ledger could not be read whole"] : []),
    ...(workspaces.isErr() ? [`the live workspace list could not be read — ${workspaces.error.message}`] : []),
    ...(cwds.isErr() ? cwds.error : []),
    ...(openHeads.isErr() ? [`their open pull requests could not be read — ${openHeads.error.message}`] : []),
  ];
  unreadable.forEach((why) => {
    logger.error({ msg: `worktree prune: ${why}` });
  });
  const ledgerRead = events !== null;
  return {
    byBranch: branchIndex({ heads: openHeads.isOk() ? openHeads.value : [] }),
    failed: {
      cwds: cwds.isErr(),
      ledger: !ledgerRead,
      openHeads: openHeads.isErr(),
      workspaces: workspaces.isErr() ? workspaces.error : null,
    },
    index: liveReferenceIndex({
      cwds: cwds.isOk() ? cwds.value : new Map(),
      sessions: foldSessions({ events: ledgerRead ? events : [] }),
      workspaces: workspaces.isOk() ? workspaces.value : [],
    }),
    unreadable,
  };
}

/**
 * The exit an `--apply` stops on before it scans, and the line saying why — or `null` when it may go on. PURE, and
 * the ONE decision `worktree prune` and `worktree mirror-prune` both take, so their exits cannot drift apart.
 *
 * Incomplete live state always stops an apply, because a tree in use is indistinguishable from a cold one. A
 * register that merely did not answer in time ({@link liveDeferrable}) stops on `EXIT_DEFERRED`: nothing was
 * removed and running the same command again is the fix, so a scheduler gives the attempt back rather than holding
 * the row as broken (`../../exitCodes.ts` § `EXIT_DEFERRED`). MEASURED: one 10-second cmux stall at the
 * `worktree-prune` row's firing exited 1 and held hourly pruning on a p0 finding. Anything else is `EXIT_ERROR`.
 *
 * @param apply whether this run would remove anything
 * @param live the live registers as read
 * @param verb the verb's name as its diagnostics print it, e.g. `worktree prune`
 * @returns the exit code and the line to print, or null when the run may go on
 */
export function applyRefusal({
  apply,
  live,
  verb,
}: {
  apply: boolean;
  live: LiveState;
  verb: string;
}): { exitCode: number; line: string } | null {
  if (!apply || liveComplete({ live })) {
    return null;
  }
  const why = `live state is unreadable (${live.unreadable.join("; ")}) — a tree in use is indistinguishable from a cold one`;
  if (liveDeferrable({ live })) {
    return {
      exitCode: EXIT_DEFERRED,
      line: `${verb}: deferring --apply, nothing removed: ${why}; run it again unchanged`,
    };
  }
  return { exitCode: EXIT_ERROR, line: `${verb}: refusing --apply while ${why}` };
}

/**
 * Read all four live registers now.
 *
 * @returns the indexes, and every register that could not be read
 */
export async function readLiveState(): Promise<LiveState> {
  return liveStateFrom({
    cwds: readEveryCwd(),
    events: sessionLedgerEvents(),
    openHeads: await readOwnOpenHeads({ graphql: githubReadGraphql({ token: githubToken() }) }),
    // STRICT, never the lossy `listWorkspaces`: that one drops a row it cannot decode and answers ok, so a live
    // workspace with one malformed field would read as no workspace and its tree as cold.
    workspaces: await withCmuxSessionHost({ body: ({ host }) => host.listWorkspacesStrict() }),
  });
}

/**
 * Every live reference holding one tree absolutely: a session, workspace or process at or under its path.
 *
 * @param live the registers as read
 * @param path the tree asked about
 * @returns the references, empty when nothing holds it
 */
export function liveHoldsOn({ live, path }: { live: LiveState; path: string }): readonly string[] {
  return liveReferencesTo({ live: live.index, path });
}

/**
 * The open pull requests of their whose head is the branch one tree has out.
 *
 * @param live the registers as read
 * @param branch the branch it has out, or null for a detached HEAD or a directory that is not a tree
 * @returns each `open pull request <repo>#<n>`, empty when none is open on that branch
 */
export function openPullRequestsOn({ live, branch }: { live: LiveState; branch: string | null }): readonly string[] {
  // A detached HEAD, or a directory that is not a tree, has no branch a pull request could be open on.
  if (branch === null) {
    return [];
  }
  const byBranch = live.byBranch.get(branch);
  if (byBranch === undefined) {
    return [];
  }
  return byBranch;
}

/**
 * Why live state holds a tree by its PATH: whenever it could not be read whole, or a live reference holds it.
 *
 * @param live the registers as just read
 * @param path the tree about to be removed
 * @returns the reason it is held, or null when nothing holds it
 */
export function heldReason({ live, path }: { live: LiveState; path: string }): string | null {
  if (!liveComplete({ live })) {
    return (
      `live state could not be read (${live.unreadable.join("; ")}), so a tree in use is indistinguishable ` +
      "from a cold one"
    );
  }
  const refs = liveHoldsOn({ live, path });
  if (refs.length > 0) {
    return `taken since the scan — ${refs.join(", ")}`;
  }
  return null;
}

/**
 * Why a tree may not be removed right now: a path hold first, then an open pull request on a tree still warm, then
 * the activity floor the scan's verdict carried, if it carried one.
 *
 * The pull request is judged by `openPullRequestHold`, the function the scan's coldness rule judges it by,
 * against the same `--older-than`, so the scan and the apply cannot disagree about one. The floor is the window the
 * scan's own coldness rule judged the tree against, so a tree touched since the scan is kept, and an unreadable
 * stamp keeps it too, because nothing then shows it still cold.
 *
 * @param live the registers as just read
 * @param path the tree about to be removed
 * @param branch the branch it has out, or null when it has none
 * @param lastActivityMs the tree's activity stamp read now, or null when it could not be read
 * @param nowMs the instant the tree is judged against
 * @param olderThanMs how long untouched a tree must be before a pull request stops holding it
 * @param activityFloorMs the verdict's activity window, or null when the scan asked no age of this tree
 * @returns the reason it is held, or null when nothing holds it
 */
export function heldForRemoval({
  live,
  path,
  branch,
  lastActivityMs,
  nowMs,
  olderThanMs,
  activityFloorMs,
}: {
  live: LiveState;
  path: string;
  branch: string | null;
  lastActivityMs: number | null;
  nowMs: number;
  olderThanMs: number;
  activityFloorMs: number | null;
}): string | null {
  const byPath = heldReason({ live, path });
  if (byPath !== null) {
    return byPath;
  }
  const pullRequest = openPullRequestHold({
    lastActivityMs,
    nowMs,
    olderThanMs,
    openPullRequests: openPullRequestsOn({ branch, live }),
  });
  if (pullRequest !== undefined) {
    return `taken since the scan — ${pullRequest}`;
  }
  if (activityFloorMs === null) {
    return null;
  }
  if (lastActivityMs === null) {
    return "taken since the scan — no activity timestamp could be read before removal";
  }
  const ageMs = nowMs - lastActivityMs;
  if (ageMs < activityFloorMs) {
    return `taken since the scan — touched ${renderAge({ ms: ageMs })} ago`;
  }
  return null;
}

/**
 * The apply's per-tree check, reading the live registers and the tree's activity stamp fresh for each tree.
 *
 * @param olderThanMs how long untouched a tree must be before an open pull request stops holding it
 * @returns why a tree may not be removed right now, null when nothing holds it
 */
export function heldByLiveState({
  olderThanMs,
}: {
  olderThanMs: number;
}): (input: RemovalCandidate) => Promise<string | null> {
  return async ({ path, branch, activityFloorMs }) => {
    const live = await readLiveState();
    // Only a tree with an open pull request or an activity floor needs a stamp, and reading one costs a git call.
    const openPullRequests = openPullRequestsOn({ branch, live });
    let lastActivityMs: number | null = null;
    if (openPullRequests.length > 0 || activityFloorMs !== null) {
      lastActivityMs = activityNowMs({ path });
    }
    return heldForRemoval({ activityFloorMs, branch, lastActivityMs, live, nowMs: Date.now(), olderThanMs, path });
  };
}

/** What the apply's per-tree check is asked about one tree: where it is, its branch, and the scan's activity window. */
export interface RemovalCandidate {
  readonly path: string;
  readonly branch: string | null;
  /** The verdict's `activityFloorMs`, or null when the scan asked no age of this tree. */
  readonly activityFloorMs: number | null;
}

/**
 * The dependency pass's per-tree check, reading the live registers fresh for each tree it asks about.
 *
 * Path holds only, as the classifier's `depsDroppable` judges it: an open pull request on a cold tree does not keep its
 * `node_modules`. Coldness is read on BOTH stamps — the top directory's age, and the commit HEAD has out in the tree
 * now, detached or not — so a tree warm by a fresh commit keeps its `node_modules` even when its top directory was
 * last touched long ago.
 *
 * @param olderThanMs the eligibility age a tree's own activity stamp is judged against
 * @returns whether the tree is still unreferenced and cold, false whenever live state or its stamp could not be read
 */
export function coldByLiveState({
  olderThanMs,
}: {
  olderThanMs: number;
}): (input: { verdict: PruneVerdict }) => Promise<boolean> {
  return async ({ verdict }) => {
    const live = await readLiveState();
    const nowMs = Date.now();
    if (heldReason({ live, path: verdict.path }) !== null) {
      return false;
    }
    if (!coldNow({ live: live.index, nowMs, olderThanMs })({ verdict })) {
      return false;
    }
    const stamp = activityNowMs({ path: verdict.path });
    return stamp !== null && nowMs - stamp >= olderThanMs;
  };
}
