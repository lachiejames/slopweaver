/**
 * Why `cmux reseat` did not relaunch a workspace: one discriminated union and its factory, for the planner in
 * `./reseat.ts` and the effects in `../cli/commands/cmux/reseatPass.ts`.
 */
import type { SpawnRefusalKind } from "../claude/spawnStore.js";
import { FABLE_OVERRIDE_ENV } from "../cmux/modelPin.js";

/** The caller's own workspace: stopping its `claude` would take the verb's own parent down. */
export interface ReseatOwnWorkspaceError {
  readonly code: "OWN_WORKSPACE";
  readonly message: string;
}
/** No live Claude session runs in the workspace, so there is nothing to resume. */
export interface ReseatNoLiveSessionError {
  readonly code: "NO_LIVE_SESSION";
  readonly message: string;
}
/** The workspace is a bare shell, and no saved session for it can be resumed: its transcript is not on disk. */
export interface ReseatNoResumableSessionError {
  readonly code: "NO_RESUMABLE_SESSION";
  readonly message: string;
  readonly sessionId: string;
}
/** A cold resume found the workspace no longer a bare shell, so nothing was typed into it. */
export interface ReseatNotColdError {
  readonly code: "NOT_COLD";
  readonly message: string;
}
/** A live relaunch stopped the old `claude`, and the tab did not come back to a bare shell, so nothing was typed. */
export interface ReseatNotAtPromptError {
  readonly code: "NOT_AT_PROMPT";
  readonly message: string;
  readonly pid: number;
}
/** More than one live Claude session runs in the workspace, so which one to resume is not knowable. */
export interface ReseatAmbiguousSessionError {
  readonly code: "AMBIGUOUS_SESSION";
  readonly message: string;
  readonly sessionIds: readonly string[];
}
/** The session id is not a UUID, so it cannot go on a shell line unquoted. */
export interface ReseatUnsafeSessionIdError {
  readonly code: "UNSAFE_SESSION_ID";
  readonly message: string;
}
/** Nothing names the model the seat runs, and a relaunch never boots onto the saved default. */
export interface ReseatNoModelError {
  readonly code: "NO_MODEL";
  readonly message: string;
}
/** `--model fable` on a worker without the override `cmux spawn` asks for. */
export interface ReseatModelRefusedError {
  readonly code: "MODEL_REFUSED";
  readonly message: string;
}
/** The session is mid-turn behind no wall: the kill would discard the turn. */
export interface ReseatBusyError {
  readonly code: "BUSY";
  readonly message: string;
}
/** cmux could not answer for the workspace — its inventory, process tree or screen. */
export interface ReseatCmuxReadError {
  readonly code: "CMUX_READ_FAILED";
  readonly message: string;
}
/** Which gate refused a boot: one of the routing gate's own kinds, or `token` for the plan's setup-token file. */
export type ReseatStoreRefusalKind = SpawnRefusalKind | "token";

/** The routing gate or the plan's token file refused the boot. */
export interface ReseatStoreRefusedError {
  readonly code: "STORE_REFUSED";
  readonly message: string;
  /** Named by the gate that refused, so a reader branches on it rather than on `message`. */
  readonly refusalKind: ReseatStoreRefusalKind;
}
/** The old `claude` outlived the stop, so nothing was typed into its composer. */
export interface ReseatKillTimeoutError {
  readonly code: "KILL_TIMEOUT";
  readonly message: string;
  readonly pid: number;
}
/** The line could not be composed, or the send failed partway: the surface may be at a bare shell now. */
export interface ReseatRelaunchFailedError {
  readonly code: "RELAUNCH_FAILED";
  readonly message: string;
  /** Whether a live prior session was stopped before the failure — what decides whether later seats wait. */
  readonly afterStop: boolean;
}
/** The line was sent, and no live session carrying the id appeared within the wait. */
export interface ReseatUnconfirmedError {
  readonly code: "UNCONFIRMED";
  readonly message: string;
}
/** Another live reseat holds this workspace's lock, so this one planned, stopped and typed nothing. */
export interface ReseatContendedError {
  readonly code: "RESEAT_CONTENDED";
  readonly message: string;
}
/**
 * The workspace was picked for a wall, and under its reseat lock it shows none: another reseat, or a sign-in, brought
 * it back in between, so the session now there is not the one that was picked and nothing was stopped or typed.
 */
export interface ReseatWallClearedError {
  readonly code: "WALL_CLEARED";
  readonly message: string;
}
/** The workspace's reseat lock could not be taken or judged at all — not contention, and no rerun is known to clear it. */
export interface ReseatLockFailedError {
  readonly code: "RESEAT_LOCK_FAILED";
  readonly message: string;
}

