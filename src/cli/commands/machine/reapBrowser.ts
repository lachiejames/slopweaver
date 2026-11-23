/**
 * The browser half of `machine reap`'s act phase: carry out the verdicts `../../../browser/sessionReap.ts`
 * reached, through injected seams, and report exactly what happened.
 *
 * Three rules, each one a plan-pass finding rather than a preference:
 *
 * - **One close per session, never a retry.** A `tab-close` that timed out may already have landed, and a
 *   second one would close whatever tab the client now calls current (`../browser/presentRun.ts` carries the
 *   measurement). So an unconfirmed close is reported UNKNOWN and not tried again.
 * - **An unconfirmed close ends its daemon, but only one that is provably the same one.** A fresh snapshot is
 *   read immediately before the signal; exactly one `cliDaemon.js` must still carry the session's name AND be
 *   one the plan saw. None → it already went; two → this cannot tell which, so neither is signalled. The
 *   residue is the one every kill-by-pid on this OS shares, the shell class's included (`../../../live/machine/reap.ts`
 *   § The third guard): between that read and `kill` there is no handle binding the pid to its process. macOS
 *   hands pids out in order and wraps at 99999, so a reuse inside that gap needs the whole range to turn over
 *   first (named rather than closed).
 * - **A relay that stops answering stops the closes, not the reap.** Every close rides the same relay, and a
 *   wedged one costs each command its whole timeout. After the first unconfirmed close, the rest are
 *   DEFERRED — their records kept — to the next tick, which is every sweep.
 */
import type { InteractionSession } from "../../../browser/interactionSession.js";
import type { StoredInteractionSession } from "../../../browser/interactionSessionStore.js";
import {
  type BrowserReapVerdict,
  daemonPidsOf,
  gatherBrowserReapInput,
  judgeBrowserSessions,
  type LiveRegistryRow,
  ownExpiredSessionIds,
} from "../../../browser/sessionReap.js";
import {
  type BrowserReapExecution,
  type BrowserReapOutcome,
  emptyBrowserReapExecution,
} from "../../../browser/sessionReapReport.js";
import type { ProcessRow } from "../../../live/standing/processes.js";

/** How many of its own quiet sessions one `browser open` lets go of before it opens the page it was asked for. */
const PRE_OPEN_LET_GO_CEILING = 3;

/** The browser slice of `machine reap`'s seams: what one browser reap reads and does. */
export interface BrowserReapDeps {
  /** A fresh process table, or `undefined` when it could not be read. */
  readonly processes: () => readonly ProcessRow[] | undefined;
  /** Every browser interaction session record the home holds. */
  readonly browserSessions: () => readonly StoredInteractionSession[];
  /** The live Claude Code sessions a browser session's opener is judged against, or `undefined` if unreadable. */
  readonly liveBrowserOwners: (input: { processes: readonly ProcessRow[] }) => readonly LiveRegistryRow[] | undefined;
  /** Every TCP port something listens on, or `undefined` when unreadable. */
  readonly listeningPorts: () => ReadonlySet<number> | undefined;
  /** The instant a session's idle expiry is judged against. */
  readonly nowIso: () => string;
  /** Close one session's tab and detach; the problems met, empty when the client confirmed both. */
  readonly releaseBrowser: (input: { session: InteractionSession }) => readonly string[];
  /** Remove one session's record, keeping its pictures. */
  readonly forgetBrowserSession: (input: { id: string }) => string | undefined;
  /** SIGTERM one daemon whose close went unconfirmed. */
  readonly terminate: (input: { pid: number }) => string | undefined;
  /** Take one session's lock without waiting: its release, or `undefined` when another process holds it. */
  readonly holdBrowserSession: (input: { id: string }) => (() => void) | undefined;
}

/**
 * Judge every stored browser session over the one snapshot, and carry the verdicts out unless this is a dry run.
 *
 * @param processes the snapshot the rest of the reap judged against
 * @param dryRun whether to plan only
 * @param onlyIds when set, the sessions whose verdicts are kept and carried out. Every record is still JUDGED, so
 *   the shared-client-name guard sees the whole home, and an unconfirmed close still re-reads every record
 * @returns the judgement and what came of it
 */
