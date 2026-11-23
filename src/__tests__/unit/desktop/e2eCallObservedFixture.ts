/**
 * One clean observed call: live, the owner's turn heard, an answer given that greeted them as a colleague, nothing blocked,
 * crashed, dropped or overlapping, and no other scenario evidence. Every `judgeCallScenario` test spreads this and
 * changes the one thing it judges.
 */
import { type E2eCallObserved, NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";

/** A call every scenario passes, bar the evidence its own requirements ask for. */
export const CLEAN: E2eCallObserved = {
  blocked: undefined,
  cleanup: undefined,
  crash: undefined,
  dropped: undefined,
  evidence: { ...NO_CALL_EVIDENCE, openings: [{ callId: "t1", faults: [], text: "Hey." }] },
  ownerTurn: true,
  live: true,
  longTaskMs: undefined,
  overlap: undefined,
  queueSearch: { answer: undefined, toolCallIds: [] },
  voiceAnswer: true,
};
