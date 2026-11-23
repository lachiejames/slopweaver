/**
 * Projecting one quiz question onto the Fleet Briefing. Pure — a ledger row in, one typed block out, no
 * filesystem and no clock.
 *
 * ## Why this is a projection and not a composed block
 *
 * The same call `./ownerBeliefs.ts` and `./autonomy.ts` make, and here it has a sharper edge than either.
 * The block asks the owner to judge a claim against the fleet's own recorded answer; a supervisor free to retype
 * either half could put a claim in front of the owner the fleet never learned, or show a verdict the register
 * does not hold, and then collect the owner's answer against it. What the owner is being asked has to BE what the
 * ledger recorded, because the id on the page is what the answer names.
 *
 * ## What it does NOT do
 *
 * It does not re-select. `../knowledge/quiz/cut.ts` owns which lesson a sweep asks about, and the ledger
 * records it — a page that chose again at render time would ask something different from what the id
 * on it says, every time a lesson landed between two renders of the same sweep.
 *
 * It also never softens the fleet's verdict. `refuted` reaches the page saying exactly that, because a
 * claim the fleet has already measured as false is one of the more interesting things to find out the owner still
 * believes.
 */
import type { SelectedQuiz } from "../knowledge/quiz/types.js";
import type { BriefingQuiz } from "../outbound/briefing/types.js";

/**
 * Project one selected question into the block the page carries.
 *
 * `fleetRepro` and `fleetCaveat` are attached rather than always present, because
 * `exactOptionalPropertyTypes` makes the difference between "this lesson recorded no repro" and "this
 * lesson recorded `undefined`" a real one, and the schema reads the first as absent rather than as a field
 * to validate.
 *
 * The fleet's verdict is NARROWED on the way in and the narrowing is a refusal rather than a coercion: a
 * ledger row whose pinned recording carries `changed`, `untestable` or `unsettled` is one no sweep should
 * have cut, so projecting it as a question would put a claim in front of the owner whose reference answer the
 * fleet has already said it cannot give.
 *
 * @param question the ledger's own selected row
 * @returns the typed block, or undefined when the pinned recording carries no two-sided verdict
 */
export function projectQuiz({ question }: { question: SelectedQuiz }): BriefingQuiz | undefined {
  if (question.fleet.kind === "trace") {
    return projectTrace({ question, trace: question.fleet.trace });
  }
  const fleet = question.fleet.lesson;
  if (fleet.verdict !== "confirmed" && fleet.verdict !== "refuted") {
    return undefined;
  }
  return {
    claim: fleet.claim,
    domain: fleet.domain,
    fleetEvidence: fleet.evidence,
    fleetRecordedAtIso: fleet.recordedAtIso,
    fleetVerdict: fleet.verdict,
    lessonId: question.lessonId,
    quizId: question.quizId,
    tier: fleet.tier,
    ...(fleet.repro === undefined ? {} : { fleetRepro: fleet.repro }),
    ...(fleet.caveat === undefined ? {} : { fleetCaveat: fleet.caveat }),
  };
}

/**
 * The visible line a TRACE asks the owner, which is a different question from a lesson's.
 *
 * A lesson asks whether a conclusion is true. A trace asks whether a PLACE is still worth looking: we stopped
 * looking at X for question Y; keep that, or re-open it? The probe itself stays inside the fold with the
 * evidence: it is what makes the answer checkable, and it is often longer than a line the owner should have to
 * read to know what is being asked.
 *
 * @param outcome whether the probe paid or came back empty
 * @param questionText the question the probe was run for
 * @returns the one line above the fold
 */
function traceAsk({ outcome, questionText }: { outcome: "paid" | "empty"; questionText: string }): string {
  if (outcome === "empty") {
    return `We stopped looking here for: ${questionText}. Keep that, or re-open it?`;
  }
  return `This probe paid for: ${questionText}. Still where you would look?`;
}

/**
 * Project one selected TRACE into the block the page carries.
 *
 * `tier` is absent rather than defaulted — a trace has no rung on the harm ladder, and inventing one would
 * put a judgement nobody made beside the owner's own answer. The probe, the question and the outcome ride as their
 * own fields so the fold can show where the fleet actually looked.
 *
 * @param question the ledger's own selected row
 * @param trace the pinned trace recording
 * @returns the typed block, or undefined when the pinned recording carries no two-sided verdict
 */
function projectTrace({
  question,
  trace,
}: {
  question: SelectedQuiz;
  trace: Extract<SelectedQuiz["fleet"], { kind: "trace" }>["trace"];
}): BriefingQuiz | undefined {
  if (trace.verdict !== "confirmed" && trace.verdict !== "refuted") {
    return undefined;
  }
  return {
    claim: traceAsk({ outcome: trace.outcome, questionText: trace.question }),
    domain: trace.domain,
    fleetEvidence: trace.evidence,
    fleetRecordedAtIso: trace.recordedAtIso,
    fleetVerdict: trace.verdict,
    lessonId: question.lessonId,
    quizId: question.quizId,
    traceOutcome: trace.outcome,
    traceProbe: trace.probe,
    traceQuestion: trace.question,
    ...(trace.doesNotProve === undefined ? {} : { fleetCaveat: trace.doesNotProve }),
  };
}
