/**
 * Which live workspaces `session close-done` may read as a finished `fleet resume` tab — the one class it closes
 * that no ledger row names. Pure; the reads and closes are `../cli/commands/session/closeDoneShells.ts`, and what
 * makes a tab finished is `../fleet/resumeShell.ts`.
 */
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { pairRowsToWorkspaces } from "./closeDone.js";
import type { SessionItem } from "./session.js";

/**
 * Every workspace no OPEN ledger row pairs to, bar the pinned one and the caller's own. A row the ledger already
 * closed claims nothing: the session it named is over, and the tab may be what the resume left behind.
 *
 * @param rows the folded session ledger, every status
 * @param workspaces the live cmux inventory
 * @param ownWorkspaceId the caller's own workspace (`CMUX_WORKSPACE_ID`), or `undefined` outside cmux
 * @returns the workspaces whose screens are worth reading for a finish line
 */
export function resumeShellCandidates({
  rows,
  workspaces,
  ownWorkspaceId,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  ownWorkspaceId: string | undefined;
}): readonly CmuxWorkspaceSummary[] {
  const open = rows.filter((row) => row.status === "open" && row.workspaceRef !== undefined);
  const paired = new Set([...pairRowsToWorkspaces({ rows: open, workspaces }).values()].map((w) => w.workspaceId));
  return workspaces.filter(
    (workspace) => !workspace.pinned && workspace.workspaceId !== ownWorkspaceId && !paired.has(workspace.workspaceId),
  );
}
