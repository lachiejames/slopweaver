/**
 * The quiz block's own renderer — one claim the owner is asked to judge, and the fleet's answer folded beneath it.
 *
 * Split out of `./render.ts` for the reason `./quizSchema.ts` was split out of `./schema.ts`: that file sits
 * at the code-line cap `file-size-ratchet` enforces, and this block is a real seam in it — a heading, a
 * contract line and one fold, reading one projected block and nothing else on the page.
 *
 * The claim is a SIBLING of the fold rather than its `<summary>`, and that is mechanical:
 * `../../briefing/text.ts`'s above-fold reader removes a whole `<details>` element, summary included, so a
 * claim written as a summary would be a line the owner meets that no budget can see.
 */
import { escapeText } from "./escape.js";
import { stampMelbourne } from "./stamp.js";
import { type BriefingQuiz, QUIZ_ID } from "./types.js";

/**
 * The quiz block's heading, the question the RENDERER asks, and the fold's own summary.
 *
 * Owned here rather than composed, the same call every other contract line on this page makes, and this one
 * carries two things a composer must not be free to soften. First, that the fleet's answer is ON the page:
 * the block is a self-check, and a page that implied otherwise would be lying about what an artifact is.
 * Second, what the owner's answer is FOR — the owner's side of the register, not a score.
 */
const QUIZ_HEADING = `<h2 id="${QUIZ_ID}">one thing I learned — do you agree?</h2>`;
const QUIZ_CONTRACT =
  '<p class="sub">The fleet paid for this one. Tell the supervisor the id and whether you think it is true ' +
  "and why — my own answer is in the fold, so open it whenever you like. Where your answer and mine come " +
  "apart is the row worth having.</p>";

/**
 * The fleet's own answer: its verdict, what it measured, the command that settles it, and its limits.
 *
 * A TRACE prints where it looked and how that came back instead of a tier, because it has no rung on the
 * harm ladder and a rendered one would be a judgement nobody made.
 */
function renderQuizDetail({ quiz }: { quiz: BriefingQuiz }): string {
  const when = escapeText({ text: stampMelbourne({ iso: quiz.fleetRecordedAtIso }) });
  const provenance =
    quiz.traceOutcome === undefined
      ? `lesson ${quiz.lessonId} · tier ${String(quiz.tier)} · recorded `
      : `trace ${quiz.lessonId} · probe came back ${quiz.traceOutcome} · recorded `;
  const lines = [
    `<p><strong>My answer:</strong> ${escapeText({ text: quiz.fleetVerdict })}</p>`,
    `<p><strong>What I measured:</strong> ${escapeText({ text: quiz.fleetEvidence })}</p>`,
    ...(quiz.fleetRepro === undefined
      ? []
      : [`<p><strong>Settles it again:</strong> <code>${escapeText({ text: quiz.fleetRepro })}</code></p>`]),
    ...(quiz.fleetCaveat === undefined
      ? []
      : [`<p><strong>What that does not establish:</strong> ${escapeText({ text: quiz.fleetCaveat })}</p>`]),
    ...(quiz.traceProbe === undefined
      ? []
      : [`<p><strong>Where we looked:</strong> <code>${escapeText({ text: quiz.traceProbe })}</code></p>`]),
    `<p class="bg">${escapeText({ text: provenance })}${when}</p>`,
  ].join("");
  return `<details><summary>what I think, and what I measured</summary><div>${lines}</div></details>`;
}

/**
 * The quiz block.
 *
 * Omitted entirely when the sweep asked nothing — a register with nothing two-sided in it is a real state,
 * and a heading with no question under it is worse than silence.
 *
 * @param quiz the projected question, absent when this sweep asked none
 * @returns the block's HTML lines, empty when there is no question
 */
export function renderQuiz({ quiz }: { quiz: BriefingQuiz | undefined }): readonly string[] {
  if (quiz === undefined) {
    return [];
  }
  const claim = escapeText({ text: quiz.claim });
  const domain = escapeText({ text: quiz.domain });
  const id = escapeText({ text: quiz.quizId });
  const head = `<p class="q">${claim} <span class="bg">${domain} · <code>${id}</code></span></p>`;
  return [`  ${QUIZ_HEADING}`, `  ${QUIZ_CONTRACT}`, `  <div class="quiz">${head}${renderQuizDetail({ quiz })}</div>`];
}
