/**
 * The supervisor's seat on the sessions page.
 *
 * The supervisor is green only on a sign it gave itself: a `chair-reoriented` line for its own session written after
 * its current process started, or a sweep its pinned workspace both started and closed (`supervisor tick close`) after
 * it took the seat. Its process existing is never enough. A chair seated by handoff writes the second every tick and
 * the first only when a recovery pass nudges it, so reading the reorientation alone called a sweeping chair down.
 *
 * Running is never green, but it is LIVE: a chair whose own process runs with no login wall read carries `live`
 * whatever its colour, because its sweep record can fail while it works — MEASURED: every `tick close`
 * failed on a hung cmux socket while the chair answered the owner. Repro:
 * `cat "$SLOPWEAVER_HOME/supervisor-scratch/<handoff>/<tick>/close-done.err"`.
 *
 * Pure: evidence in, a seat out.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { FleetEvidence, FleetLiveSession } from "./evidence.js";
import {
  bootWall,
  inFlight,
  pastReorientWait,
  phaseFor,
  REORIENT_MINUTES,
  refusedDetail,
  UNREADABLE_PLAN_LONG,
} from "./seatJudgement.js";
import type { FleetChairSignal, FleetSeat } from "./types.js";

/**
 * A Codex chair whose thread a Codex process positively holds: live, and still yellow, because its own sign of
 * working — a reorientation or a closed sweep judged against its seat — is not read for a Codex chair here.
 */
export const CODEX_CHAIR_LIVE =
  "The supervisor runs on Codex and a Codex process holds its thread, so it is running; whether it is caught up is not read here, so it is not green.";

/**
 * A Codex chair no Codex process was seen holding. Never red: Codex keeps no live-thread registry, so absence from
 * its open files proves nothing, and the Claude session registry holds no Codex thread to match.
 */
const CODEX_CHAIR_LIVENESS_UNMEASURED = "Codex chair liveness UNMEASURED — ";

/**
 * A Codex chair's seat from what Codex's open files say about its thread — yellow either way, `live` only on a
 * positive observation.
 */
function codexChairSeat({
  base,
  chairCodex,
}: {
  base: Omit<FleetSeat, "colour" | "detail">;
  chairCodex: NonNullable<FleetEvidence["chairCodex"]>;
}): FleetSeat {
  if (chairCodex.observation.kind === "live") {
    return { ...base, colour: "yellow", detail: CODEX_CHAIR_LIVE, live: true };
  }
  return {
    ...base,
    colour: "yellow",
    detail: `${CODEX_CHAIR_LIVENESS_UNMEASURED}${chairCodex.observation.why}.`,
  };
}

/** The instant a chair is judged from, whether it could be established, and how the words name it. */
type ChairSince = { readonly known: boolean; readonly ms: number; readonly words: string };

/** Whether a process's start was read: exactly 0 is the reader's mark for one that was not. */
function startKnown({ session }: { session: FleetLiveSession }): boolean {
  return session.startedAtMs !== 0;
}

/**
 * When the chair is judged from: the later of its process starting and its taking the pin. A seat that became the
 * supervisor by handoff hours after it booted was otherwise past the wait the instant it took the seat — MEASURED
 * on one chair booted hours before it was pinned, which read red with every sweep it closed ignored.
 * Repro: `cat "$SLOPWEAVER_HOME/sessions/supervisor-pin.json"` beside its `~/.claude/sessions/<pid>.json` startedAt.
 * `known` is false when that later instant cannot be established — a pin that does not parse, or a process whose
 * start could not be read and no pin after it — so no sign is dated against a guess.
 */
function chairSince({ evidence, session }: { evidence: FleetEvidence; session: FleetLiveSession }): ChairSince {
  if (evidence.chairPinnedAtIso !== undefined) {
    // Strict: `Date.parse` reads a bare "0" as the year 2000, a boundary nobody set.
    const pinnedMs = parseStrictIsoInstantMs({ text: evidence.chairPinnedAtIso });
    if (pinnedMs === undefined) {
      return { known: false, ms: session.startedAtMs, words: "it started" };
    }
    // With the start unknown, a valid pin IS the boundary, even one at the epoch the 0 mark shares.
    if (!startKnown({ session }) || pinnedMs > session.startedAtMs) {
      return { known: true, ms: pinnedMs, words: "it became the supervisor" };
    }
  }
  return { known: startKnown({ session }), ms: session.startedAtMs, words: "it started" };
}

/** The newer of two signs, either of which may be absent. */
function newerSignal({
  left,
  right,
}: {
  left: FleetChairSignal | undefined;
  right: FleetChairSignal | undefined;
}): FleetChairSignal | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Date.parse(right.atIso) > Date.parse(left.atIso) ? right : left;
}

