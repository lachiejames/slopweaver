/**
 * Fold everything `fleet health` read into the one document the sessions page renders.
 *
 * ## What makes a seat green
 *
 * A worker is green when its session is live AND it booted on a plan's credential that can answer — a setup token,
 * or a plan store that is not signed out. A restored seat is live and walled at once (measured: a bare
 * `claude --resume` on an empty store registers in `~/.claude/sessions` like any other session, and its screen reads
 * "Not logged in · Run /login"), so liveness alone would paint a locked-out fleet green. The boot credential is read
 * off the process itself (`../claude/seatBootRead.ts`), which needs no cmux.
 *
 * The supervisor is green only on a sign it gave itself, never on its process existing: `./chairSeat.ts`.
 *
 * A seat recovery HELD as a crash loop stays red, and is named to `./healthVerdict.ts`, which decides what its being
 * red means for the fleet's state.
 *
 * Pure: evidence in, a document out.
 */
import { basename } from "node:path";

import { chairSeat } from "./chairSeat.js";
import type { FleetEvidence, FleetLiveSession, FleetService } from "./evidence.js";
import { attemptFields, fleetHealthVerdict } from "./healthVerdict.js";
import type { FleetSeatPhase } from "./journal.js";
import {
  bootWall,
  inFlight,
  pastReorientWait,
  phaseFor,
  refusedDetail,
  UNREADABLE_PLAN_LONG,
} from "./seatJudgement.js";
import { compareSeats, emptySeats } from "./seatOrder.js";
import type { FleetHealthDocument, FleetSeat } from "./types.js";

/** Whether the newest attempt held this worker as a crash loop. */
function heldAsLoop({ phase }: { phase: FleetSeatPhase | undefined }): boolean {
  return phase?.role === "worker" && phase.phase === "held" && phase.refusal?.code === "CRASH_LOOP";
}

/** Colour one live worker. */
function workerSeat({ evidence, session }: { evidence: FleetEvidence; session: FleetLiveSession }): FleetSeat {
  const phase = phaseFor({ attempt: evidence.attempt, session });
  const common = {
    flashing: false,
    priority: session.row === undefined ? ("unassigned" as const) : session.row.priority,
    role: "worker" as const,
    // A seat no row names is called by its directory's last segment — a worktree's name is its slug — never by the
    // whole path, which crowded out the page in the lockout drill.
    rowTitle: session.row === undefined ? basename(session.cwd) : session.row.title,
    seatId: session.sessionId,
    sessionId: session.sessionId,
    ...(session.row === undefined ? {} : { rowId: session.row.id }),
  };
  if (inFlight({ phase, running: evidence.attemptRunning })) {
    return { ...common, colour: "yellow", detail: "Relaunching now.", flashing: true };
  }
  const wall = bootWall({ boot: session.boot, signedOutStores: evidence.signedOutStores });
  if (wall !== undefined) {
    return { ...common, colour: "red", detail: refusedDetail({ evidence, phase, fallback: wall }) };
  }
  // An off-plan boot is a wall above, so a boot carrying a `why` here is an unresolved one.
  if ("why" in session.boot) {
    if (pastReorientWait({ evidence, fromMs: session.startedAtMs })) {
      return { ...common, colour: "red", detail: UNREADABLE_PLAN_LONG };
    }
    return {
      ...common,
      colour: "yellow",
      // Fixed copy: `boot.why` is a producer's diagnostic, and nothing above the page's fold is ever one.
      detail: "Running, but which plan it is on could not be read.",
    };
  }
  return { ...common, colour: "green", detail: `Running on ${session.boot.alias}.` };
}

/** One standing service as a seat. */
function serviceSeat({
  role,
  title,
  service,
}: {
  role: "loop" | "keep-alive";
  title: string;
  service: FleetService;
}): FleetSeat {
  return {
    colour: service.live ? "green" : "red",
    detail: service.detail,
    flashing: false,
    priority: "p0",
    role,
    rowTitle: title,
    seatId: role,
  };
}

/** Whether a seat the attempt touched has a live session, by its session id or its workspace. */
function seatIsLive({
  phase,
  live,
  liveRefs,
}: {
  phase: FleetSeatPhase;
  live: ReadonlySet<string>;
  liveRefs: ReadonlySet<string | undefined>;
}): boolean {
  return (phase.sessionId !== undefined && live.has(phase.sessionId)) || liveRefs.has(phase.workspaceRef);
}

