/**
 * The host-neutral decisions `slopweaver cmux takeover` makes before anything moves: which predecessor holds the
 * supervisor seat, whether an app-hosted successor's sweep is armed, and which ledger row an app predecessor answers
 * to. Pure: the verb (`../cli/commands/cmux/takeover.ts`) reads cmux, the app and the files, and hands them here.
 *
 * ## cmux keeps its authority
 *
 * A cmux predecessor still comes from cmux's OWN live pin, never from the record alone, exactly as before the app
 * arm existed. The record is consulted for one new thing: an app session, which cmux cannot pin. So one cmux pin
 * beside an app record is two supervisors on two hosts, and refused rather than settled by precedence; no cmux pin
 * lets only an app record name the predecessor. One cmux pin beside an unreadable record resolves as it always did,
 * because the record never decided a cmux predecessor and the app pin itself refuses while cmux holds a pin
 * (`./appPin.ts`).
 */
import { err, ok, type Result } from "#lib/result.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { describeTranscriptLeg, SWEEP_ARM_TOOL_NAME, type TranscriptLeg } from "../cmux/takeover.js";
import type { AppSessionPicture } from "../sessionHarness/pictureWire.js";
import type { SessionItem } from "../sessions/session.js";
import { type AppSupervisorPinRecord, appHeldPin } from "../sessions/supervisorPin.js";
import type { SupervisorPinDisposition } from "../sessions/supervisorPinStore.js";
import { appPinLabel } from "./appPin.js";

/** The session taking the seat: a cmux workspace, or an app session the app has vouched for. */
export type TakeoverCaller =
  { readonly kind: "cmux"; readonly workspaceId: string } | { readonly kind: "app"; readonly appSessionId: string };

/** The predecessor, before an app one is resolved live: cmux's own pinned workspace, or the app record. */
export type TakeoverPredecessorChoice =
  | { readonly kind: "cmux"; readonly workspace: CmuxWorkspaceSummary }
  | { readonly kind: "app"; readonly pin: AppSupervisorPinRecord };

/** Why no predecessor can be taken over. */
export type TakeoverResolutionError =
  | { readonly code: "NO_PREDECESSOR"; readonly message: string }
  | { readonly code: "MULTIPLE_CMUX_PINS"; readonly message: string }
  | { readonly code: "CROSS_HOST_COLLISION"; readonly message: string }
  | { readonly code: "PREDECESSOR_IS_CALLER"; readonly message: string }
  | { readonly code: "PIN_RECORD_UNREADABLE"; readonly message: string }
  | { readonly code: "APP_PREDECESSOR_NOT_LIVE"; readonly message: string }
  | { readonly code: "APP_PREDECESSOR_ROW_UNMATCHED"; readonly message: string };

/** The one constructor per refusal, so every line names its case in the same words. */
export const TakeoverResolutionErrors = {
  appNotLive: ({ label, why }: { label: string; why: string }): TakeoverResolutionError => ({
    code: "APP_PREDECESSOR_NOT_LIVE",
    message: `the supervisor pin record names ${label}, but the desktop app could not resolve it — ${why}`,
  }),
  appRowUnmatched: ({ label, why }: { label: string; why: string }): TakeoverResolutionError => ({
    code: "APP_PREDECESSOR_ROW_UNMATCHED",
    message: `${label} answers to no single ledger row (${why}), so its run cannot be confirmed finished — confirm by hand before closing it`,
  }),
  crossHost: ({ appLabel, workspaceRef }: { appLabel: string; workspaceRef: string }): TakeoverResolutionError => ({
    code: "CROSS_HOST_COLLISION",
    message:
      `cmux has ${workspaceRef} pinned while the supervisor pin record names ${appLabel} — two supervisors on two ` +
      "hosts; resolve the collision by hand first",
  }),
  isCaller: ({ label, host }: { label: string; host: TakeoverCaller["kind"] }): TakeoverResolutionError => ({
    code: "PREDECESSOR_IS_CALLER",
    message: `${label} is already this session's own ${host === "cmux" ? "workspace" : "app session"} — nothing to take over`,
  }),
  multiple: ({ workspaceRefs }: { workspaceRefs: readonly string[] }): TakeoverResolutionError => ({
    code: "MULTIPLE_CMUX_PINS",
    message:
      `${String(workspaceRefs.length)} workspaces are pinned (${workspaceRefs.join(", ")}) ` +
      "— a fleet with two pinned workspaces already breaks the supervisor check; resolve the collision by hand first",
  }),
  none: (): TakeoverResolutionError => ({
    code: "NO_PREDECESSOR",
    message: "no workspace is currently pinned — there is no predecessor to take over from",
  }),
  unreadable: ({ why }: { why: string }): TakeoverResolutionError => ({
    code: "PIN_RECORD_UNREADABLE",
    message:
      `no workspace is pinned in cmux and the supervisor pin record is unreadable (${why}), so whether an app ` +
      "session holds the seat cannot be told — repair or remove the record by hand first",
  }),
} as const;