export function reapBrowserSessions({
  deps,
  dryRun,
  processes,
  onlyIds,
}: {
  deps: BrowserReapDeps;
  dryRun: boolean;
  processes: readonly ProcessRow[];
  onlyIds?: ReadonlySet<string>;
}): BrowserReapOutcome {
  const stored = deps.browserSessions();
  const judged = judgeBrowserSessions({
    input: gatherBrowserReapInput({
      nowIso: deps.nowIso(),
      processes,
      readers: { listeningPorts: deps.listeningPorts, liveOwners: () => deps.liveBrowserOwners({ processes }) },
      stored,
    }),
  });
  let verdicts = judged;
  if (onlyIds !== undefined) {
    verdicts = judged.filter((verdict) => onlyIds.has(verdict.id));
  }
  if (dryRun) {
    return { execution: emptyBrowserReapExecution(), verdicts };
  }
  const execution = executeBrowserReap({
    effects: {
      forget: deps.forgetBrowserSession,
      hold: deps.holdBrowserSession,
      processes: deps.processes,
      release: deps.releaseBrowser,
      sessions: deps.browserSessions,
      terminate: deps.terminate,
    },
    stored,
    verdicts,
  });
  return { execution, verdicts };
}

/**
 * Let go of one opener's own background sessions idle past their expiry — what `browser open` runs before it takes
 * another window, so one seat looking at page after page holds one window, not one per page, between sweep ticks.
 *
 * It is the reap's own judgement and executor narrowed to that opener's quiet sessions, never a second way of
 * closing a tab. It costs nothing but the record read when the opener holds none, which is the common case.
 *
 * @param deps the reap seams for the home `browser open` runs against
 * @param ownerPid the opener's Claude Code pid; `null` on a host that records none, which lets go of nothing
 * @returns one line saying what it let go of, or nothing when it held none
 */
export function letGoOfOwnQuietSessions({
  deps,
  ownerPid,
}: {
  deps: BrowserReapDeps;
  ownerPid: number | null;
}): readonly string[] {
  const expired = ownExpiredSessionIds({ nowIso: deps.nowIso(), ownerPid, sessions: deps.browserSessions() });
  if (expired.size === 0) {
    return [];
  }
  const processes = deps.processes();
  if (processes === undefined) {
    return [
      `browser open: the process table could not be read, so ${String(expired.size)} quiet session(s) of this seat are left for the next machine reap`,
    ];
  }
  // At most a few per open: each close is up to three client commands at the reap's 15-second ceiling, and the open
  // the caller asked for waits behind them, so a long pile is drained across opens and sweep ticks.
  const onlyIds = new Set([...expired].slice(0, PRE_OPEN_LET_GO_CEILING));
  // The registry and the listening ports judge an opener with no recorded pid, which none of these sessions is: they
  // are switched off rather than read, so an open pays for neither.
  const narrowed: BrowserReapDeps = { ...deps, listeningPorts: () => undefined, liveBrowserOwners: () => undefined };
  const { execution } = reapBrowserSessions({ deps: narrowed, dryRun: false, onlyIds, processes });
  const letGoCount = execution.closed.length + execution.forgotten.length;
  // A session kept (a shared client name), deferred, superseded, closed unconfirmed or past the ceiling is not let go
  // of: one count, per id.
  const unsure = expired.size - letGoCount;
  let line = `browser open: let go of ${String(letGoCount)} of this seat's session(s) idle past their 15-minute expiry`;
  if (unsure > 0) {
    line += ` (${String(unsure)} left for the next machine reap — \`slopweaver browser sessions\` lists them)`;
  }
  return [line];
}

