/**
 * Plain fakes for the sweep's reviewer arm (`cli/commands/turn/reviewSurface.ts`'s `ReviewerSweepDeps`).
 *
 * Not mocks — injected functions with fixed answers, which is what `.claude/rules/testing.md` asks for. They
 * live here rather than in each suite because every existing sweep test needs the dep and none of them is
 * ABOUT it: those homes carry no review record at all, so `reconcileStrandedReviewer` returns before either
 * function is reached. A suite that IS about the reviewer arm builds its own inventory instead.
 */
import type {
  ReviewerResubmitOutcome,
  ReviewerSurfaceRead,
  ReviewerSweepDeps,
} from "../cli/commands/turn/reviewSurface.js";

/** A reviewer surface that reports traffic cmux already knows about, so nothing is ever judged stranded. */
const QUIET_REVIEWER_SURFACE: ReviewerSurfaceRead = {
  delivery: { kind: "other-traffic", submittedAtIso: "2026-09-02T00:00:00.000Z" },
  screen: undefined,
};

/** The refusal a re-submit gives when it is reached at all, which these fakes never expect it to be. */
const HELD_RESUBMIT: ReviewerResubmitOutcome = { kind: "held", reason: "fake deps never press Enter" };

/**
 * Sweep reviewer deps that answer without touching cmux.
 *
 * @returns deps whose surface read always corroborates delivery and whose re-submit always holds
 */
export function quietReviewerSweepDeps(): ReviewerSweepDeps {
  return {
    resubmitPickup: () => Promise.resolve(HELD_RESUBMIT),
    reviewerSurface: () => Promise.resolve(QUIET_REVIEWER_SURFACE),
  };
}