/**
 * Resolve which predecessor to take over from, keeping cmux's own pin the authority for a cmux one.
 *
 * @param workspaces every live cmux workspace, with cmux's own `pinned` flags
 * @param disposition the supervisor pin record, read strictly
 * @param caller the session taking the seat, so a seat it already holds refuses
 * @returns the predecessor, or the refusal naming why there is none to take over
 */
export function resolveTakeoverPredecessor({
  workspaces,
  disposition,
  caller,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  disposition: SupervisorPinDisposition;
  caller: TakeoverCaller;
}): Result<TakeoverPredecessorChoice, TakeoverResolutionError> {
  const pinned = workspaces.filter((workspace) => workspace.pinned);
  if (pinned.length > 1) {
    return err(TakeoverResolutionErrors.multiple({ workspaceRefs: pinned.map((workspace) => workspace.workspaceRef) }));
  }
  const recordedApp = disposition.kind === "pin" ? appHeldPin({ pin: disposition.record }) : undefined;
  const cmuxPinned = pinned[0];
  if (cmuxPinned !== undefined) {
    if (recordedApp !== undefined) {
      const appLabel = appPinLabel({ appSessionId: recordedApp.appSessionId });
      return err(TakeoverResolutionErrors.crossHost({ appLabel, workspaceRef: cmuxPinned.workspaceRef }));
    }
    if (caller.kind === "cmux" && cmuxPinned.workspaceId === caller.workspaceId) {
      return err(TakeoverResolutionErrors.isCaller({ host: "cmux", label: cmuxPinned.workspaceRef }));
    }
    return ok({ kind: "cmux", workspace: cmuxPinned });
  }
  if (disposition.kind === "unreadable") {
    return err(TakeoverResolutionErrors.unreadable({ why: disposition.why }));
  }
  if (recordedApp === undefined) {
    return err(TakeoverResolutionErrors.none());
  }
  if (caller.kind === "app" && recordedApp.appSessionId === caller.appSessionId) {
    return err(
      TakeoverResolutionErrors.isCaller({ host: "app", label: appPinLabel({ appSessionId: caller.appSessionId }) }),
    );
  }
  return ok({ kind: "app", pin: recordedApp });
}

/** What an app-hosted caller's own picture says about its sweep. */
export type AppSweepLeg =
  | { readonly kind: "witnessed"; readonly where: "in flight" | "completed" }
  /** Not in the picture. Never a negative over the session's life: the picture keeps only the newest ended calls. */
  | { readonly kind: "not-seen"; readonly why: string }
  /** The picture could not be read, or names a different session than the one the app vouched for. */
  | { readonly kind: "unread"; readonly why: string };

/**
 * Whether the caller's own app picture shows it called the sweep-arming tool.
 *
 * @param picture the picture the app answered for the caller's own handle
 * @param appSessionId the app session the app vouched this process runs in
 * @returns witnessed with where it was seen, not-seen with why that proves nothing, or unread when the picture is
 * another session's
 */
export function appSweepLeg({
  picture,
  appSessionId,
}: {
  picture: AppSessionPicture;
  appSessionId: string;
}): AppSweepLeg {
  if (picture.session.sessionId !== appSessionId) {
    return { kind: "unread", why: `the picture names app:${picture.session.sessionId}, not this session` };
  }
  const { facts } = picture;
  if (facts.inFlight.some((fact) => fact.name === SWEEP_ARM_TOOL_NAME)) {
    return { kind: "witnessed", where: "in flight" };
  }
  if (facts.lastCompleted.some((fact) => fact.name === SWEEP_ARM_TOOL_NAME)) {
    return { kind: "witnessed", where: "completed" };
  }
  const dropped =
    facts.droppedActivityEvents > 0 ? `, and ${String(facts.droppedActivityEvents)} activity report(s) dropped` : "";
  return {
    kind: "not-seen",
    why:
      `no ${SWEEP_ARM_TOOL_NAME} among ${String(facts.inFlight.length)} call(s) in flight and the last ` +
      `${String(facts.lastCompleted.length)} ended${dropped}; the picture keeps only the newest ended calls`,
  };
}