/** The effects a browser reap needs, injected so a test never reaches a browser, a file or a pid. */
export interface BrowserReapEffects {
  /** A fresh process table, or `undefined` when it could not be read. */
  readonly processes: () => readonly ProcessRow[] | undefined;
  /** Close the session's tab and detach its client; the problems met, empty when the client confirmed both. */
  readonly release: (input: { session: InteractionSession }) => readonly string[];
  /** The session records as they stand now, re-read before a daemon is signalled. */
  readonly sessions: () => readonly StoredInteractionSession[];
  /** Remove the session's record, keeping its pictures; why it failed, or `undefined`. */
  readonly forget: (input: { id: string }) => string | undefined;
  /** SIGTERM one pid; why it failed, or `undefined`. */
  readonly terminate: (input: { pid: number }) => string | undefined;
  /** Take one session's lock without waiting: its release, or `undefined` when another process holds it. */
  readonly hold: (input: { id: string }) => (() => void) | undefined;
}

/**
 * Carry out every non-keep verdict. An idle-expiry verdict is carried out under the session's lock, the one a
 * command's claim takes (`../../../browser/sessionLock.ts`), so the re-read, the close and the removal are one
 * step a claim either wholly precedes or wholly follows; a lock another process holds leaves that session for
 * the next reap.
 *
 * @param verdicts the judgement, one per stored session
 * @param stored the records the judgement was made over — what a close needs to reach the client
 * @param effects the injected effects
 * @returns what happened, per session
 */
export function executeBrowserReap({
  verdicts,
  stored,
  effects,
}: {
  verdicts: readonly BrowserReapVerdict[];
  stored: readonly StoredInteractionSession[];
  effects: BrowserReapEffects;
}): BrowserReapExecution {
  const sessionById = new Map(stored.map((entry) => [entry.session.id, entry.session]));
  const done: MutableExecution = {
    closed: [],
    deferred: [],
    failed: [],
    forgotten: [],
    superseded: [],
    terminated: [],
    unknownTabs: [],
  };
  let relayAnswering = true;
  for (const verdict of verdicts) {
    if (verdict.action === "keep") {
      continue;
    }
    // EVERY let-go takes the session's lock, not only an idle one: an acting verb holds it for each client command,
    // so a closer that skipped it could close the tab under a running command and race a locked writer into
    // recreating the record — the unknown-owner and dead-opener verdicts included.
    const release = effects.hold({ id: verdict.id });
    if (release === undefined) {
      done.superseded.push(verdict.id);
      continue;
    }
    try {
      relayAnswering = actOnHeldVerdict({ done, effects, relayAnswering, sessionById, verdict });
    } finally {
      release();
    }
  }
  return done;
}

/* Act on one non-keep verdict whose session lock is held; whether the relay is still answering afterwards. */
function actOnHeldVerdict({
  done,
  effects,
  relayAnswering,
  sessionById,
  verdict,
}: {
  done: MutableExecution;
  effects: BrowserReapEffects;
  relayAnswering: boolean;
  sessionById: ReadonlyMap<string, InteractionSession>;
  verdict: BrowserReapVerdict;
}): boolean {
  if (usedSinceJudged({ effects, verdict })) {
    done.superseded.push(verdict.id);
    return relayAnswering;
  }
  if (verdict.action === "forget") {
    if (forgetRecord({ done, effects, id: verdict.id })) {
      done.forgotten.push(verdict.id);
    }
    return relayAnswering;
  }
  if (!relayAnswering) {
    done.deferred.push(verdict.id);
    return false;
  }
  return closeOne({ done, effects, session: sessionById.get(verdict.id)!, verdict });
}

/* What an execution collects, as it collects it. */
interface MutableExecution {
  closed: string[];
  deferred: string[];
  failed: { id: string; why: string }[];
  forgotten: string[];
  superseded: string[];
  terminated: number[];
  unknownTabs: { id: string; why: string }[];
}

