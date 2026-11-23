/**
 * The pin collision rule `slopweaver cmux pin` enforces — cmux itself does not.
 *
 * Measured: `workspace.action {action: "pin", …}` on a second workspace left BOTH it and the
 * already-pinned one reading `pinned: true` on the next `workspace.list` — cmux has no single-pin invariant at
 * all. The pin is how a supervised session tells the supervisor from a peer
 * (`.claude/rules/cross-session-messages.md`), so a fleet holding two pins silently downgrades that check for
 * everyone reading it — this is the refusal that keeps it to at most one.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { CmuxWorkspaceSummary } from "./client.js";

/**
 * Why a pin was refused: a DIFFERENT workspace already holds the pin, or the target is not among the
 * workspaces cmux lists — so there is nothing live to pin and no ref to record it under.
 *
 * @internal — no caller outside this module needs the shape by name; callers branch on `.code` and print
 * `.message`.
 */
export type PinRefusal =
  | { readonly code: "ALREADY_PINNED_ELSEWHERE"; readonly message: string; readonly pinnedRef: string }
  | { readonly code: "WORKSPACE_NOT_LISTED"; readonly message: string; readonly workspaceId: string };

/** How a {@link PinRefusal} is raised — the factory the real code calls, so a test built the same way catches a drift. */
export const PinRefusals = {
  alreadyPinnedElsewhere: ({ pinnedRef }: { pinnedRef: string }): PinRefusal => ({
    code: "ALREADY_PINNED_ELSEWHERE",
    message:
      `${pinnedRef} is already pinned — a fleet with two pinned workspaces breaks the ` +
      `supervisor check, so unpin it first: slopweaver cmux unpin --workspace ${pinnedRef}`,
    pinnedRef,
  }),
  workspaceNotListed: ({ workspaceId }: { workspaceId: string }): PinRefusal => ({
    code: "WORKSPACE_NOT_LISTED",
    message: `${workspaceId} is not among the workspaces cmux lists, so there is nothing live to pin — run slopweaver cmux list and name one it shows`,
    workspaceId,
  }),
} as const;

/**
 * The listed workspace a pin is aimed at, refused when cmux does not list it: the pin is recorded under that
 * workspace's own ref, and a workspace cmux cannot see has none.
 *
 * @param workspaces every live workspace, as `cmux list` already reads them
 * @param targetWorkspaceId the workspace about to be pinned
 * @returns the target's own listing, or the `WORKSPACE_NOT_LISTED` refusal
 */
export function listedPinTarget({
  workspaces,
  targetWorkspaceId,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  targetWorkspaceId: string;
}): Result<CmuxWorkspaceSummary, PinRefusal> {
  const listed = workspaces.find((workspace) => workspace.workspaceId === targetWorkspaceId);
  if (listed === undefined) {
    return err(PinRefusals.workspaceNotListed({ workspaceId: targetWorkspaceId }));
  }
  return ok(listed);
}

/**
 * Whether pinning `targetWorkspaceId` should be refused because a DIFFERENT workspace is already pinned.
 *
 * @param workspaces every live workspace, as `cmux list` already reads them
 * @param targetWorkspaceId the workspace about to be pinned
 * @returns the refusal naming the workspace already pinned, or `undefined` to proceed
 */
export function pinCollisionRefusal({
  workspaces,
  targetWorkspaceId,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  targetWorkspaceId: string;
}): PinRefusal | undefined {
  const other = workspaces.find((workspace) => workspace.pinned && workspace.workspaceId !== targetWorkspaceId);
  if (other === undefined) {
    return undefined;
  }
  return PinRefusals.alreadyPinnedElsewhere({ pinnedRef: other.workspaceRef });
}
