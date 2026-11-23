/**
 * The quiz block's half of the briefing gate, read back off the RENDERED bytes.
 *
 * ## Why it is read back at all, when a schema already refused the form
 *
 * The same reason every other half of this gate exists: the form is one way onto this page and a
 * hand-written artifact is another. `./check.ts` is the reader for a page a session composed by hand.
 *
 * ## The three rules, and why each is the one worth checking
 *
 * - **ONE question, never two.** This is the block's whole contract — one question
 *   per sweep — and it is the rule a hand-written page is most likely to break, because a composer with two
 *   good questions has no way to tell that a second one costs the first its meaning.
 * - **The question carries its ledger id.** The id is what the owner's answer NAMES; `slopweaver knowledge
 *   quiz-answer` cannot take "the quiz one".
 * - **The fleet's answer is inside a fold.** Not for secrecy — the block is a self-check and the fold opens
 *   — but because a verdict sitting above the fold is the first thing the owner reads, which turns "do you agree?"
 *   into "here is the answer, do you agree?".
 *
 * ## What it deliberately does NOT check
 *
 * Whether the claim is true, and whether the owner's answer is right. Both are the judgements this block exists to
 * collect, and a gate that made either would be the thing the whole design refuses. It also cannot tell
 * whether the question matches the ledger — that needs the ledger, and `slopweaver knowledge quiz --sweep`
 * is what reads it.
 *
 * Pure: HTML in, defects out.
 */
import { balancedElement } from "./text.js";

/**
 * Which rule the block broke.
 *
 * @internal — the shape {@link QuizCheckDefect} carries; `./check.ts` reads the defect, never this type.
 */
export type QuizCheckRule = "more-than-one" | "question-without-id" | "answer-above-the-fold";

/**
 * One defect the quiz block carries.
 *
 * @internal — reached through {@link QuizCheck}, which `./check.ts` names; no file imports it directly.
 */
export interface QuizCheckDefect {
  readonly rule: QuizCheckRule;
  readonly reason: string;
}

/** What checking one page's quiz block found. */
export interface QuizCheck {
  /** How many questions the page renders. Zero when it carries no block at all. */
  readonly questionsAsked: number;
  readonly defects: readonly QuizCheckDefect[];
}

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The opening tag of one rendered question. `.quiz` is this block's own class — see
 * `../outbound/briefing/chrome.ts` for why it is not `.need`, `.mine`, `.ranked`, `.act` or `.belief`.
 */
const QUIZ_OPEN = /<div class="quiz">/g;

/** The `q-`-prefixed ledger id on the question's visible line, which is what the owner's answer names. */
const QUIZ_ID_PATTERN = /<code>(q-[0-9a-f]{16})<\/code>/;

/** The label the renderer puts on the fleet's own verdict, which must never sit above the fold. */
const FLEET_ANSWER = "My answer:";

/** What one rendered question says about itself: its ledger id, and whether its answer is folded. */
interface RenderedQuiz {
  readonly quizId: string | undefined;
  readonly answerFolded: boolean;
}

/** Every question the page renders, in page order. */
function renderedQuestions({ html }: { html: string }): readonly RenderedQuiz[] {
  const questions: RenderedQuiz[] = [];
  for (const open of html.matchAll(QUIZ_OPEN)) {
    const element = balancedElement({ html, start: open.index, tag: "div" });
    // An unclosed block is still a block the owner can see, so it is counted — with neither field read, which is
    // what makes the checks below report it rather than the count quietly dropping it.
    if (element === undefined) {
      questions.push({ answerFolded: false, quizId: undefined });
      continue;
    }
    // A destructured default rather than an operator: `split` always yields a first element, and the
    // default is what says so to `noUncheckedIndexedAccess` without hiding a substitution.
    const [visible = element] = element.split("<details");
    questions.push({
      answerFolded: element.includes(FLEET_ANSWER) && !visible.includes(FLEET_ANSWER),
      quizId: QUIZ_ID_PATTERN.exec(element)?.[1],
    });
  }
  return questions;
}

/** At most one defect, when the page asks more than the one question a sweep is allowed. */
function countDefects({ questions }: { questions: readonly RenderedQuiz[] }): readonly QuizCheckDefect[] {
  if (questions.length <= 1) {
    return [];
  }
  return [
    {
      reason:
        `the page asks ${String(questions.length)} quiz questions. A sweep carries ONE — a ` +
        "second costs the first its meaning, because the owner answers by naming an id and the page is asking " +
        "that twice in one reading.",
      rule: "more-than-one",
    },
  ];
}

/** At most one defect, when a question renders without the id the owner's answer would have to name. */
function idDefects({ questions }: { questions: readonly RenderedQuiz[] }): readonly QuizCheckDefect[] {
  const missing = questions.filter((question) => question.quizId === undefined).length;
  if (missing === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(missing)} quiz question(s) render without their ledger id, so there is nothing for ` +
        "`slopweaver knowledge quiz-answer` to name when the owner answers. Render the block through " +
        "`slopweaver briefing render --knowledge-quiz --sweep <tick-id>`.",
      rule: "question-without-id",
    },
  ];
}

/** At most one defect, when the fleet's own verdict sits where the owner meets it before deciding. */
function foldDefects({ questions }: { questions: readonly RenderedQuiz[] }): readonly QuizCheckDefect[] {
  const unfolded = questions.filter((question) => !question.answerFolded).length;
  if (unfolded === 0) {
    return [];
  }
  return [
    {
      reason:
        `${String(unfolded)} quiz question(s) render the fleet's own answer outside the fold. The block is a ` +
        'self-check and the fold opens, but an answer above it turns "do you agree?" into "here is the ' +
        "answer, do you agree?\" — which collects the owner's agreement rather than their belief.",
      rule: "answer-above-the-fold",
    },
  ];
}

/**
 * Check one fleet-briefing page's quiz block.
 *
 * @param html the whole artifact file
 * @returns how many questions it asks, and one defect per rule broken
 */
export function checkQuiz({ html }: { html: string }): QuizCheck {
  const questions = renderedQuestions({ html: html.replace(STYLE_OR_SCRIPT, " ") });
  return {
    defects: [...countDefects({ questions }), ...idDefects({ questions }), ...foldDefects({ questions })],
    questionsAsked: questions.length,
  };
}
