/**
 * The supervisor saying it is caught up: `slopweaver supervisor reoriented`, run BY the chair once it has read the
 * picture back in (`skills/supervisor/reference/reboot.md` § Reoriented). It is the only writer of the line that
 * turns the chair green on the sessions page, and the only thing `fleet resume` waits on before any other seat.
 *
 * The check is a correlation, not an authentication: the session id comes from the caller's own environment, which
 * a process can set. What it buys is that the recovery pass and a merely-running chair cannot produce the line, so
 * a process existing is never mistaken for a supervisor that knows where the fleet stands.
 */
import { err, ok, type Result } from "#lib/result.js";

import { isRegisteredSupervisor, type SupervisorPinRecord } from "../sessions/supervisorPin.js";
import { supervisorSessionLabel } from "../supervisor/session.js";
import { type FleetError, FleetErrors } from "./errors.js";
import { type FleetAttemptFold, type FleetJournalEvent, STANDALONE_REORIENTATION } from "./journal.js";

/**
 * How long a supervisor gets to say it is caught up: the recovery pass's own wait for the line, and how long health
 * lets a running chair that has not said it stay yellow before it reads red — so a chair that restarted outside any
 * pass is nudged by one rather than settling forever.
 */
export const REORIENT_SECONDS = 600;

/** What `supervisor reoriented` will append, or that it already has. */
export interface ReorientationDecision {
  readonly attemptId: string;
  /** True when this attempt already holds this session's line, so nothing is appended twice. */
  readonly already: boolean;
}

/**
 * The caller's session, once it is the pinned chair's.
 *
 * @param pin the supervisor pin, when one is recorded
 * @param sessionId the caller's own Claude session id, from its environment
 * @returns the chair's session id, or why the caller is not the chair
 */
function chairSession({
  pin,
  sessionId,
}: {
  pin: SupervisorPinRecord | undefined;
  sessionId: string | undefined;
}): Result<string, FleetError> {
  if (pin === undefined) {
    return err(
      FleetErrors.reorientationRefused({ why: "no supervisor pin is recorded, so there is no chair to vouch for" }),
    );
  }
  if (sessionId === undefined) {
    return err(
      FleetErrors.reorientationRefused({
        why: "CLAUDE_CODE_SESSION_ID is not set — run this from inside the supervisor's own session",
      }),
    );
  }
  if (!isRegisteredSupervisor({ record: pin, session: { host: "claude-code", id: sessionId } })) {
    return err(
      FleetErrors.reorientationRefused({
        why: `session ${sessionId} is not the supervisor the pin names (${supervisorSessionLabel({ session: pin.session })})`,
      }),
    );
  }
  return ok(sessionId);
}

/**
 * Answer a caller that named its attempt: only the newest one, and only while it awaits this session.
 *
 * @param requested the attempt id the caller named
 * @param attempt the newest recovery attempt, folded
 * @param awaitingThis the newest attempt is running and awaiting this session
 * @param alreadyThis the newest attempt already holds this session's line
 * @returns the decision, or why it is refused
 */
function decideRequested({
  requested,
  attempt,
  awaitingThis,
  alreadyThis,
}: {
  requested: string;
  attempt: FleetAttemptFold | undefined;
  awaitingThis: boolean;
  alreadyThis: boolean;
}): Result<ReorientationDecision, FleetError> {
  if (attempt === undefined || attempt.attemptId !== requested) {
    return err(FleetErrors.reorientationRefused({ why: `attempt ${requested} is not the newest recovery attempt` }));
  }
  if (alreadyThis) {
    return ok({ already: true, attemptId: requested });
  }
  if (!awaitingThis) {
    return err(FleetErrors.reorientationRefused({ why: `attempt ${requested} is not waiting on this session` }));
  }
  return ok({ already: false, attemptId: requested });
}

/**
 * Decide whether the caller may say the chair is caught up, and against which attempt.
 *
 * With `--attempt` the attempt must be the newest one and awaiting exactly this session. Without it, an attempt
 * awaiting this session is answered anyway — the chair may reorient before it reads the nudge — and with none
 * awaiting the line is standalone: the chair caught up after a restart no recovery pass ran.
 *
 * @param pin the supervisor pin, when one is recorded
 * @param sessionId the caller's own Claude session id, from its environment
 * @param attempt the newest recovery attempt, folded
 * @param requested the attempt id the caller named, when it named one
 * @returns the decision, or why it is refused
 */
export function decideReorientation({
  pin,
  sessionId,
  attempt,
  requested,
}: {
  pin: SupervisorPinRecord | undefined;
  sessionId: string | undefined;
  attempt: FleetAttemptFold | undefined;
  requested: string | undefined;
}): Result<ReorientationDecision, FleetError> {
  const chair = chairSession({ pin, sessionId });
  if (chair.isErr()) {
    return err(chair.error);
  }
  const awaitingThis =
    attempt !== undefined &&
    attempt.finished === undefined &&
    attempt.chair.kind === "awaiting" &&
    attempt.chair.chairSessionId === sessionId;
  const alreadyThis = attempt?.chair.kind === "reoriented" && attempt.chair.chairSessionId === sessionId;
  if (requested !== undefined) {
    return decideRequested({ alreadyThis, attempt, awaitingThis, requested });
  }
  if (awaitingThis) {
    return ok({ already: false, attemptId: attempt.attemptId });
  }
  return ok({ already: false, attemptId: STANDALONE_REORIENTATION });
}

/**
 * The line a decision appends.
 *
 * @param decision what {@link decideReorientation} returned
 * @param sessionId the chair's session id
 * @param atIso the instant to stamp
 * @returns the journal event
 */
export function reorientationEvent({
  decision,
  sessionId,
  atIso,
}: {
  decision: ReorientationDecision;
  sessionId: string;
  atIso: string;
}): FleetJournalEvent {
  return {
    atIso,
    attemptId: decision.attemptId,
    chairSessionId: sessionId,
    kind: "chair-reoriented",
    schemaVersion: 1,
  };
}
