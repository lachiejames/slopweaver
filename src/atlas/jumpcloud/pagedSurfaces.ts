/**
 * Which JumpCloud surfaces a production read actually pages — the denominator every response boundary is
 * counted against.
 *
 * The registry admits far more rows than a sync calls: whole shape-indexed kinds are never walked, and a kind's
 * plan sets aside its unrunnable and excluded operations. So the set is DERIVED from the same plan the sync runs,
 * never a hand-kept list beside it, plus the auth-event read, which pages its own surface outside the sync.
 */
import { JUMPCLOUD_AUTH_EVENTS_SURFACE } from "./authEvents.js";
import { JUMPCLOUD_KINDS } from "./model.js";
import { isShapeIndexedKind, type JumpcloudKindPlan, planJumpcloudKind } from "./plan.js";

/**
 * Plan every kind a sync walks — every declared kind but the shape-indexed ones.
 *
 * @returns one plan per walked kind, in kind order
 */
export function planJumpcloudWalk(): readonly JumpcloudKindPlan[] {
  return JUMPCLOUD_KINDS.filter((kind) => !isShapeIndexedKind({ kind })).map((kind) => planJumpcloudKind({ kind }));
}

/**
 * Every surface a production read pages: each walked kind's roots and fan-outs, and the auth-event surface.
 *
 * @returns the surface names, sorted and distinct
 *
 * @internal
 */
export function jumpcloudPagedSurfaceNames(): readonly string[] {
  const walked = planJumpcloudWalk().flatMap((plan) => [...plan.roots, ...plan.fanouts].map((op) => op.row.name));
  return [...new Set([...walked, JUMPCLOUD_AUTH_EVENTS_SURFACE])].toSorted();
}
