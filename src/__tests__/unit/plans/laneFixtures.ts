/**
 * Judged plan lanes for the supervisor's tests: today's register (both lanes filling) and the lean shape (one Claude
 * plan standing). Synthetic counts only — never a figure read from a real register.
 */
import type { LaneShapeRead, LaneShapes, PlanLaneShape } from "../../../plans/laneShape.js";

/**
 * One judged lane, two plans standing unless overridden.
 *
 * @param over the mode and model host, plus any count to change
 * @returns the lane
 */
export function lane(over: Partial<PlanLaneShape> & Pick<PlanLaneShape, "mode" | "host">): PlanLaneShape {
  return { lapsedPlans: 0, pausedPlans: 0, standingPlans: 2, unrecordedLapses: 0, ...over };
}

/** Both lanes filling, judged. */
export const FILL_SHAPES: LaneShapes = {
  claude: lane({ host: "claude", mode: "fill" }),
  codex: lane({ host: "codex", mode: "fill" }),
  observedAtIso: "2026-11-21T12:00:00.000Z",
};

/** Both lanes filling — today's register, so a Claude chair is held to Fable and timer sweeps arm. */
export const FILL_LANES: LaneShapeRead = { kind: "current", shapes: FILL_SHAPES };

/** One Claude plan left standing, so the chair is held to Opus and no timer sweep arms. */
export const LEAN_LANES: LaneShapeRead = {
  kind: "current",
  shapes: { ...FILL_SHAPES, claude: lane({ host: "claude", mode: "lean", standingPlans: 1 }) },
};
