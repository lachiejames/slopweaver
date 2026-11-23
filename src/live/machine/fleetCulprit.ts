/**
 * WHO a capacity reading blames, and the one command that ends it — the subject line of `./capacity.ts`'s
 * verdict. Split out of `./fleetLoad.ts`, which attributes the load; this reads that attribution and picks.
 *
 * The order, and why each step sits where it does:
 *
 * 1. **Runaway searches** (`./runawaySearch.ts`). Ending them costs no seat anything, and naming
 *    their session instead — `kill <session pid>` to stop six grep children — is the incident that added
 *    this step.
 * 2. **A stalled session**: a wedged hook is a defect, a busy tree is only busy.
 * 3. **Whichever of the dead seats' orphans and the heaviest live session costs more CPU.**
 *
 * Two sessions are never a candidate at steps 2 and 3, because naming either offers `kill <pid>` to a seat that
 * did nothing measured:
 *
 * - **The pinned supervisor chair.** Ending it ends the owner's one intake; the pick moves to the next session.
 * - **A session with no measured CPU.** Ranking is by CPU actually used, so when the per-process sample is
 *   missing (`cpuAttributed` false, every `cpuPct` zero) or a session read 0%, the top of the list is an
 *   arbitrary row, not a cause. A stalled hook stays a candidate without CPU: the stall is its own measurement.
 *
 * A step runs BEFORE all three, in `./capacity.ts` rather than here: a watched daemon holding a memory reading
 * (`./daemonCulprit.ts`), because no fleet process this module weighs can free memory a root daemon holds.
 *
 * `undefined` only when the fleet is genuinely running nothing — a `HOLD on cpu` that names nobody is the
 * failure `./fleetLoad.ts` exists to end.
 */
import {
  briefDuration,
  DEFAULT_HOOK_STALL_HOLD_SECONDS,
  DEFAULT_PARALLEL_CALL_ALERT,
  deadSeatOrphans,
  type FleetLoadReading,
  type SessionLoad,
  snapshotLabel,
  stalledHookLabel,
  stalledSessions,
} from "./fleetLoad.js";
import { type RunawaySearch, searchCpuPct } from "./runawaySearch.js";

/** Who a capacity verdict names as the subject of its reading, and the one command that ends it. */
export interface FleetCulprit {
  /** What to name — `session <id>`, the dead seat an orphan group belongs to, or a session's runaway searches. */
  readonly subject: string;
  /** The measurement that selected it, in one clause. */
  readonly why: string;
  /** The command that ends it, ready to run. */
  readonly kill: string;
  /**
   * Who may run {@link kill}: `seat` for a command any session may run, `owner` for a root daemon's relief only
   * the owner can (`./daemonCulprit.ts`). The verdict words an `owner` one as a hand step, and `./anomaly.ts`
   * carries it in prose with no `kill`, so `./backoff.ts` keeps doubling on a condition no seat can end.
   */
  readonly endedBy: "seat" | "owner";
}

/** The clause naming what a session is doing that made it the subject — its stall, its fan-out, or its CPU. */
function sessionWhy({ session, parallelCallAlert }: { session: SessionLoad; parallelCallAlert: number }): string {
  const parts = [`${String(session.cpuPct)}% cpu across ${String(session.processCount)} processes`];
  if (session.parallelToolCalls >= parallelCallAlert) {
    parts.push(`${String(session.parallelToolCalls)} tool calls in flight`);
  }
  if (session.hookStallSeconds !== undefined) {
    parts.push(
      `${stalledHookLabel({ script: session.hookStallScript })} stalled ${briefDuration({ seconds: session.hookStallSeconds })}`,
    );
  }
  return parts.join(", ");
}

/**
 * Where a set of runaway searches lives, as the subject names it: the one session when they share it, else
 * how many sessions. No pid and no count, so `./anomaly.ts`'s dedupe key does not rotate as searches end.
 *
 * @param searches the runaway searches, at least one
 * @returns `runaway searches in session <id>`, or `runaway searches in <n> sessions`
 */
export function runawaySearchSubject({ searches }: { searches: readonly RunawaySearch[] }): string {
  const sessions = [...new Set(searches.map((search) => search.sessionId))];
  if (sessions.length === 1) {
    return `runaway searches in session ${sessions[0]!}`;
  }
  return `runaway searches in ${String(sessions.length)} sessions`;
}