/** Why one workspace was not reseated. */
export type ReseatError =
  | ReseatOwnWorkspaceError
  | ReseatNoLiveSessionError
  | ReseatNoResumableSessionError
  | ReseatNotColdError
  | ReseatNotAtPromptError
  | ReseatAmbiguousSessionError
  | ReseatUnsafeSessionIdError
  | ReseatNoModelError
  | ReseatModelRefusedError
  | ReseatBusyError
  | ReseatCmuxReadError
  | ReseatStoreRefusedError
  | ReseatKillTimeoutError
  | ReseatRelaunchFailedError
  | ReseatUnconfirmedError
  | ReseatContendedError
  | ReseatWallClearedError
  | ReseatLockFailedError;

/**
 * The `NO_LIVE_SESSION` message: the plain refusal before the cold arm ran, else why the tab was not a bare shell
 * and the way back — the chair's (`fleet resume` again, or `cmux reseat` from another tab) or a worker's.
 *
 * @param workspaceRef the tab refused
 * @param notCold the cold arm's verdict, when it ran
 * @returns the message
 */
function noLiveSessionMessage({
  workspaceRef,
  notCold,
}: {
  workspaceRef: string;
  notCold: { readonly chair: boolean; readonly why: string } | undefined;
}): string {
  if (notCold === undefined) {
    return `no live Claude session runs in ${workspaceRef}, so there is nothing to resume — \`slopweaver session re-seat\` fresh-spawns a walled seat's ledger row`;
  }
  if (notCold.chair) {
    return `no live Claude session runs in ${workspaceRef}, and its tab was not a bare shell to resume the pin into (${notCold.why}) — once the tab shows a shell prompt, run \`slopweaver fleet resume\` again or \`slopweaver cmux reseat ${workspaceRef}\` from another tab; \`session re-seat\` never seats the chair`;
  }
  return `no live Claude session runs in ${workspaceRef}, and its tab was not a bare shell holding a saved session to resume (${notCold.why}) — once the tab shows a shell prompt, run \`slopweaver cmux reseat ${workspaceRef}\` again; a seat with no saved session is fresh-spawned from its ledger row with \`slopweaver session re-seat\``;
}

