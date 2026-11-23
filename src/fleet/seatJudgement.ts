/**
 * What every seat is judged by, worker and supervisor alike: the wait a yellow seat is given, the credential wall a
 * restart leaves, and what the newest recovery attempt said about it. Shared by `./judge.ts` and `./chairSeat.ts`.
 *
 * Pure: evidence in, words and booleans out.
 */
import type { FleetBoot, FleetEvidence, FleetLiveSession } from "./evidence.js";
import type { FleetAttemptFold, FleetSeatPhase } from "./journal.js";
import { mapFleetRefusal } from "./refusals.js";
import { REORIENT_SECONDS } from "./reorientation.js";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** The pass's own wait for a chair, in whole minutes, as the words name it. */
export const REORIENT_MINUTES = String(REORIENT_SECONDS / SECONDS_PER_MINUTE);

/** A seat whose plan stayed unreadable past the wait. */
export const UNREADABLE_PLAN_LONG = `Running, but which plan it is on has not been readable in the ${REORIENT_MINUTES} minutes since it started.`;

/**
 * Whether a yellow that should have settled by now never did: the session has outlived the pass's own wait for the
 * chair, and no pass is running. Past it a seat reads red, so the fleet reads down and something moves — a yellow
 * that never resolves was a fleet settling forever with no launch and no button.
 * A start later than now is past it too: a record that claims a future start would otherwise never age out.
 *
 * @param fromMs the instant the wait is counted from, epoch milliseconds
 * @returns true when the seat should no longer read yellow
 */
export function pastReorientWait({ evidence, fromMs }: { evidence: FleetEvidence; fromMs: number }): boolean {
  const ageMs = Date.parse(evidence.nowIso) - fromMs;
  return !evidence.attemptRunning && (ageMs < 0 || ageMs > REORIENT_SECONDS * MS_PER_SECOND);
}

/**
 * Why a live session's credential walls it.
 *
 * @param signedOutStores the plan stores whose own login is signed out
 * @returns the words for the wall, or `undefined` when the credential can answer
 */
export function bootWall({
  boot,
  signedOutStores,
}: {
  boot: FleetBoot;
  signedOutStores: ReadonlySet<string>;
}): string | undefined {
  if (boot.kind === "off-plan") {
    return "It came back on the default login, which no plan names — the wall a restart leaves.";
  }
  if (boot.kind === "store" && signedOutStores.has(boot.alias)) {
    return `It came back on ${boot.alias}'s own login, which is signed out.`;
  }
  return undefined;
}

/**
 * A seat the newest attempt is acting on right now.
 *
 * @param running whether the attempt's process is still alive
 * @returns true while the attempt is recovering this seat
 */
export function inFlight({ phase, running }: { phase: FleetSeatPhase | undefined; running: boolean }): boolean {
  return running && phase?.phase === "recovering";
}

/**
 * The newest attempt's phase for a session: by its session id, else by its workspace.
 *
 * @returns the phase, or `undefined` when the attempt never touched this session
 */
export function phaseFor({
  attempt,
  session,
}: {
  attempt: FleetAttemptFold | undefined;
  session: FleetLiveSession;
}): FleetSeatPhase | undefined {
  if (attempt === undefined) {
    return undefined;
  }
  for (const phase of attempt.seats.values()) {
    if (phase.sessionId === session.sessionId) {
      return phase;
    }
  }
  return session.workspaceRef === undefined ? undefined : attempt.seats.get(session.workspaceRef);
}

/**
 * A red seat's detail: what recovery last said about it, else why it reads red.
 *
 * @param fallback the words for why it reads red, when recovery refused nothing
 * @returns the detail the page shows
 */
export function refusedDetail({
  evidence,
  phase,
  fallback,
}: {
  evidence: FleetEvidence;
  phase: FleetSeatPhase | undefined;
  fallback: string;
}): string {
  if (phase?.refusal === undefined) {
    return fallback;
  }
  return mapFleetRefusal({ accounts: evidence.accounts, refusal: phase.refusal }).headline;
}