/** The chair's newest reorientation and newest sweep, each as a sign, whenever they were. */
function chairSignals({ evidence }: { evidence: FleetEvidence }): {
  readonly reoriented: FleetChairSignal | undefined;
  readonly swept: FleetChairSignal | undefined;
} {
  const reorientedIso =
    evidence.chairSessionId === undefined ? undefined : evidence.reorientations.get(evidence.chairSessionId);
  return {
    reoriented: reorientedIso === undefined ? undefined : { atIso: reorientedIso, kind: "reoriented" },
    swept:
      evidence.chairSweep.kind === "swept" ? { atIso: evidence.chairSweep.finalisedIso, kind: "swept" } : undefined,
  };
}

/** The chair's newest sign of either kind, for the page to name — counted or not. */
function lastChairSignal({ evidence }: { evidence: FleetEvidence }): { lastSignal?: FleetChairSignal } {
  const { reoriented, swept } = chairSignals({ evidence });
  const last = newerSignal({ left: reoriented, right: swept });
  return last === undefined ? {} : { lastSignal: last };
}

/**
 * The live process that is the chair. One session id can run as two processes at once (`parkSeat.ts`'s twins), so
 * only those in the pinned workspace are candidates whenever any is there, and the latest started of them wins; with
 * none there, the latest started of all, so a predecessor's reorientation is never dated against an older process's
 * start.
 */
function chairProcess({ evidence }: { evidence: FleetEvidence }): FleetLiveSession | undefined {
  const same = evidence.sessions.filter((candidate) => candidate.sessionId === evidence.chairSessionId);
  const pinned = same.filter((candidate) => candidate.workspaceRef === evidence.chairWorkspaceRef);
  const pool = pinned.length > 0 ? pinned : same;
  return pool.reduce<FleetLiveSession | undefined>(
    (latest, candidate) =>
      latest === undefined || startRank({ session: candidate }) > startRank({ session: latest }) ? candidate : latest,
    undefined,
  );
}

/**
 * A process's start for picking the latest twin. An unknown start (0) may be the newest process of all, so it ranks
 * above every known one: the chair is then dated from its seat boundary rather than from an older twin's start,
 * which would admit a reorientation the newer process never gave.
 */
function startRank({ session }: { session: FleetLiveSession }): number {
  return startKnown({ session }) ? session.startedAtMs : Number.POSITIVE_INFINITY;
}

/** Why the chair reads green — a sign it gave itself inside its seat — or `undefined` when it gave none. */
function signOfWork({
  evidence,
  session,
  since,
}: {
  evidence: FleetEvidence;
  session: FleetLiveSession;
  since: ChairSince;
}): string | undefined {
  const { reoriented } = chairSignals({ evidence });
  // A reorientation counts from the process start, not the pin: `cmux pin` rewrites the pin's instant when a working
  // chair re-pins itself, and that must not take back a sign it already gave (the brief's boundary: never harm a
  // working chair). An unread start is recorded as 0, which would date every old reorientation inside this process,
  // so an unknown start falls to the seat's own boundary instead, and counts nothing when that is unknown too.
  const started = startKnown({ session });
  const reorientedFromMs = started ? session.startedAtMs : since.ms;
  const reorientationDatable = started || since.known;
  // Strict for the same reason as the pin: the journal's `atIso` is any string, and `Date.parse` rolls day 30 of February
  // into March.
  const reorientedMs = reoriented === undefined ? undefined : parseStrictIsoInstantMs({ text: reoriented.atIso });
  if (reorientationDatable && reorientedMs !== undefined && reorientedMs >= reorientedFromMs) {
    return "Caught up and supervising.";
  }
  // A sweep counts only when it STARTED inside the seat too: a predecessor's sweep finishing after the handoff is not
  // this chair working. Both instants are checked here as well as in the reader, so evidence
  // built anywhere else cannot pass a sweep closed before the seat. A seat whose boundary is
  // unknown, an unreadable pin above all, dates no sweep.
  const sweep = evidence.chairSweep;
  const sweptInSeat =
    since.known &&
    sweep.kind === "swept" &&
    Date.parse(sweep.startedIso) >= since.ms &&
    Date.parse(sweep.finalisedIso) >= since.ms;
  return sweptInSeat ? `Supervising: it has closed a sweep since ${since.words}.` : undefined;
}

/**
 * A live chair that gave no sign of working. It reads red only past the wait, in words that say what has NOT
 * arrived, because the absence of a success signal is the problem, worded with its uncertainty.
 */
