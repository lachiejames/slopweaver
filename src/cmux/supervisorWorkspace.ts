/**
 * Identifying the pinned `/slopweaver:supervisor` workspace, and the one refusal message every guard that
 * blocks reaching it with `cmux send` shares — the verb-level check in `../cli/commands/cmux/send.ts` and the
 * hook-level one in `../admit/cmuxSendSupervisorGuard.ts`. Kept as one function so the two can never drift
 * apart: `.claude/rules/cross-session-messages.md` names `SendMessage` as the one way to reach the
 * supervisor, never `cmux send` — the box it types into is the owner's own input, and typed text there is
 * indistinguishable from the owner's own (a spawned session's report once landed there by `cmux send`).
 */
import type { CmuxWorkspaceSummary } from "./client.js";

/** The title `cmux takeover` sets on the workspace it pins — the owner's fixed convention for this role. */
export const SUPERVISOR_WORKSPACE_TITLE = "/slopweaver:supervisor";

/**
 * Whether a workspace IS the pinned supervisor — cmux's own pin flag AND the fixed title, together. A pin
 * alone is not enough (a human can pin any workspace by hand, and `./pin.ts` enforces only that there is at
 * most one), and the title alone is not enough either (nothing stops a differently-purposed workspace being
 * renamed the same string before it is ever pinned).
 *
 * @param pinned the workspace's own `pinned` flag
 * @param title the workspace's own title, if it has one
 * @returns whether both conditions hold
 */
export function isPinnedSupervisorWorkspace({
  pinned,
  title,
}: {
  pinned: boolean;
  title: string | undefined;
}): boolean {
  return pinned && title === SUPERVISOR_WORKSPACE_TITLE;
}

/**
 * The refusal text for a `cmux send` (or a raw shell reach) aimed at the pinned supervisor — shared verbatim
 * between the verb-level check and the hook-level one, so a session sees one wording whichever door it tried.
 *
 * @param workspaceRef the pinned supervisor's own ref, so the reader knows which workspace this was
 * @returns the refusal message
 */
export function supervisorSendRefusalMessage({ workspaceRef }: { workspaceRef: string }): string {
  return (
    `${workspaceRef} is the pinned supervisor workspace — the box the owner types into. Text sent there is ` +
    "indistinguishable from the owner's own and can be submitted as if the owner said it. Report to it with SendMessage " +
    "(ListAgents to resolve its name), never cmux send."
  );
}

/** What {@link supervisorSendRefusal} decided a `cmux send` should be refused for. */
export interface SupervisorSendRefusal {
  readonly message: string;
}

/**
 * Whether a `cmux send` aimed at `target` should be refused — LIVE resolution, for the verb itself
 * (`../cli/commands/cmux/send.ts`), which already has `target` from its own `resolveWorkspace` call.
 *
 * Refused whenever `target` is the pinned supervisor and the caller is not that same workspace — a session
 * reaching its OWN pinned workspace is a no-op this guard has no reason to stop.
 *
 * @param target the resolved workspace `cmux send` is about to reach
 * @param callerWorkspaceId this process's own workspace id (`CMUX_WORKSPACE_ID`), or `undefined` outside cmux
 * @returns the refusal, or `undefined` to proceed
 */
export function supervisorSendRefusal({
  target,
  callerWorkspaceId,
}: {
  target: Pick<CmuxWorkspaceSummary, "pinned" | "title" | "workspaceId" | "workspaceRef">;
  callerWorkspaceId: string | undefined;
}): SupervisorSendRefusal | undefined {
  if (!isPinnedSupervisorWorkspace({ pinned: target.pinned, title: target.title })) {
    return undefined;
  }
  const caller = callerWorkspaceId?.trim();
  if (caller !== undefined && caller.length > 0 && caller === target.workspaceId) {
    return undefined;
  }
  return { message: supervisorSendRefusalMessage({ workspaceRef: target.workspaceRef }) };
}
