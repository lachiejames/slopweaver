/**
 * The pure row a `--settle-only` wake leaves in place: never reseated, carrying why its finish did not close it, or
 * the judgement's own reason when no finish was asked, and the reconcile's class when its pull request ended.
 */
import { describe, expect, it } from "vitest";

import { unsettledRow } from "../../../../../cli/commands/handover/wakeFinishPass.js";
import type { DueJudgement } from "../../../../../cli/commands/handover/wakeJudge.js";

const WAKE = { kind: "checks", number: 7, repo: "acme/widgets" } as const;

const JUDGEMENT: DueJudgement = {
  kind: "due",
  observed: { kind: "checks", number: 7, prState: "MERGED", repo: "acme/widgets" },
  reason: "acme/widgets#7 merged",
};

describe("unsettledRow", () => {
  it("says why the finish did not close the run, and carries the reconcile's class", () => {
    const landing = { cause: "finish-refusal", detail: "a probe is PARTIAL", kind: "hiding-step" } as const;
    expect(
      unsettledRow({ finishWhy: "a probe is PARTIAL", judgement: JUDGEMENT, landing, slug: "abc-1", wake: WAKE }),
    ).toEqual({
      action: "none",
      detail: "settle-only, so not reseated: a probe is PARTIAL",
      judgement: JUDGEMENT,
      reconciliation: landing,
      slug: "abc-1",
      wake: WAKE,
    });
  });

  it("falls back to the judgement's reason when no finish was asked, and carries no class it was not given", () => {
    expect(
      unsettledRow({ finishWhy: undefined, judgement: JUDGEMENT, landing: undefined, slug: "abc-2", wake: WAKE }),
    ).toEqual({
      action: "none",
      detail: "settle-only, so not reseated: acme/widgets#7 merged",
      judgement: JUDGEMENT,
      slug: "abc-2",
      wake: WAKE,
    });
  });
});
