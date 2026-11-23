/**
 * The quiz block's own schema — the one question a sweep asks the owner.
 *
 * Split out of `./schema.ts` for the reason `./ownerBeliefsSchema.ts` and `./autonomySchema.ts` were: that
 * file is at the code-line cap `file-size-ratchet` enforces, and this block is a real seam in it. Its
 * fields are a PROJECTION of the quiz ledger (`../../briefing/quiz.ts`) rather than prose a supervisor
 * composed, so nothing here shares a vocabulary helper with a composed cell.
 */
import { z } from "zod";

import { QUIZ_CLAIM_MAX_CHARS } from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import type { TraceOutcome } from "../../knowledge/memory.js";
import { QUIZ_VERDICTS } from "../../knowledge/quiz/types.js";
import { LESSON_TIERS } from "../../knowledge/types.js";
import { strictForm } from "../strictForm.js";

import type { BriefingQuiz } from "./types.js";
import { proseLine } from "./vocabulary.js";

/**
 * An instant the block states: ISO-8601, and one a `Date` actually parses.
 *
 * Spelled here rather than shared with the two sibling section schemas, for their reason: importing it
 * across them would tie three independent sections together so that retiring any one breaks the others.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "the quiz's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.",
  });

/**
 * Both trace outcomes, as the tuple `z.enum` needs.
 *
 * Spelled here rather than taken from `../../knowledge/memory.ts`'s array for the reason
 * `../../store/schema/memories.ts` measured: a readonly TUPLE on the receiving end of `.find` or `.some`
 * sends the `named-object-params` gate into unbounded recursion, so the vocabulary stays a plain array there
 * and a tuple lives at each place a tuple is actually required. `satisfies` keeps the two in agreement.
 */
const TRACE_OUTCOME_VALUES = ["paid", "empty"] as const satisfies readonly TraceOutcome[];

/**
 * The one question this sweep asks.
 *
 * ## What is capped, and what deliberately is not
 *
 * The CLAIM carries the register's own bound and nothing tighter — a claim shorter than `knowledge record`
 * allows would make a recorded lesson unaskable, which is the block silently unable to do the one thing it
 * exists for. `fleetEvidence`, `fleetRepro` and `fleetCaveat` are UNCAPPED: they render inside the fold,
 * the fold ruling leaves folded prose alone, and abbreviating the evidence is exactly what
 * would make the question unjudgeable. `PAGE_TEXT_MAX_BYTES` is what bounds their weight.
 *
 * `fleetVerdict` is one of TWO rather than the register's five, and `../../knowledge/quiz/types.ts` carries
 * why: a quiz needs an unambiguous reference answer, and `unsettled` in particular means the fleet has
 * already said no call could settle the claim.
 */
export const quizSchema = strictForm({
  claim: proseLine.max(QUIZ_CLAIM_MAX_CHARS),
  domain: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .min(2)
    .max(40),
  fleetCaveat: z.string().min(1).optional(),
  fleetEvidence: z.string().min(1),
  fleetRecordedAtIso: instant,
  fleetRepro: z.string().min(1).optional(),
  fleetVerdict: z.enum(QUIZ_VERDICTS),
  lessonId: z.string().regex(/^[lt]-[0-9a-f]{16}$/u, {
    message:
      "the quiz's claim id is the register's own: `l-` for a lesson or `t-` for a trace, then sixteen hex " +
      "characters. One that is not names no recording, so nothing could show the owner what else has been said " +
      "about the claim.",
  }),
  quizId: z.string().regex(/^q-[0-9a-f]{16}$/u, {
    message:
      "the quiz's own id is the ledger's: `q-` and sixteen hex characters. One that is not is an id " +
      "`slopweaver knowledge quiz-answer` could never find, so the owner's answer would land nowhere.",
  }),
  // Optional because a TRACE has no tier — see `./types.ts`'s `BriefingQuiz.tier`. A lesson still carries
  // one, and the projection is what puts it there rather than a composer.
  tier: z.union(LESSON_TIERS.map((tier) => z.literal(tier))).optional(),
  traceOutcome: z.enum(TRACE_OUTCOME_VALUES).optional(),
  traceProbe: z.string().min(1).optional(),
  traceQuestion: z.string().min(1).optional(),
});

/**
 * The words the quiz block puts above the fold: the claim and the question around it.
 *
 * The evidence, the verdict, the repro and the caveat are absent because they are inside the fold — the
 * same arithmetic the two sibling sections make. The domain and the id are charged with the claim: the owner
 * meets both, and the id is on the line precisely so the owner can name it.
 *
 * @internal — read by the form's own page budget; no caller outside the form names it.
 *
 * @param quiz the projected question
 * @returns the word count a reader meets without expanding the fold
 */
export function quizAboveFoldWords({ quiz }: { quiz: BriefingQuiz }): number {
  return wordCount({ text: `${quiz.domain} ${quiz.claim} ${quiz.quizId}` });
}
