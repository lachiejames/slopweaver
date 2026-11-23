/**
 * The open ledger row the `resumeRun` leaves share: the unclaimed-worktree-tab cases and the cmux 0.65.2 payload
 * cases both build one.
 */
import type { SessionItem } from "../../../../../../sessions/session.js";

/**
 * An open dispatch-child ledger row: no slug, recorded under a ref cmux has since reissued.
 *
 * @returns an open ledger item keyed `child-<workspaceRef>`, spawned and last seen at one fixed instant
 */
export function dispatchRow({ cwd, workspaceRef }: { cwd: string; workspaceRef: string }): SessionItem {
  return {
    cwd,
    lastEventIso: "2026-10-11T00:00:00.000Z",
    sessionKey: `child-${workspaceRef}`,
    spawnedIso: "2026-10-11T00:00:00.000Z",
    status: "open",
    workspaceRef,
  };
}
