/**
 * A GONE supervisor chair written onto a real ledger and run journal under a throwaway home: its app row, and its run
 * either still open or ended the way `handover reap` ends one whose writer is proven dead. Shared by the takeover
 * tests over gate (c) and steps 4–6.
 */
import { appendRunEvent } from "../../../handover/runStore.js";
import { appendSessionEvent } from "../../../sessions/sessionStore.js";
import type { SupervisorPinTarget } from "../../../sessions/supervisorPin.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The gone chair's app session id. */
export const GONE_APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
/** The gone chair's handover slug. */
export const GONE_SLUG = "fresh-supervisor-handoff-9290";
/** Where the pin record says the gone chair was hosted. */
export const GONE_TARGET: SupervisorPinTarget = { appSessionId: GONE_APP_ID, kind: "app" };
/** When the gone chair was spawned and its run started. */
export const GONE_AT = "2026-11-05T09:00:00.000Z";

/**
 * Record the chair's app row on the real ledger under the throwaway home.
 *
 * @param home the throwaway state home
 */
export function spawnedChair({ home }: { home: string }): void {
  appendSessionEvent({
    event: {
      branch: GONE_SLUG,
      cwd: `/w/.claude/worktrees/${GONE_SLUG}`,
      harness: "app",
      kind: "spawned",
      sessionId: GONE_APP_ID,
      sessionKey: GONE_SLUG,
      slug: GONE_SLUG,
      surfaceRef: `app:${GONE_APP_ID}`,
      tsIso: GONE_AT,
      workspaceRef: `app:${GONE_APP_ID}`,
    },
    home,
  });
}

/** Where the pin record says a gone CMUX chair was hosted. */
export const GONE_CMUX_TARGET = { kind: "cmux", workspaceId: "id-gone-chair", workspaceRef: "workspace:9" } as const;

/**
 * Record a cmux chair's row on the real ledger under the throwaway home, carrying the workspace id its record names.
 *
 * @param home the throwaway state home
 */
export function spawnedCmuxChair({ home }: { home: string }): void {
  appendSessionEvent({
    event: {
      branch: GONE_SLUG,
      cwd: `/w/.claude/worktrees/${GONE_SLUG}`,
      harness: "cmux",
      kind: "spawned",
      sessionId: GONE_CMUX_TARGET.workspaceId,
      sessionKey: GONE_SLUG,
      slug: GONE_SLUG,
      surfaceRef: "surface:9",
      tsIso: GONE_AT,
      workspaceId: GONE_CMUX_TARGET.workspaceId,
      workspaceRef: GONE_CMUX_TARGET.workspaceRef,
    },
    home,
  });
}

/**
 * Start the chair's run, then optionally end it the way `handover reap` does for a proven-dead writer.
 *
 * @param home the throwaway state home
 * @param orphaned whether the run is ended orphaned rather than left open
 */
export function chairRun({ home, orphaned }: { home: string; orphaned: boolean }): void {
  const runsDir = stateHomePaths({ home }).runs;
  appendRunEvent({
    event: { atIso: GONE_AT, branch: GONE_SLUG, docHash: "h", kind: "started" },
    runsDir,
    slug: GONE_SLUG,
  });
  if (orphaned) {
    appendRunEvent({
      event: { atIso: "2026-11-05T10:00:00.000Z", deadSessionId: "dead", kind: "orphaned", lastEventIso: GONE_AT },
      runsDir,
      slug: GONE_SLUG,
    });
  }
}