/** The {@link ReseatError} factory. */
export const ReseatErrors = {
  ambiguousSession: ({ sessionIds }: { sessionIds: readonly string[] }): ReseatAmbiguousSessionError => ({
    code: "AMBIGUOUS_SESSION",
    message: `${String(sessionIds.length)} live Claude sessions run in this workspace (${sessionIds.join(", ")}) — reseat cannot tell which one the surface shows`,
    sessionIds,
  }),
  busy: ({ sessionId }: { sessionId: string }): ReseatBusyError => ({
    code: "BUSY",
    message: `session ${sessionId} is mid-turn behind no wall, and the stop would discard that turn — wait for it, or pass --force`,
  }),
  contended: ({ workspaceRef, holder }: { workspaceRef: string; holder: string }): ReseatContendedError => ({
    code: "RESEAT_CONTENDED",
    message: `another reseat holds ${workspaceRef} (${holder}), so nothing was stopped or typed here — two would each stop the seat and type a launch line; run \`slopweaver cmux reseat ${workspaceRef}\` again once that one has finished`,
  }),
  wallCleared: ({ workspaceRef, wall }: { workspaceRef: string; wall: string }): ReseatWallClearedError => ({
    code: "WALL_CLEARED",
    message: `${workspaceRef} was picked for its ${wall} wall, and under its reseat lock it shows none — another reseat or a sign-in brought it back, so nothing was stopped or typed; run \`slopweaver cmux reseat ${workspaceRef}\` to relaunch it anyway`,
  }),
  lockFailed: ({ workspaceRef, cause }: { workspaceRef: string; cause: string }): ReseatLockFailedError => ({
    code: "RESEAT_LOCK_FAILED",
    message: `${workspaceRef}'s reseat lock could not be taken (${cause}), so nothing was stopped or typed — read the lock's path in that line; a reseat never runs unserialised`,
  }),
  cmuxReadFailed: ({ what, cause }: { what: string; cause: string }): ReseatCmuxReadError => ({
    code: "CMUX_READ_FAILED",
    message: `cmux could not read ${what}: ${cause} — nothing was typed; run the same command again once cmux and ps answer, and read the tab's screen if it keeps failing`,
  }),
  killTimeout: ({ pid, seconds }: { pid: number; seconds: number }): ReseatKillTimeoutError => ({
    code: "KILL_TIMEOUT",
    message: `claude (pid ${String(pid)}) was still running ${String(seconds)}s after SIGTERM, so nothing was typed into the surface — stop it by hand and run reseat again`,
    pid,
  }),
  modelRefused: ({ model }: { model: string }): ReseatModelRefusedError => ({
    code: "MODEL_REFUSED",
    message: `--model ${model} on a worker seat needs ${FABLE_OVERRIDE_ENV}=1, exactly as cmux spawn does`,
  }),
  noLiveSession: ({
    workspaceRef,
    notCold,
  }: {
    workspaceRef: string;
    /** Set once the cold arm was also tried: whose seat the tab is, and why it was not read as a bare shell to resume. */
    notCold?: { readonly chair: boolean; readonly why: string };
  }): ReseatNoLiveSessionError => ({
    code: "NO_LIVE_SESSION",
    message: noLiveSessionMessage({ notCold, workspaceRef }),
  }),
  noResumableSession: ({
    workspaceRef,
    sessionId,
    cwd,
  }: {
    workspaceRef: string;
    sessionId: string;
    cwd: string;
  }): ReseatNoResumableSessionError => ({
    code: "NO_RESUMABLE_SESSION",
    message: `${workspaceRef} is a bare shell, and session ${sessionId} has no transcript under ${cwd}, so there is nothing to resume — never a fresh session in its place; a worker is fresh-spawned from its ledger row with \`slopweaver session re-seat\`, the chair by a new /slopweaver:supervisor chat`,
    sessionId,
  }),
  noModel: ({ workspaceRef }: { workspaceRef: string }): ReseatNoModelError => ({
    code: "NO_MODEL",
    message: `nothing names the model ${workspaceRef} runs: its argv carries no --model and its ledger row pinned none — pass --model <opus|sonnet>`,
  }),
  notAtPrompt: ({
    workspaceRef,
    pid,
    why,
  }: {
    workspaceRef: string;
    pid: number;
    why: string;
  }): ReseatNotAtPromptError => ({
    code: "NOT_AT_PROMPT",
    message: `claude (pid ${String(pid)}) stopped, and ${workspaceRef} did not come back to a bare shell (${why}), so nothing was typed into it — read the screen; once it shows a prompt, run \`slopweaver cmux reseat ${workspaceRef}\` again`,
    pid,
  }),
  notCold: ({ workspaceRef, why }: { workspaceRef: string; why: string }): ReseatNotColdError => ({
    code: "NOT_COLD",
    message: `${workspaceRef} was not a bare shell when the resume line would have been typed (${why}), so nothing was typed into it — read the screen; once it shows one shell prompt in one surface, run \`slopweaver cmux reseat ${workspaceRef}\` again`,
  }),
  ownWorkspace: ({ workspaceRef }: { workspaceRef: string }): ReseatOwnWorkspaceError => ({
    code: "OWN_WORKSPACE",
    message: `${workspaceRef} is the workspace this command runs in, and stopping its claude would stop this command — run it from another cmux tab`,
  }),
  relaunchFailed: ({
    workspaceRef,
    step,
    cause,
    afterStop,
  }: {
    workspaceRef: string;
    step: string;
    cause: string;
    afterStop: boolean;
  }): ReseatRelaunchFailedError => ({
    afterStop,
    code: "RELAUNCH_FAILED",
    message: `${step} failed: ${cause}${afterStop ? " — the old claude is already stopped;" : " —"} read ${workspaceRef}'s screen: a bare prompt means nothing landed, so run \`slopweaver cmux reseat ${workspaceRef}\` again; a half-typed line is cleared by hand first`,
  }),
  storeRefused: ({
    reason,
    refusalKind,
  }: {
    reason: string;
    refusalKind: ReseatStoreRefusalKind;
  }): ReseatStoreRefusedError => ({
    code: "STORE_REFUSED",
    message: reason,
    refusalKind,
  }),
  unconfirmed: ({
    workspaceRef,
    sessionId,
    seconds,
  }: {
    workspaceRef: string;
    sessionId: string;
    seconds: number;
  }): ReseatUnconfirmedError => ({
    code: "UNCONFIRMED",
    message: `the relaunch line was sent, and no live session carrying ${sessionId} stood in ${workspaceRef} at a Claude composer within ${String(seconds)}s — read ${workspaceRef}'s screen: a claude still booting confirms itself on the next \`slopweaver fleet resume\`; a bare prompt means the line was lost, so run \`slopweaver cmux reseat ${workspaceRef}\` again; anything else received the line, so stop it by hand first`,
  }),
  unsafeSessionId: ({ sessionId }: { sessionId: string }): ReseatUnsafeSessionIdError => ({
    code: "UNSAFE_SESSION_ID",
    message: `session id ${JSON.stringify(sessionId)} is not a UUID, and a relaunch line will not carry it — nothing was typed; the id came from the supervisor pin or cmux's saved binding for the tab, so correct that record, or fresh-spawn the seat from its ledger row with \`slopweaver session re-seat\``,
  }),
} as const;
