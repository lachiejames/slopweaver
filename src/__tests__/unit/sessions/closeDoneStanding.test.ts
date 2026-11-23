/**
 * The done-chat sweep's plan over a seat whose row carries the owner's standing-session ruling
 * (`../../../sessions/closeDone.ts`): kept between the owner's turns, parked from its bound on, and still closed once its
 * run is done. Pure — every input built inline.
 */
import { describe, expect, it } from "vitest";

import type { StandingSessionRuling } from "../../../handover/standingSession.js";
import { type CloseDonePlanItem, planCloseDone } from "../../../sessions/closeDone.js";
import { workspace } from "../cli/commands/session/closeDoneHarness.js";
import { always, never, row } from "./closeDonePlanFixtures.js";
import { NO_REVIEW, NOW } from "./dispatchFixtures.js";

/** A live standing-session ruling, bounded when `untilIso` is given. */
function standing({ untilIso }: { untilIso?: string }): StandingSessionRuling {
  return {
    anchor: "talk:standing",
    atIso: "2026-09-03T07:00:00.000Z",
    decidedIso: "2026-09-03T07:00:00.000Z",
    kind: "ruling",
    ruling: "keep that session open for me",
    standingSession: untilIso === undefined ? {} : { untilIso },
  };
}

describe("planCloseDone over a standing seat", () => {
  it("keeps an open run's seat whose row carries the owner's standing-session ruling, never parking it", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: never,
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      rows: [row()],
      standingFor: () => standing({}),
      workspaces: [workspace()],
    });
    expect(plan).toEqual([{ kind: "kept", reason: "standing-session", row: row() }]);
  });

  it("keeps a standing seat until its bound and parks it from the bound on", () => {
    const plan = ({ untilIso }: { untilIso: string }): readonly CloseDonePlanItem[] =>
      planCloseDone({
        askEvents: [],
        evidenceFor: never,
        nowIso: NOW,
        ownWorkspaceId: undefined,
        reviewPostureFor: () => NO_REVIEW,
        rows: [row()],
        standingFor: () => standing({ untilIso }),
        workspaces: [workspace()],
      });
    expect(plan({ untilIso: "2026-09-03T10:00:00.001Z" })).toEqual([
      { kind: "kept", reason: "standing-session", row: row() },
    ]);
    expect(plan({ untilIso: NOW })).toEqual([{ kind: "park-candidate", row: row(), workspace: workspace() }]);
  });

  it("still closes a standing seat whose run is done — a finished run is not between the owner's turns", () => {
    const plan = planCloseDone({
      askEvents: [],
      evidenceFor: always({ kind: "run-closed" }),
      nowIso: NOW,
      ownWorkspaceId: undefined,
      reviewPostureFor: () => NO_REVIEW,
      rows: [row()],
      standingFor: () => standing({}),
      workspaces: [workspace()],
    });
    expect(plan).toEqual([{ evidence: { kind: "run-closed" }, kind: "candidate", row: row(), workspace: workspace() }]);
  });
});