function quietChairSeat({
  evidence,
  seat,
  session,
  since,
}: {
  evidence: FleetEvidence;
  seat: Omit<FleetSeat, "colour" | "detail">;
  session: FleetLiveSession;
  since: ChairSince;
}): FleetSeat {
  const awaiting =
    evidence.attempt?.chair.kind === "awaiting" && evidence.attempt.chair.chairSessionId === session.sessionId;
  if (awaiting && evidence.attemptRunning) {
    return {
      ...seat,
      colour: "yellow",
      detail: "Back, and reading the picture in. Nothing else starts until it says it is caught up.",
      flashing: true,
    };
  }
  // A sweep record that could not be read may hide a sweep the chair did close, so the words say the checker itself
  // is in doubt rather than claiming the chair is quiet.
  const unread =
    evidence.chairSweep.kind === "unreadable"
      ? " Its sweep record could not be read, so a sweep it closed may not have been seen."
      : "";
  // Past the pass's own wait with no pass running, a chair with no sign of working is red, so the fleet reads down
  // and recovery nudges it — yellow forever was a fleet settling with nothing to move it.
  if (pastReorientWait({ evidence, fromMs: since.ms })) {
    return {
      ...seat,
      colour: "red",
      detail: `There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the ${REORIENT_MINUTES} minutes since ${since.words}.${unread}`,
    };
  }
  return {
    ...seat,
    colour: "yellow",
    detail: `Running, but it has not yet said it is caught up or closed a sweep since ${since.words}.${unread}`,
    flashing: awaiting,
  };
}

/** A live chair on a credential that can answer: green only on a sign it gave itself; its process never counts. */
function liveChairSeat({
  evidence,
  session,
  withId,
}: {
  evidence: FleetEvidence;
  session: FleetLiveSession;
  withId: Omit<FleetSeat, "colour" | "detail">;
}): FleetSeat {
  // A boot not bound to its process is no proof this is the chair that reoriented, so it is never green.
  // Live whatever colour it reads, an unreadable plan included: no wall was read, so a recovery pass only waits on
  // this same process again, and nothing asks the owner to press one over it.
  const live = { ...withId, live: true as const };
  if (session.boot.kind === "unresolved") {
    if (pastReorientWait({ evidence, fromMs: session.startedAtMs })) {
      return { ...live, colour: "red", detail: UNREADABLE_PLAN_LONG };
    }
    return { ...live, colour: "yellow", detail: "Running, but which plan it is on could not be read." };
  }
  const since = chairSince({ evidence, session });
  const seat = { ...live, signalExpectedSinceIso: new Date(since.ms).toISOString() };
  const working = signOfWork({ evidence, session, since });
  if (working !== undefined) {
    return { ...seat, colour: "green", detail: working };
  }
  return quietChairSeat({ evidence, seat, session, since });
}

/**
 * Colour the supervisor — green only on a sign of working it gave itself.
 *
 * @param evidence everything `fleet health` read
 * @returns the supervisor's seat
 */
export function chairSeat({ evidence }: { evidence: FleetEvidence }): FleetSeat {
  const base = {
    flashing: false,
    priority: "p0" as const,
    role: "supervisor" as const,
    rowTitle: "Supervisor — your one intake",
    seatId: "supervisor",
  };
  if (evidence.chairCodex !== undefined) {
    return codexChairSeat({ base, chairCodex: evidence.chairCodex });
  }
  if (evidence.chairUnresolved !== undefined) {
    return {
      ...base,
      colour: "yellow",
      detail: `Which session holds the chair could not be read: ${evidence.chairUnresolved}`,
    };
  }
  if (evidence.chairSessionId === undefined) {
    return { ...base, colour: "red", detail: "Nothing records which session is the supervisor." };
  }
  const withId = { ...base, sessionId: evidence.chairSessionId, ...lastChairSignal({ evidence }) };
  const session = chairProcess({ evidence });
  if (session === undefined) {
    if (evidence.attemptRunning) {
      return { ...withId, colour: "yellow", detail: "Being brought back first.", flashing: true };
    }
    return { ...withId, colour: "red", detail: "The supervisor is not running." };
  }
  const wall = bootWall({ boot: session.boot, signedOutStores: evidence.signedOutStores });
  if (wall !== undefined) {
    const phase = phaseFor({ attempt: evidence.attempt, session });
    if (inFlight({ phase, running: evidence.attemptRunning })) {
      return { ...withId, colour: "yellow", detail: "Relaunching now.", flashing: true };
    }
    return { ...withId, colour: "red", detail: refusedDetail({ evidence, fallback: wall, phase }) };
  }
  return liveChairSeat({ evidence, session, withId });
}
