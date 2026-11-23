/**
 * The ledger row and done-evidence lookups the done-chat sweep's plan tests share (`./closeDone/`,
 * `./closeDoneStanding.test.ts`); their live workspace is the CLI harness's own `workspace`. Pure — no socket, no disk.
 */
import type { DoneEvidence } from "../../../sessions/dispatchDoneEvidence.js";
import type { SessionItem } from "../../../sessions/session.js";

/**
 * An open, spawned ledger row, most fields defaulted to one plausible session.
 *
 * @returns the row, with `over` applied last
 */
export function row(over: Partial<SessionItem> = {}): SessionItem {
  return {
    cwd: "/w/.claude/worktrees/a-doc",
    lastEventIso: "2026-09-03T08:00:00.000Z",
    sessionKey: "a-doc",
    slug: "a-doc",
    spawnedIso: "2026-09-03T08:00:00.000Z",
    status: "open",
    workspaceRef: "workspace:1",
    ...over,
  };
}

/**
 * Every slug is done, with the same evidence.
 *
 * @returns a lookup answering `evidence` for any slug
 */
export function always(evidence: DoneEvidence): (args: { readonly slug: string }) => DoneEvidence | undefined {
  return () => evidence;
}

/**
 * No slug is done.
 *
 * @returns `undefined`, for any slug
 */
export function never(): DoneEvidence | undefined {
  return undefined;
}
