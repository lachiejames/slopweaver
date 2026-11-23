/**
 * Who owns what a starting listener captures — a visible supervisor session, the one durable capture-only
 * shape (`--follow --queue`), or nobody, in which case it refuses before the socket opens. Split out of
 * `./runLoop.ts`, which asks this question once in `startListening` before anything is announced or wired.
 */
import { logger } from "../../../lib/logger.js";
import {
  type SupervisorSession,
  type SupervisorSessionDetection,
  supervisorSessionProblem,
} from "../../../supervisor/session.js";
import { EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";

/** Whether this listener may open, and whether a visible session owns the eventual answer. */
export type ListenerOwnership =
  | { readonly kind: "supervised"; readonly session: SupervisorSession }
  | { readonly kind: "capture-only"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * Admit an active session, or the one durable capture-only shape AGENTS.md explicitly permits.
 *
 * @param detection the visible-supervisor detector result
 * @param follow whether the listener stays connected
 * @param queuePath the durable JSONL destination, when supplied
 * @returns the owned, capture-only, or refused mode
 */
export function listenerOwnership({
  detection,
  follow,
  queuePath,
}: {
  detection: SupervisorSessionDetection;
  follow: boolean;
  queuePath: string | undefined;
}): ListenerOwnership {
  if (detection.kind === "active") {
    return { kind: "supervised", session: detection.session };
  }
  const reason = supervisorSessionProblem({ detection });
  return detection.kind === "missing" && follow && queuePath !== undefined
    ? { kind: "capture-only", reason }
    : { kind: "refuse", reason };
}

/**
 * Say why a listener with no visible owner will not open, and exit as a prerequisite absent.
 *
 * @param reason the detector's own account of why no visible supervisor owns this listener
 * @returns the expected-empty exit code
 */
export function refuseUnownedListener({ reason }: { reason: string }): number {
  logger.error({
    msg:
      `listen: ${reason} A one-shot or non-durable listener needs one unambiguous visible ` +
      "supervisor; only `--follow --queue <path>` may capture without one.",
  });
  return EXIT_EXPECTED_EMPTY;
}
