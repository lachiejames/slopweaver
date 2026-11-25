/**
 * Whether a spawn continues an app session it opened before, and on what — decided BEFORE a Codex seat is routed.
 *
 * Two facts the run journal cannot give. First, WHICH act: an open app ledger row for the slug is the strongest
 * continuity evidence there is, and it exists even when the run journal never reached `started` (a pickup delivered
 * whose `handover start` never ran), so the row selects `resume` whatever phase the journal reads
 * ({@link launchActForSpawn}); the pickup LINE stays journal-driven (`../cmux/pickupCommand.ts`), so such a seat is
 * resumed on its own transcript and still sent `handover start`. Second, ON WHAT: the app refuses a resume whose routed
 * login differs from the one the session opened on (`desktop/src/sessionResume.ts`), and the session ledger records no
 * `$CODEX_HOME`, so the spawn asks the app what its recovery journal recorded ({@link inspectRecordedLaunch}) and the
 * Codex seat decision keeps that home rather than routing the plan afresh (`../codex/seatDecision.ts`).
 */
import { err, ok, type Result } from "#lib/result.js";

import { foldSessions, parseSessionLog } from "../sessions/session.js";
import { openAppSessionForSlug } from "../sessions/sessionRow.js";
import { readSessionLogText } from "../sessions/sessionStore.js";
import type { AppLaunchSpec } from "./appProtocol.js";
import type { AppTransport } from "./appSocketTransport.js";
import { type HarnessLaunchOperation, SessionHarnessErrors, type SessionLaunchFailedError } from "./errors.js";
import type { HarnessName } from "./harnessChoice.js";

/** An inspection reads one journal: one bounded answer, no worker started. */
const INSPECT_TIMEOUT_MS = 60_000;

/**
 * What a spawn does about the app session its slug's open ledger row records.
 *
 * `none`: no open app row, so the journal's act decides and a new card opens. `resume`: continue `sessionId` on the
 * login it opened on. `fresh`: the row stands, but the plan it opened on cannot take the seat now, so a NEW session
 * opens on a newly routed plan — `previousSessionId`'s transcript does not continue, and its ledger row is left open,
 * because a plan being unavailable proves nothing about whether that session or transcript is gone.
 */
export type AppContinuationPlan =
  | { readonly kind: "none" }
  | { readonly kind: "resume"; readonly sessionId: string }
  | {
      readonly kind: "fresh";
      readonly previousSessionId: string;
      /** The `$CODEX_HOME` the previous session opened on. */
      readonly previousCodexHome: string;
      readonly reason: string;
    };

/**
 * The app session a spawn continues, from the ledger: the newest OPEN app row keyed by the slug
 * (`../sessions/sessionRow.ts`'s `openAppSessionForSlug`, whose rule this keeps: ledger order, newest first, and a
 * newest row with no id names nothing even when an older row behind it has one). An unreadable line is skipped like
 * every other ledger reader skips one.
 *
 * @param home the state home the ledger lives under, or undefined for the environment's own
 * @param slug the handover slug the spawn is for
 * @returns the app's own id for the session, or undefined when the slug holds no open app row
 */
export function continuedAppSession({ home, slug }: { home: string | undefined; slug: string }): string | undefined {
  const text = readSessionLogText(home === undefined ? {} : { home });
  return openAppSessionForSlug({ items: foldSessions({ events: parseSessionLog({ text }).events }), slug });
}

/**
 * Which launch act a spawn calls: `resume` for an app spawn continuing an exact open app session, whatever phase the
 * run journal reads; otherwise the journal's own act. A cmux spawn never reads an app row.
 *
 * @param harness where the session opens
 * @param journalOperation the act the run journal's phase picks (`../cmux/pickupCommand.ts`'s `launchOperationForRun`)
 * @param continuingSessionId the app session this spawn continues, when the continuation plan resumes one
 * @returns the act to call on the launcher
 */
export function launchActForSpawn({
  harness,
  journalOperation,
  continuingSessionId,
}: {
  harness: HarnessName;
  journalOperation: HarnessLaunchOperation;
  continuingSessionId: string | undefined;
}): HarnessLaunchOperation {
  if (harness === "app" && continuingSessionId !== undefined) {
    return "resume";
  }
  return journalOperation;
}

/**
 * The session a continuation plan resumes, or undefined when it opens a new one.
 *
 * @param continuation the spawn's continuation plan
 * @returns the app session id a `launch.resume` names
 */
export function continuingSessionOf({ continuation }: { continuation: AppContinuationPlan }): string | undefined {
  if (continuation.kind === "resume") {
    return continuation.sessionId;
  }
  return undefined;
}

/**
 * The launch the app's recovery journal recorded for an exact session, asked BEFORE routing. Every failure here — the
 * app unreachable, its refusal (no such session, stopped, hosted, a torn journal), or an answer of the wrong shape —
 * is a launch failure the spawn stops on, never a reason to open fresh: only a recorded plan that cannot take the
 * seat now takes the announced fresh branch.
 *
 * @param transport the request channel to the app
 * @param sessionId the app's own id for the session the open ledger row records
 * @returns the recorded launch spec, or the launch failure naming why it could not be read
 */
export async function inspectRecordedLaunch({
  transport,
  sessionId,
}: {
  transport: AppTransport;
  sessionId: string;
}): Promise<Result<AppLaunchSpec, SessionLaunchFailedError>> {
  const failed = ({ why }: { why: string }): SessionLaunchFailedError =>
    SessionHarnessErrors.launchFailed({
      message: `app harness: could not read the launch app session ${sessionId} was opened with, so it is not resumed — ${why}`,
      opened: undefined,
      operation: "resume",
    });
  const answered = await transport({ request: { kind: "launch.inspect", sessionId }, timeoutMs: INSPECT_TIMEOUT_MS });
  if (answered.isErr()) {
    return err(failed({ why: answered.error.message }));
  }
  const response = answered.value;
  if (response.kind !== "launch-spec") {
    return err(failed({ why: `the app answered launch.inspect with ${response.kind}` }));
  }
  if (response.sessionId !== sessionId) {
    return err(failed({ why: `the app answered launch.inspect with session ${response.sessionId}` }));
  }
  return ok(response.spec);
}