/** The culprit for a set of runaway searches — never `kill <session pid>`, because only the searches ran away. */
function searchCulprit({ searches }: { searches: readonly RunawaySearch[] }): FleetCulprit {
  const cpu = searchCpuPct({ searches });
  const oldest = Math.max(...searches.map((search) => search.elapsedSeconds));
  const labels = searches.map((search) => `${String(search.pid)} (${search.binary})`).join(", ");
  return {
    endedBy: "seat",
    kill: "slopweaver machine reap",
    subject: runawaySearchSubject({ searches }),
    why: `${String(searches.length)} search(es) at ${String(cpu)}% cpu, oldest ${briefDuration({ seconds: oldest })}: ${labels} — the seat itself is not the subject`,
  };
}

/**
 * The sessions a kill may be offered to: never the chair, and, outside a stall, only one whose CPU was measured
 * above zero. Order is kept, so the first is still the heaviest.
 *
 * @param chairSessionId the pinned supervisor's session id, or `undefined` when no pin is recorded
 * @param stall whether these are stalled sessions, whose stall stands in for a CPU measurement
 * @returns the candidates, heaviest first
 */
function killableSessions({
  sessions,
  reading,
  chairSessionId,
  stall,
}: {
  sessions: readonly SessionLoad[];
  reading: FleetLoadReading;
  chairSessionId: string | undefined;
  stall: boolean;
}): readonly SessionLoad[] {
  const notChair = sessions.filter((session) => session.sessionId !== chairSessionId);
  if (stall) {
    return notChair;
  }
  if (!reading.cpuAttributed) {
    return [];
  }
  return notChair.filter((session) => session.cpuPct > 0);
}

/**
 * WHO the reading blames — this module's header carries the order.
 *
 * @param reading the fleet attribution
 * @param searches the runaway searches the same snapshot holds
 * @param chairSessionId the pinned supervisor's session id, never offered a kill; `undefined` when unpinned
 * @param stallHoldSeconds the hook-stall line (defaults to {@link DEFAULT_HOOK_STALL_HOLD_SECONDS})
 * @param parallelCallAlert the in-flight-call line (defaults to {@link DEFAULT_PARALLEL_CALL_ALERT})
 * @returns the subject, the measurement that selected it and the command that ends it
 */
export function fleetCulprit({
  reading,
  searches,
  chairSessionId,
  stallHoldSeconds = DEFAULT_HOOK_STALL_HOLD_SECONDS,
  parallelCallAlert = DEFAULT_PARALLEL_CALL_ALERT,
}: {
  reading: FleetLoadReading;
  searches: readonly RunawaySearch[];
  chairSessionId: string | undefined;
  stallHoldSeconds?: number;
  parallelCallAlert?: number;
}): FleetCulprit | undefined {
  if (searches.length > 0) {
    return searchCulprit({ searches });
  }
  const stalled = killableSessions({
    chairSessionId,
    reading,
    sessions: stalledSessions({ reading, stallHoldSeconds }),
    stall: true,
  })[0];
  const topOrphan = deadSeatOrphans({ reading })[0];
  const topSession = killableSessions({ chairSessionId, reading, sessions: reading.sessions, stall: false })[0];
  const orphanCpu = reading.orphanCpuPct;
  let session = topSession;
  if (stalled !== undefined) {
    session = stalled;
  }
  const orphansWin =
    topOrphan !== undefined && (session === undefined || (stalled === undefined && orphanCpu >= session.cpuPct));
  if (orphansWin) {
    const oldest = topOrphan.oldestSeconds;
    const age = oldest === undefined ? "age unread" : `oldest ${briefDuration({ seconds: oldest })}`;
    return {
      endedBy: "seat",
      kill: "slopweaver machine reap",
      subject: `${String(reading.orphanCount)} orphaned fleet shell(s), ${String(deadSeatOrphans({ reading }).length)} dead seat(s), top seat ${snapshotLabel({ snapshot: topOrphan.snapshot })}`,
      why: `${String(orphanCpu)}% cpu with no session left to read them, ${age}`,
    };
  }
  if (session === undefined) {
    return undefined;
  }
  return {
    endedBy: "seat",
    kill: `kill ${String(session.pid)}`,
    subject: `session ${session.sessionId}`,
    why: sessionWhy({ parallelCallAlert, session }),
  };
}
