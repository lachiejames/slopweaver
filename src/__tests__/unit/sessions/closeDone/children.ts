/*
 * The pure fixtures the done-chat sweep's split test files share: the standing-ruling lookup that answers none,
 * the bot loop's shared checkout, one dispatch child's ledger row and live workspace, and the `planChildren`
 * wrapper over `planCloseDone` with no slug-backed rows and no doc evidence. No socket, no disk.
 */
import type { CmuxWorkspaceSummary } from "../../../../cmux/client.js";
import type { StandingSessionRuling } from "../../../../handover/standingSession.js";
import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import type { ReviewPosture } from "../../../../live/turn/leaseJudgement.js";
import { type CloseDonePlanItem, planCloseDone } from "../../../../sessions/closeDone.js";
import type { SessionItem } from "../../../../sessions/session.js";
import { workspace } from "../../cli/commands/session/closeDoneHarness.js";
import { never } from "../closeDonePlanFixtures.js";
import { NO_REVIEW, NOW, REVIEW_KEY, REVIEW_NAME } from "../dispatchFixtures.js";

/**
 * No row carries a standing-session ruling.
 *
 * @returns `undefined`, for any row
 */
export function noStanding(): StandingSessionRuling | undefined {
  return undefined;
}

/** The bot loop's checkout — every child of every ask shares it, which is why cwd cannot identify one. */
export const LOOP_CWD = "/w/.claude/worktrees/live-loop";

/**
 * One dispatch child's ledger row, in the loop's shared checkout and answering to no doc.
 *
 * @returns the reviewer's open row, with `over` applied last
 */
export function childRow(over: Partial<SessionItem> = {}): SessionItem {
  return {
    cwd: LOOP_CWD,
    lastEventIso: "2026-09-03T07:02:00.000Z",
    sessionKey: REVIEW_KEY,
    spawnedIso: "2026-09-03T07:02:00.000Z",
    status: "open",
    workspaceRef: "workspace:9",
    ...over,
  };
}

/**
 * One dispatch child's live workspace, carrying the description cmux was given at spawn.
 *
 * @returns the reviewer's workspace, with `over` applied last
 */
export function childWorkspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return workspace({
    currentDirectory: LOOP_CWD,
    description: `spawned session · ${REVIEW_NAME}`,
    title: "review: why did staging exhaust",
    workspaceId: "id-9",
    workspaceRef: "workspace:9",
    ...over,
  });
}

/**
 * Plan one fleet of dispatch children, with no slug-backed rows and no doc evidence at all.
 *
 * @returns the plan `planCloseDone` makes at `NOW`, every reviewer reporting `review`
 */
export function planChildren({
  askEvents,
  review = NO_REVIEW,
  rows,
  workspaces,
}: {
  askEvents: readonly AskLifecycleEvent[];
  review?: ReviewPosture;
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): readonly CloseDonePlanItem[] {
  return planCloseDone({
    askEvents,
    evidenceFor: never,
    nowIso: NOW,
    ownWorkspaceId: undefined,
    reviewPostureFor: () => review,
    standingFor: noStanding,
    rows,
    workspaces,
  });
}
