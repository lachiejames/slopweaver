/**
 * Whether a session the desktop app hosts may record itself as the supervisor — the pure half of `cmux pin` run from
 * inside the app (`../cli/commands/cmux/pin.ts`).
 *
 * An app chair has no cmux workspace, so nothing is pinned in cmux: the pin record and the chain are the whole act.
 * That makes the collision check this module's job rather than cmux's. It keeps cmux's own rule — one supervisor —
 * across both hosts: a pinned cmux workspace, or a record naming a different app session, refuses rather than being
 * overwritten by precedence. A record that will not read refuses too, because it could be either arm. Re-pinning the
 * session already recorded is a no-op success.
 *
 * Only the caller's own origin-verified app session is ever recorded; this module is handed that id and never a
 * second one, so no caller can pin an arbitrary `app:<id>`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { APP_SESSION_HANDLE_PREFIX } from "../sessionHarness/appProtocol.js";
import { appHeldPin, supervisorPinLabel } from "../sessions/supervisorPin.js";
import type { SupervisorPinDisposition } from "../sessions/supervisorPinStore.js";

/** cmux already has a pinned workspace, so the app session would be a second supervisor. */
export interface AppPinCmuxHeldError {
  readonly code: "CMUX_PIN_HELD";
  readonly message: string;
}

/** The record names a different supervisor, so writing this one would replace it by precedence. */
export interface AppPinOtherRecordedError {
  readonly code: "OTHER_PIN_RECORDED";
  readonly message: string;
}

/** The record is there and will not read, so whose it is cannot be said. */
export interface AppPinRecordUnreadableError {
  readonly code: "PIN_RECORD_UNREADABLE";
  readonly message: string;
}

/** Why an app-hosted caller may not record itself as the supervisor. */
export type AppPinError = AppPinCmuxHeldError | AppPinOtherRecordedError | AppPinRecordUnreadableError;

/** Each {@link AppPinError}, built with its message. */
export const AppPinErrors = {
  cmuxHeld: ({ workspaceRefs }: { workspaceRefs: readonly string[] }): AppPinCmuxHeldError => ({
    code: "CMUX_PIN_HELD",
    message: `cmux already has ${workspaceRefs.join(", ")} pinned as the supervisor, so this app session would be a second one — take over with \`slopweaver cmux takeover\` instead`,
  }),
  otherRecorded: ({ label }: { label: string }): AppPinOtherRecordedError => ({
    code: "OTHER_PIN_RECORDED",
    message: `the supervisor pin already names ${label}, so recording this app session would replace it by precedence — take over with \`slopweaver cmux takeover\` instead`,
  }),
  unreadable: ({ why }: { why: string }): AppPinRecordUnreadableError => ({
    code: "PIN_RECORD_UNREADABLE",
    message: `${why}, and it could name either a cmux workspace or an app session, so it is not overwritten`,
  }),
} as const;

/** What recording the caller's app session comes to, when it is allowed. */
export type AppPinPlan = "record" | "already-recorded";

/**
 * Decide whether the caller's own app session may be recorded as the supervisor.
 *
 * @param appSessionId the caller's own app session id, already vouched for by the app (`verifyAppSessionOrigin`)
 * @param pinnedWorkspaceRefs the refs of every cmux workspace cmux reports pinned, from one live listing
 * @param disposition the pin record, read strictly so an unreadable one is not taken for absence
 * @returns `record` to write it, `already-recorded` for an idempotent re-pin, or why it is refused
 */
export function appPinPlan({
  appSessionId,
  pinnedWorkspaceRefs,
  disposition,
}: {
  appSessionId: string;
  pinnedWorkspaceRefs: readonly string[];
  disposition: SupervisorPinDisposition;
}): Result<AppPinPlan, AppPinError> {
  if (pinnedWorkspaceRefs.length > 0) {
    return err(AppPinErrors.cmuxHeld({ workspaceRefs: pinnedWorkspaceRefs }));
  }
  if (disposition.kind === "unreadable") {
    return err(AppPinErrors.unreadable({ why: disposition.why }));
  }
  if (disposition.kind === "absent") {
    return ok("record");
  }
  const app = appHeldPin({ pin: disposition.record });
  if (app?.appSessionId === appSessionId) {
    return ok("already-recorded");
  }
  return err(AppPinErrors.otherRecorded({ label: supervisorPinLabel({ pin: disposition.record }) }));
}

/**
 * The label `cmux pin` prints for an app session it recorded.
 *
 * @returns `app:<id>`, the handle the session harness addresses it by
 */
export function appPinLabel({ appSessionId }: { appSessionId: string }): string {
  return `${APP_SESSION_HANDLE_PREFIX}${appSessionId}`;
}
