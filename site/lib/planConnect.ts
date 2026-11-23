/**
 * What Settings → Models says about a Connect: the live row's step, each failure in plain words, and whether the row
 * should keep polling. Pure, so every failure code is worded here once and a new one fails to compile until it is.
 *
 * Setting up a plan never touches a terminal, so no sentence here names a command to run. A failure
 * the owner can fix says what to do in the app or the browser; one they cannot says what happened and offers Try again.
 */

import type { ConnectionFailure, ConnectionPhase, PlanConnectionView } from "../components/live/readPlanConnections";

/** Each failure, said the way the live row says it. */
export const CONNECTION_FAILURE_WORDS: Readonly<Record<ConnectionFailure, string>> = {
  ACCOUNT_UNKNOWN:
    "You signed in, but Codex didn't say which account it was, so it couldn't be checked against your other plans.",
  BROWSER_FAILED: "The sign-in page couldn't be opened in your browser.",
  CLI_MISSING: "Codex isn't installed on this Mac, so there's nothing to sign in with yet.",
  DUPLICATE_ACCOUNT: "That account is already connected, so it would add nothing. Sign in with a different account.",
  EXITED: "Codex stopped answering partway through the sign-in.",
  INTERRUPTED: "The sign-in stopped before it finished, most likely because the app restarted.",
  REGISTER_FAILED: "You signed in, but the plan couldn't be saved.",
  SIGN_IN_FAILED: "The sign-in didn't go through.",
  START_REFUSED: "Codex wouldn't start a sign-in. Another one may already be open; finish or close it, then try again.",
  TIMED_OUT: "The sign-in page was left unfinished, so this attempt gave up.",
  URL_REFUSED: "Codex offered a sign-in page that isn't OpenAI's own, so it was never opened.",
};

/** Each phase, said the way the live row says it. A failed attempt says its failure instead. */
export const CONNECTION_PHASE_WORDS: Readonly<Record<ConnectionPhase, string>> = {
  browser: "Waiting for you to sign in, in your browser.",
  cancelled: "Sign-in cancelled.",
  connected: "Connected.",
  failed: "The sign-in didn't finish.",
  starting: "Starting the sign-in…",
};

/** How often the tab re-reads an attempt still in flight: often enough that signing in shows at once. */
export const CONNECTION_POLL_MS = 2000;

/**
 * Whether an attempt is still in flight — what Cancel is drawn for and what keeps the tab polling.
 *
 * @returns true while the attempt is starting or waiting in the browser
 */
export function connectionActiveOf({ connection }: { connection: PlanConnectionView | undefined }): boolean {
  if (connection === undefined) {
    return false;
  }
  return connection.phase === "starting" || connection.phase === "browser";
}

/**
 * The live row's sentence for one attempt.
 *
 * @returns the step, the failure in plain words, or the connected account
 */
export function connectionLineOf({ connection }: { connection: PlanConnectionView }): string {
  if (connection.failure !== undefined) {
    return CONNECTION_FAILURE_WORDS[connection.failure];
  }
  if (connection.phase === "connected" && connection.email !== undefined) {
    return `Connected ${connection.email}.`;
  }
  return CONNECTION_PHASE_WORDS[connection.phase];
}

/**
 * The key a finished attempt is remembered by, so the tab re-reads the plan list once per attempt that connected,
 * never on every poll.
 *
 * @returns `<id>:<phase>`, or empty when there is no attempt
 */
export function connectionMarkOf({ connection }: { connection: PlanConnectionView | undefined }): string {
  if (connection === undefined) {
    return "";
  }
  return `${connection.id}:${connection.phase}`;
}