/**
 * Seats recovery refused, held or left mid-relaunch that have no live session at all — they are still seats the owner had.
 *
 * A seat the attempt journalled `reseated` is not one of them: recovery's work on it succeeded, and a session that
 * ends afterwards — its seat finished and closed — is no different from any session that ends with no attempt at
 * all, which health never shows. MEASURED on one attempt: six seats it reseated were closed once
 * their work was done, and each read red "Not running." and called the fleet down until a later attempt finished.
 * Repro: `grep <attempt-id> "$SLOPWEAVER_HOME/fleet/resume.jsonl"` beside `slopweaver cmux list`.
 */
function refusedOnlySeats({ evidence, held }: { evidence: FleetEvidence; held: Set<string> }): readonly FleetSeat[] {
  if (evidence.attempt === undefined) {
    return [];
  }
  const live = new Set(evidence.sessions.map((session) => session.sessionId));
  const liveRefs = new Set(evidence.sessions.map((session) => session.workspaceRef));
  const seats: FleetSeat[] = [];
  for (const phase of evidence.attempt.seats.values()) {
    if (phase.role === "supervisor" || phase.phase === "reseated" || seatIsLive({ live, liveRefs, phase })) {
      continue;
    }
    const seat = sessionlessSeat({ evidence, phase });
    if (heldAsLoop({ phase })) {
      held.add(seat.seatId);
    }
    seats.push(seat);
  }
  return seats;
}

/** One seat the attempt touched that has no live session: flashing while it is being brought back, else red. */
function sessionlessSeat({ evidence, phase }: { evidence: FleetEvidence; phase: FleetSeatPhase }): FleetSeat {
  const recovering = phase.phase === "recovering" && evidence.attemptRunning;
  const seat: FleetSeat = {
    colour: recovering ? "yellow" : "red",
    detail: refusedDetail({ evidence, fallback: "Not running.", phase }),
    flashing: recovering,
    priority: "unassigned",
    role: "worker",
    rowTitle: phase.workspaceRef,
    seatId: phase.workspaceRef,
  };
  if (phase.sessionId === undefined) {
    return seat;
  }
  return { ...seat, seatId: phase.sessionId, sessionId: phase.sessionId };
}

/**
 * Judge the fleet.
 *
 * @param evidence everything `fleet health` read
 * @returns the sessions page's document
 */
export function judgeFleet({ evidence }: { evidence: FleetEvidence }): FleetHealthDocument {
  const chair = chairSeat({ evidence });
  const held = new Set<string>();
  const live = evidence.sessions.filter((session) => session.sessionId !== evidence.chairSessionId);
  for (const session of live) {
    if (heldAsLoop({ phase: phaseFor({ attempt: evidence.attempt, session }) })) {
      held.add(session.sessionId);
    }
  }
  const workers = [
    ...live.map((session) => workerSeat({ evidence, session })),
    ...refusedOnlySeats({ evidence, held }),
  ].toSorted((left, right) => compareSeats({ left, right }));
  const occupied: FleetSeat[] = [
    chair,
    serviceSeat({ role: "loop", service: evidence.loop, title: "Slack loop" }),
    serviceSeat({ role: "keep-alive", service: evidence.keepAlive, title: "Credential keep-alive" }),
    ...workers,
  ];
  // Capacity counts sessions — the supervisor and the workers — so the two services pad nothing.
  const sessionSeats = [chair, ...workers];
  const free = Math.max(0, evidence.config.capacity - sessionSeats.length);
  const seats = [...occupied, ...emptySeats({ after: occupied.length, count: free })];
  const verdict = fleetHealthVerdict({
    accounts: evidence.accounts,
    attempt: evidence.attempt,
    attemptRunning: evidence.attemptRunning,
    cmux: evidence.cmux,
    consoleState: evidence.console.state,
    heldSeatIds: held,
    seats,
  });
  return {
    capacity: {
      configured: evidence.config.capacity,
      online: sessionSeats.filter((seat) => seat.colour === "green").length,
    },
    console: evidence.console,
    observedAtIso: evidence.nowIso,
    reason: verdict.reason,
    schemaVersion: 1,
    // A held seat is marked so the desktop never offers "Start recovery again" over it: recovery will not move it.
    seats: seats.map((seat) => (held.has(seat.seatId) ? { ...seat, held: true as const } : seat)),
    state: verdict.state,
    unmapped: verdict.unmapped,
    ...attemptFields({ attempt: evidence.attempt, attemptRunning: evidence.attemptRunning }),
  };
}
