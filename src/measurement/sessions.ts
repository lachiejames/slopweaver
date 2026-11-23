/**
 * Which Claude sessions are alive, keyed by the only identity that survives a turn.
 *
 * ## The defect this exists for
 *
 * A run journal records a `pid` beside its `sessionId`, and liveness was asked of that pid. **The pid was
 * never the session's.** `handover start` records `process.pid` — the short-lived `slopweaver` command, gone
 * the instant it returns — and the fleet driver recorded the pid of a `claude -p` child, which is one turn
 * and dead from the next. Measured: `fleet status` printed thirteen rows and every one of them
 * said `exited`, while four of those sessions were demonstrably running.
 *
 * A board that reports every live run as dead is worse than one that says nothing, because a plan gets built
 * on it. One was: it advised starting work already in flight in another window.
 *
 * ## The identity was already on disk
 *
 * `sessionId` is written on the same journal line by both writers, and {@link ../handover/runOwner.writerOf}
 * already derives it. Nothing new had to be recorded — only read. The pid stays on the row as EVIDENCE, next
 * to the verdict, but it decides nothing.
 *
 * ## Absence of proof is reported, never converted to "dead"
 *
 * Every answer here is a {@link ./status.Measured}. If the registry cannot be read, a run's liveness is
 * `NOT MEASURED` with the reason — not `false`. That distinction is the whole point: "I did not look" and
 * "nothing is there" are different answers, and collapsing them is the failure this module removes.
 *
 * Pure core (`rosterFrom`, `sessionLiveness`) plus a thin reader (`discoverSessions`), so every rule is
 * testable with fabricated records and no filesystem.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { type SessionScan, scanSessions } from "../sessions/liveSessionStore.js";
import { isAlive } from "./measure.js";
import { type Measured, measured, unmeasurable } from "./status.js";

/**
 * What this roster structurally cannot see, stated whether or not anything went wrong.
 *
 * A list that implies completeness is the same defect in a new place, so these travel with every answer
 * rather than being mentioned in documentation nobody reads at the moment of doubt.
 */
export const STANDING_BLIND_SPOTS: readonly string[] = [
  "a session on another machine is not discoverable from this one",
  "a session whose registry entry has not been written yet is missing until it is",
];

/** Every live session id, plus every reason this answer under-covers the machine. */
export interface SessionRoster {
  /** The session ids proven alive: a registry entry AND a process that answered. */
  readonly liveIds: ReadonlySet<string>;
  /**
   * Every registry entry this roster could not account for, one sentence each — a file that would not decode,
   * and a record that decoded but names no session.
   *
   * Load-bearing, not decorative. Neither kind can be tied to a session id, so any one of them could be the
   * session being asked about, which is why a NEGATIVE answer is withheld while this list is non-empty.
   */
  readonly refused: readonly string[];
  /**
   * What this roster structurally cannot see, whether or not anything failed.
   *
   * Informational: these bound the roster's SCOPE rather than its accuracy within that scope, so unlike
   * {@link refused} they do not withhold a verdict. A run on this machine is either in the registry or it is
   * not running.
   */
  readonly blindSpots: readonly string[];
}

/**
 * Build the roster from an already-read scan.
 *
 * A registry entry alone is not liveness: the file is deleted on a CLEAN exit, so an unclean one leaves a
 * stale entry behind. The process is asked as well, and only a session with both is counted.
 *
 * @param scan the registry scan
 * @param processAlive whether a pid still exists, injected so this stays pure
 * @returns the roster, or the reason the registry could not be read at all
 */
export function rosterFrom({
  scan,
  processAlive,
}: {
  scan: SessionScan;
  processAlive: (args: { pid: number }) => boolean;
}): Measured<SessionRoster> {
  if (scan.unreadable !== undefined) {
    return unmeasurable<SessionRoster>({ why: scan.unreadable });
  }
  const liveIds = new Set<string>();
  const unnamed: string[] = [];
  for (const record of scan.records) {
    if (record.sessionId === "") {
      // Decoded, but it names no session — so it is a session this roster cannot account for, exactly like a
      // file that would not decode. Dropping it silently let a live run absent from `liveIds` read as gone.
      unnamed.push(`pid ${String(record.pid)}: the registry record names no session, so it cannot be matched`);
      continue;
    }
    if (processAlive({ pid: record.pid })) {
      liveIds.add(record.sessionId);
    }
  }
  return measured({
    value: { blindSpots: STANDING_BLIND_SPOTS, liveIds, refused: [...scan.refused, ...unnamed] },
  });
}

/**
 * Whether one session is alive, according to a roster.
 *
 * ## Presence proves life; absence only proves it when NOTHING was refused
 *
 * Finding a session in the roster is positive evidence and answers `true` outright. Not finding one is only
 * evidence of absence when every registry file decoded — because a refusal names a FILE, not a session, so a
 * live session hiding behind a half-written registry file is indistinguishable from one that ended.
 *
 * Answering `false` there would put the drive back exactly where this module started: `fleet reap` ends a
 * drive on a `false`, so a truncated file would have ended a running agent's work. An adversarial review pass
 * found this on the first version of this function, which had folded the refusals in with the standing scope
 * notes and then ignored both.
 *
 * @param sessionId the session to ask about, or `undefined` when the journal named none
 * @param roster the roster, or the reason there is none
 * @returns whether it is alive, or the reason that could not be established
 */
export function sessionLiveness({
  sessionId,
  roster,
}: {
  sessionId: string | undefined;
  roster: Measured<SessionRoster>;
}): Measured<boolean> {
  if (sessionId === undefined) {
    return unmeasurable<boolean>({ why: "the journal records no session id, so there is nothing to ask about" });
  }
  if (!roster.known) {
    return unmeasurable<boolean>({ why: `the live-session registry could not be read — ${roster.why}` });
  }
  if (roster.value.liveIds.has(sessionId)) {
    return measured({ value: true });
  }
  const refused = roster.value.refused;
  if (refused.length > 0) {
    return unmeasurable<boolean>({
      why:
        `${sessionId} is not in the registry, but ${String(refused.length)} registry file(s) would not decode ` +
        `and a refusal names a file rather than a session, so any of them could be it (${refused.join("; ")})`,
    });
  }
  return measured({ value: false });
}

/**
 * Read the live-session registry.
 *
 * The effectful half. It reuses {@link ../sessions/liveSessionStore.scanSessions} rather than shelling
 * `claude agents --json`: the registry is the same population for every session that carries a pid, it needs
 * no subprocess, and a second reader of the same fact is how two surfaces start disagreeing. The one thing
 * the registry does not carry is a BACKGROUND agent, which has no pid and never opens a run — so it cannot
 * hold a claim, which is what this roster is consulted for.
 *
 * @param sessionsDir the registry directory, normally `~/.claude/sessions`
 * @returns the roster, or the reason it could not be established
 */
export function discoverSessions({ sessionsDir }: { sessionsDir: string }): Measured<SessionRoster> {
  return rosterFrom({ processAlive: isAlive, scan: scanSessions({ sessionsDir }) });
}

/**
 * Where Claude Code keeps its live-session registry.
 *
 * One spelling, because two surfaces resolving this path independently is how they start reporting different
 * populations of the same machine.
 *
 * @returns the absolute path to `~/.claude/sessions`
 */
export function defaultSessionsDir(): string {
  return join(homedir(), ".claude", "sessions");
}
