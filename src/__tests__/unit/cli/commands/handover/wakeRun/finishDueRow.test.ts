/**
 * `finishDueRow` on its own: one due merged park offered to `handover finish`, settled when finish closes its run
 * (or would, on a dry run), and handed on to its reseat with the sentence saying why when finish refuses.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { type FinishStep, finishDueRow } from "../../../../../../cli/commands/handover/wakeDueFinish.js";
import type { DueJudgement } from "../../../../../../cli/commands/handover/wakeJudge.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { judgeParkWake } from "../../../../../../handover/parkWake.js";
import { wakeCandidates } from "../../../../../../handover/wakeCandidates.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow } from "./harness.js";

/**
 * Offer the one park on this home to `finishDueRow`, judged due off the deps' own checks read.
 *
 * @returns the step finish came to
 */
async function offer({
  deps,
  dryRun,
  home,
}: {
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
}): Promise<FinishStep> {
  const [candidate] = unwrap(wakeCandidates({ home, rerunAllowed: false })).candidates;
  const judged = await judgeParkWake({ now: NOW, readChecks: deps.readChecks({ home }), wake: candidate!.parked.wake });
  if (judged.kind !== "due") {
    throw new Error(`the park was not judged due: ${judged.reason}`);
  }
  const judgement: DueJudgement = judged;
  return finishDueRow({ allowNoLessons: false, candidate: candidate!, deps, dryRun, home, judgement });
}

describe("finishDueRow", () => {
  let home: string;

  beforeEach(() => {
    ({ home } = mintWakeHome());
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("settles the park as finished when handover finish closes its run", async () => {
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const step = await offer({ deps, dryRun: false, home });
    expect(step).toMatchObject({ asked: true, kind: "settled", row: { action: "finished", slug: "landed" } });
  });

  it("reports would-finish on a dry run and passes --dry-run to finish", async () => {
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const step = await offer({ deps, dryRun: true, home });
    expect(step).toMatchObject({ asked: true, kind: "settled", row: { action: "would-finish" } });
    expect(recorded.finished).toEqual(["landed --dry-run"]);
  });

  it("hands a park finish refused on to its reseat", async () => {
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 1 }, recorded });
    const step = await offer({ deps, dryRun: false, home });
    expect([step.kind, step.asked, recorded.finished]).toEqual(["reseat", true, ["landed"]]);
  });
});
