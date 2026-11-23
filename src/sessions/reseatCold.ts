/**
 * `cmux reseat`'s COLD arm, pure: the relaunch of a workspace whose pane is a bare shell, planned from what was
 * SAVED for it rather than from a live session. The live arm and the plan tail both share are `./reseat.ts`; whether
 * a tab is cold at all is `./coldSeat.ts`.
 */
import { err, type Result } from "#lib/result.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";

import { planFor, type ReseatPlan, SESSION_ID_PATTERN } from "./reseat.js";
import { type ReseatError, ReseatErrors } from "./reseatErrors.js";

/**
 * Decide a COLD workspace's relaunch: its pane is a bare shell and nothing runs, so there is no live session to
 * read and nothing to stop. The session id and cwd come from what was SAVED for it — the chair's pin, or the
 * binding cmux kept — and the argv is the one cmux would have relaunched, so its own flags still win.
 *
 * MEASURED: with cmux's own restore switched off, a reopened tab is a bare shell, and every seat is
 * invisible to the live-session pass; this is the arm that brings one back on the fleet's line instead of cmux's.
 *
 * @param workspace the workspace to relaunch in
 * @param ownWorkspaceId the caller's own workspace, never touched
 * @param chair whether this is the supervisor chair
 * @param sessionId the saved session to resume
 * @param cwd the directory that session ran in, where its transcript lives
 * @param argv the launch argv cmux saved for it, empty when it saved none
 * @param ledgerModel the open ledger row's pinned boot model, when one pairs to the workspace
 * @param flagModel a `--model` the caller typed
 * @param env the environment the Fable override is read from
 * @param defaults what `cmux spawn` would pass when the argv names nothing
 * @returns the plan, or the refusal
 */
export function planColdReseat({
  workspace,
  ownWorkspaceId,
  chair,
  sessionId,
  cwd,
  argv,
  ledgerModel,
  flagModel,
  env,
  defaults,
}: {
  workspace: CmuxWorkspaceSummary;
  ownWorkspaceId: string | undefined;
  chair: boolean;
  sessionId: string;
  cwd: string;
  argv: string;
  ledgerModel: string | undefined;
  flagModel: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  defaults: { readonly pluginDir: string | undefined; readonly envPrefix: string };
}): Result<ReseatPlan, ReseatError> {
  if (workspace.workspaceId === ownWorkspaceId) {
    return err(ReseatErrors.ownWorkspace({ workspaceRef: workspace.workspaceRef }));
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return err(ReseatErrors.unsafeSessionId({ sessionId }));
  }
  return planFor({
    argv,
    chair,
    cwd,
    defaults,
    env,
    flagModel,
    // A cold verdict is only ever reached once the transcript was found (`./coldSeat.ts`), so this resumes.
    launch: { kind: "resume", sessionId },
    ledgerModel,
    prior: { kind: "cold" },
    sessionId,
    workspace,
  });
}
