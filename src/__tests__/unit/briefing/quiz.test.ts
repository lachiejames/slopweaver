/**
 * The quiz block: the projection of one ledger row, and the gate that reads the block back off the rendered
 * bytes.
 *
 * The two halves are tested in one file for the reason `./ownerBeliefs.test.ts` is: the property that
 * matters is that they AGREE, and a change to the block's shape that broke the reader's regular expression
 * would otherwise pass one file and fail nothing.
 */
import { describe, expect, it } from "vitest";

import { projectQuiz } from "../../../briefing/quiz.js";
import { checkQuiz } from "../../../briefing/quizCheck.js";
import type { SelectedQuiz } from "../../../knowledge/quiz/types.js";
import type { LessonRow } from "../../../knowledge/types.js";
import { renderQuiz } from "../../../outbound/briefing/quizRender.js";

const AT = "2026-09-12T01:00:00.000Z";

/** The fleet's own recording, varying only what a test overrides. */
const lesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  claim: "APM adaptive sampling sits upstream of retention filters",
  domain: "datadog",
  evidence: "a 100%-error filter kept 0 of 412 traces over 7d",
  id: "l-0123456789abcdef",
  learner: "fleet",
  recordedAtIso: AT,
  run: "ad-hoc",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
  ...over,
});

/** One selected question, varying only its pinned recording. */
const question = (over: Partial<LessonRow> = {}): SelectedQuiz => ({
  fleet: { kind: "lesson", lesson: lesson(over) },
  kind: "selected",
  lessonId: "l-0123456789abcdef",
  quizId: "q-0123456789abcdef",
  selectedAtIso: AT,
  sweepId: "tick-240-9",
});

describe("projectQuiz", () => {
  it("carries the claim, the verdict and the evidence through untouched", () => {
    const block = projectQuiz({ question: question() });

    expect(block?.claim).toBe("APM adaptive sampling sits upstream of retention filters");
    expect(block?.fleetVerdict).toBe("confirmed");
    expect(block?.fleetEvidence).toBe("a 100%-error filter kept 0 of 412 traces over 7d");
    expect(block?.tier).toBe(2);
  });

  it("never softens a refuted verdict, because that is the interesting thing to find the owner still believes", () => {
    expect(projectQuiz({ question: question({ verdict: "refuted" }) })?.fleetVerdict).toBe("refuted");
  });

  it("carries the repro and the caveat when the fleet's row has them, and omits them when it does not", () => {
    const bare = projectQuiz({ question: question() });
    const full = projectQuiz({ question: question({ caveat: "only OPEN was tested", repro: "some command" }) });

    expect(bare?.fleetRepro).toBe(undefined);
    expect(bare?.fleetCaveat).toBe(undefined);
    expect(full?.fleetRepro).toBe("some command");
    expect(full?.fleetCaveat).toBe("only OPEN was tested");
  });

  it("refuses a pinned recording with no two-sided verdict rather than asking an unanswerable question", () => {
    expect(projectQuiz({ question: question({ verdict: "unsettled" }) })).toBe(undefined);
    expect(projectQuiz({ question: question({ verdict: "changed" }) })).toBe(undefined);
    expect(projectQuiz({ question: question({ verdict: "untestable" }) })).toBe(undefined);
  });
});

describe("renderQuiz", () => {
  /** The block's bytes for one question. */
  const html = (over: Partial<LessonRow> = {}): string =>
    renderQuiz({ quiz: projectQuiz({ question: question(over) }) }).join("\n");

  it("renders nothing at all when this sweep asked nothing", () => {
    expect(renderQuiz({ quiz: undefined })).toEqual([]);
  });

  it("puts the ledger id on the visible line, because it is what the owner's answer names", () => {
    expect(html()).toContain("<code>q-0123456789abcdef</code>");
  });

  it("keeps the claim outside the fold, so the budget that counts words can see it", () => {
    const rendered = html();

    expect(rendered.indexOf("adaptive sampling")).toBeLessThan(rendered.indexOf("<details"));
  });

  it("keeps the fleet's own answer INSIDE the fold, so they are not handed it before deciding", () => {
    const rendered = html();

    expect(rendered.indexOf("<details")).toBeLessThan(rendered.indexOf("My answer:"));
  });

  it("says the fold holds the fleet's own answer, so the self-check is stated rather than hidden", () => {
    expect(html()).toContain("my own answer is in the fold");
  });

  it("escapes a claim carrying markup, so nothing the register holds can close the page's own tags", () => {
    const rendered = html({ claim: "The <script>alert(1)</script> pool exhausts." });

    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).not.toContain("<script>");
  });
});

describe("checkQuiz", () => {
  /** The rendered block, as a whole page's worth of bytes. */
  const rendered = (over: Partial<LessonRow> = {}): string =>
    renderQuiz({ quiz: projectQuiz({ question: question(over) }) }).join("\n");

  it("reads back exactly what the renderer emitted, with no defects", () => {
    const result = checkQuiz({ html: rendered() });

    expect(result.questionsAsked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("reports a page with no block at all as zero questions rather than as a defect", () => {
    const result = checkQuiz({ html: "<main><h2>react now</h2></main>" });

    expect(result.questionsAsked).toBe(0);
    expect(result.defects).toEqual([]);
  });

  it("names a page asking two questions, which is the rule a hand-written one breaks", () => {
    const defects = checkQuiz({ html: `${rendered()}\n${rendered()}` }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["more-than-one"]);
    expect(defects[0]?.reason).toContain("A sweep carries ONE");
  });

  it("names a question rendering without its ledger id", () => {
    const html = rendered().replace("<code>q-0123456789abcdef</code>", "<code>the quiz one</code>");
    const defects = checkQuiz({ html }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["question-without-id"]);
    expect(defects[0]?.reason).toContain("knowledge quiz-answer");
  });

  it("names a page putting the fleet's answer above the fold", () => {
    const html = rendered().replace("<details>", "<p><strong>My answer:</strong> confirmed</p><details>");
    const defects = checkQuiz({ html }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["answer-above-the-fold"]);
  });
});
