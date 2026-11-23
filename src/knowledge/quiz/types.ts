/**
 * The quiz ledger's vocabulary — one question per sweep, and what they said about it.
 *
 * The briefing carries one quiz question per sweep.
 *
 * ## What the quiz asks, and why it is NOT the correction block
 *
 * The correction block (`../voice/types.ts`'s {@link BeliefProposal}) asks whether the fleet read THEIR words
 * correctly. Its source is their own recorded speech, so it can only ever surface a belief they have already
 * stated out loud. The quiz runs the other way: it takes a claim the FLEET learned the hard way and asks
 * them whether it is true, which is the only way to find out what they believe about something they never
 * thought to mention. The page's own framing of the split is what made it a separate call — _"a belief you
 * held confidently and wrongly. This is the one a quiz catches and a briefing does not, because you would
 * never have thought to ask."_
 *
 * Two surfaces with the same job would be the defect here, not the redundancy.
 *
 * ## It is a SELF-CHECK, and the page says so rather than pretending otherwise
 *
 * The briefing is static HTML they can read end to end, so the fleet's own answer is on the page inside a
 * fold. Nothing here can prove they did not open it, and a design that depended on their not opening it would
 * be dishonest about what an artifact is. What the ledger records is what they SAID, and the value is the
 * disagreement: a claim where their answer and the fleet's recorded verdict come apart is a row worth having
 * in both halves of the register.
 */
import type { TraceRow } from "../traceRow.js";
import type { LessonRow } from "../types.js";

/**
 * What a question is drawn from — a lesson the fleet concluded, or a TRACE of where it looked.
 *
 * The quiz asks about traces as well as lessons, and a trace is a different animal from a lesson on purpose:
 * a lesson asks them whether a generalisation is true, a trace asks whether a place is still worth looking —
 * _"we stopped looking at X for question Y; keep that, or re-open it?"_ Wrapping both in one union rather
 * than widening {@link LessonRow} keeps a trace's missing tier from becoming an invented one.
 */
export type QuizSubject =
  { readonly kind: "lesson"; readonly lesson: LessonRow } | { readonly kind: "trace"; readonly trace: TraceRow };

/** The longest their answer to one quiz question may run. `../voice/answer.ts`'s bound, for its reason. */
export const QUIZ_ANSWER_MAX = 2000;

/**
 * The verdicts a quiz question may be drawn from.
 *
 * Two of the register's five, and the narrowing is the point rather than a simplification. A quiz asks a
 * question with a reference answer; `changed`, `untestable` and `unsettled` supply no unambiguous one —
 * `unsettled` in particular means no call could EVER settle the claim, which makes "is this true?" a
 * question the fleet has already said it cannot answer either. Asking one anyway would collect their opinion
 * and file it against a row that cannot disagree with it.
 *
 * `slopweaver knowledge quiz` reports how many candidates each excluded verdict cost, so the narrowing is
 * visible rather than silent.
 */
export const QUIZ_VERDICTS: readonly ["confirmed", "refuted"] = ["confirmed", "refuted"];

/** One of the two verdicts a quiz question may be drawn from. */
export type QuizVerdict = (typeof QUIZ_VERDICTS)[number];

/**
 * One row of the quiz ledger: a question selected for a sweep, a sweep that had none, or their answer.
 *
 * Append-only, exactly like the proposal queue beside it, and for the same reasons: what a sweep asked is a
 * fact that does not stop being true, and a status field would be a second place the same fact lives.
 */
export type QuizEvent =
  | {
      readonly kind: "selected";
      /** `q-` and 16 hex characters over the sweep and the lesson, so one sweep asks one question forever. */
      readonly quizId: string;
      /** The sweep this question belongs to — the supervisor tick's own id. */
      readonly sweepId: string;
      /** The lesson it was drawn from, by the register's own claim id. */
      readonly lessonId: string;
      /**
       * The fleet's recording, pinned exactly as it stood when the question was cut.
       *
       * A RECEIPT rather than a second register: the fleet may later change its own verdict, and the
       * question they answered has to stay the question they were asked. Nothing reads this back into the
       * register, and nothing may — an imported copy would be a recording nobody made.
       *
       * A line written before traces were askable holds a bare lesson row here; `../quiz/select.ts`'s
       * decode reads that shape as `{ kind: "lesson" }` so an old ledger keeps meaning what it meant.
       */
      readonly fleet: QuizSubject;
      readonly selectedAtIso: string;
    }
  | {
      readonly kind: "empty";
      readonly sweepId: string;
      /** Why this sweep asked nothing. A real, recorded answer rather than a missing row. */
      readonly why: string;
      readonly selectedAtIso: string;
    }
  | {
      readonly kind: "answered";
      readonly quizId: string;
      /** THEIR words, as the supervisor relayed them. Never a session's summary of their answer. */
      readonly words: string;
      readonly answeredAtIso: string;
      /** The board row the session that recorded their answer was on, or `ad-hoc`. */
      readonly run: string;
    };

/** One row of the quiz ledger that carries a question. See {@link QuizEvent} for why these are aliases. */
export type SelectedQuiz = Extract<QuizEvent, { kind: "selected" }>;

/** One row recording that a sweep had nothing to ask. */
export type EmptyQuiz = Extract<QuizEvent, { kind: "empty" }>;

/** One row recording what they said about a question. */
export type AnsweredQuiz = Extract<QuizEvent, { kind: "answered" }>;