/** The app caller's gate (a) verdict: the witness that decided it, or the refusal naming both legs. */
export type AppSweepGateOutcome =
  { readonly armed: true; readonly witness: string } | { readonly armed: false; readonly refusal: string };

/** The picture leg in words, for the step line and the refusal. */
function describeAppSweepLeg({ leg }: { leg: AppSweepLeg }): string {
  switch (leg.kind) {
    case "witnessed":
      return `${SWEEP_ARM_TOOL_NAME} ${leg.where} in the app's picture`;
    case "not-seen":
      return leg.why;
    case "unread":
      return `not read: ${leg.why}`;
  }
}

/**
 * Fold an app caller's two legs: its app picture first, then its transcript, which is read only when the picture
 * did not witness. Either witness passes; neither refuses, naming both.
 *
 * @param picture the picture leg
 * @param transcript the transcript leg, absent only beside a witnessing picture
 * @returns the verdict
 */
export function appSweepGateOutcome({
  picture,
  transcript,
}: {
  picture: AppSweepLeg;
  transcript: TranscriptLeg | undefined;
}): AppSweepGateOutcome {
  const pictureText = describeAppSweepLeg({ leg: picture });
  const transcriptText =
    transcript === undefined ? "not read, the app's picture decided" : describeTranscriptLeg({ leg: transcript });
  if (picture.kind === "witnessed") {
    return { armed: true, witness: `${pictureText}; transcript: ${transcriptText}` };
  }
  if (transcript?.kind === "witnessed") {
    return { armed: true, witness: `${transcriptText}; app picture: ${pictureText}` };
  }
  return {
    armed: false,
    refusal:
      `neither this session's app picture nor its transcript shows a ${SWEEP_ARM_TOOL_NAME} call yet — arm the § 7 ` +
      `sweep before taking over the pin — app picture: ${pictureText}; transcript: ${transcriptText}`,
  };
}

/**
 * The ONE open ledger row an app predecessor answers to: matched by its exact app session id, hosted by the app,
 * and recorded in the directory the app reports the session in now. Step 5's close names that id and the row's
 * spawn instant, so exactly one open row carrying the id is what keeps the close from reaching a sibling.
 *
 * @param rows the folded session ledger, any status
 * @param appSessionId the predecessor's app session id
 * @param directory the predecessor's working directory as the app resolved it live
 * @param canonicalDir resolves a directory to one spelling, so a symlinked root still matches
 * @returns the row, or why no single row answers
 */
export function appPredecessorLedgerRow({
  rows,
  appSessionId,
  directory,
  canonicalDir,
}: {
  rows: readonly SessionItem[];
  appSessionId: string;
  directory: string;
  canonicalDir: (input: { dir: string }) => string;
}): Result<SessionItem & { readonly sessionId: string }, TakeoverResolutionError> {
  const label = appPinLabel({ appSessionId });
  const open = rows.filter((row) => row.status === "open" && row.sessionId === appSessionId);
  if (open.some((row) => row.harness !== "app")) {
    return err(
      TakeoverResolutionErrors.appRowUnmatched({ label, why: "an open row carries its id under another host" }),
    );
  }
  const row = open[0];
  if (row === undefined || open.length > 1) {
    return err(
      TakeoverResolutionErrors.appRowUnmatched({ label, why: `${String(open.length)} open rows carry its id` }),
    );
  }
  if (row.cwd === undefined || canonicalDir({ dir: row.cwd }) !== canonicalDir({ dir: directory })) {
    return err(
      TakeoverResolutionErrors.appRowUnmatched({
        label,
        why: `its row was recorded in another directory than the app reports it in now (${directory})`,
      }),
    );
  }
  return ok({ ...row, sessionId: appSessionId });
}