/*
 * Whether a verdict went stale before it was acted on, read again under the session's lock: the record is gone
 * (another closer already let it go), or an idle-expiry verdict's record carries a touch the judgement did not see.
 * A command that acts through a tab claims it at LOAD and again for each client command (`claimLiveSession`,
 * `keptAliveDeps`, `../browser/sessionHold.ts`), so this catches a claim landing between the judgement and the act.
 * Every other verdict rests on the opener or the page, never the touch.
 */
function usedSinceJudged({ effects, verdict }: { effects: BrowserReapEffects; verdict: BrowserReapVerdict }): boolean {
  const now = effects.sessions().find((entry) => entry.session.id === verdict.id);
  if (now === undefined) {
    return true;
  }
  return verdict.idleJudgedOn !== null && now.session.touchedAtIso !== verdict.idleJudgedOn;
}

/* Remove one record, collecting why when it could not be; whether it went. */
function forgetRecord({
  done,
  effects,
  id,
}: {
  done: MutableExecution;
  effects: BrowserReapEffects;
  id: string;
}): boolean {
  const why = effects.forget({ id });
  if (why !== undefined) {
    done.failed.push({ id, why: `its record could not be removed: ${why}` });
    return false;
  }
  return true;
}

/* Close one session through its client; whether the relay confirmed it, which is whether later closes may run. */
function closeOne({
  done,
  effects,
  session,
  verdict,
}: {
  done: MutableExecution;
  effects: BrowserReapEffects;
  session: InteractionSession;
  verdict: BrowserReapVerdict;
}): boolean {
  const problems = effects.release({ session });
  if (problems.length === 0) {
    if (forgetRecord({ done, effects, id: verdict.id })) {
      done.closed.push(verdict.id);
    }
    return true;
  }
  done.unknownTabs.push({ id: verdict.id, why: problems.join("; ") });
  const ended = endDaemon({ effects, verdict });
  if (ended.pid !== undefined) {
    done.terminated.push(ended.pid);
  }
  if (ended.why !== undefined) {
    done.failed.push({ id: verdict.id, why: ended.why });
  }
  // The record goes either way, exactly as `browser close` does: nothing may act through a session whose
  // client could not be reached, and leaving it would invite exactly that.
  forgetRecord({ done, effects, id: verdict.id });
  return false;
}

/* SIGTERM the one daemon still holding a session whose close went unconfirmed, when it provably is one. */
function endDaemon({ verdict, effects }: { verdict: BrowserReapVerdict; effects: BrowserReapEffects }): {
  readonly pid: number | undefined;
  readonly why: string | undefined;
} {
  const fresh = effects.processes();
  if (fresh === undefined) {
    return { pid: undefined, why: "the process table could not be re-read, so its daemon was not signalled" };
  }
  // Uniqueness is judged on the FRESH read unfiltered: a second daemon that appeared after the judgement makes
  // the name ambiguous exactly as one present from the start does.
  const carrying = daemonPidsOf({ clientSession: verdict.clientSession, processes: fresh });
  if (carrying.length === 0) {
    return { pid: undefined, why: undefined };
  }
  if (carrying.length > 1) {
    return {
      pid: undefined,
      why: `${String(carrying.length)} daemons carry ${verdict.clientSession}, so none was signalled rather than guess`,
    };
  }
  // A record opened since the judgement may carry the same eight-character name and be using this daemon, so the
  // records are re-read beside the process table.
  const named = effects
    .sessions()
    .filter((entry) => entry.session.clientSession === verdict.clientSession && entry.session.id !== verdict.id);
  if (named.length > 0) {
    return {
      pid: undefined,
      why: `another record now carries ${verdict.clientSession}, so its daemon was not signalled`,
    };
  }
  const pid = carrying[0]!;
  if (!verdict.daemonPids.includes(pid)) {
    return {
      pid: undefined,
      why: `the daemon now carrying ${verdict.clientSession} (${String(pid)}) is not the one judged, so it was not signalled`,
    };
  }
  const why = effects.terminate({ pid });
  if (why !== undefined) {
    return { pid: undefined, why: `its daemon ${String(pid)} could not be signalled: ${why}` };
  }
  return { pid, why: undefined };
}
