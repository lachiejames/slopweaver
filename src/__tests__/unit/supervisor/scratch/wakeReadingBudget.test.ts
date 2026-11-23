/**
 * The tick's `handover wake` reading budget is spelled as literals in a pure module; this holds it to the wake's
 * own constants, so a change to either side fails here rather than killing a wake reading mid-spawn.
 */
import { describe, expect, it } from "vitest";

import { WAKE_BOOT_SHARE } from "../../../../cli/commands/handover/wakeBootBudget.js";
import { WAKE_SPAWN_TIMEOUT_MS } from "../../../../cli/commands/handover/wakeDueRow.js";
import {
  WAKE_BRANCH_READ_TIMEOUT_MS,
  WAKE_FINISH_ASKS,
  WAKE_FINISH_TIMEOUT_MS,
} from "../../../../cli/commands/handover/wakeFinish.js";
import { WAKE_CHECKS_READ_TIMEOUT_MS, WAKE_JUDGE_DEADLINE_MS } from "../../../../cli/commands/handover/wakeJudge.js";
import {
  QUESTION_READ_CONCURRENCY,
  WAKE_QUESTION_DEADLINE_MS,
} from "../../../../cli/commands/handover/wakeQuestionPass.js";
import { READING_TIMEOUT_MS, WAKE_READING_TIMEOUT_MS } from "../../../../supervisor/scratch/tickCapture.js";

describe("WAKE_READING_TIMEOUT_MS", () => {
  it("covers the judging pass, the question pass, every finish ask and every re-read reseat one wake run may launch, plus one ordinary reading", () => {
    expect(WAKE_READING_TIMEOUT_MS).toBe(
      WAKE_BOOT_SHARE * (WAKE_SPAWN_TIMEOUT_MS + WAKE_CHECKS_READ_TIMEOUT_MS) +
        WAKE_FINISH_ASKS * (WAKE_FINISH_TIMEOUT_MS + WAKE_CHECKS_READ_TIMEOUT_MS + WAKE_BRANCH_READ_TIMEOUT_MS) +
        WAKE_JUDGE_DEADLINE_MS +
        WAKE_CHECKS_READ_TIMEOUT_MS +
        WAKE_QUESTION_DEADLINE_MS +
        WAKE_CHECKS_READ_TIMEOUT_MS +
        // The last batch's finish readiness children, run at once.
        WAKE_FINISH_TIMEOUT_MS +
        // Per row of the last batch: the reconcile's branch read, and the commit read before the finish ask and
        // again under the claim.
        QUESTION_READ_CONCURRENCY * (3 * WAKE_BRANCH_READ_TIMEOUT_MS) +
        READING_TIMEOUT_MS,
    );
  });
});
