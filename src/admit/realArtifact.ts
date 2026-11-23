/**
 * REAL EVIDENCE, OR SAY WHY — the subjects where a GENERATED picture cannot stand in for the real thing's
 * own surface, and what an answer must do when it could not get the real one.
 *
 * ## The measured failure
 *
 * Asked in public for a seven-day backtest of two Datadog monitors with screenshots, the bot replayed the pull
 * request's queries against real cost data, DREW two charts of its own arithmetic, and attached those. It
 * never deployed the monitors, so it never had their own *Monitor behavior with this threshold* panel and
 * never had a monitor link. It did name the gap — a `couldNotSee` blind spot saying the monitors were not
 * deployed and the charts were a replay — and stopped exactly there. The owner's rule: a generated artifact
 * or a generated image carries no weight; the only evidence that means anything is the screenshot or the
 * deployed monitor link, and an answer that skipped the local deploy says why.
 *
 * So the defect is not the missing deploy on its own — a turn can legitimately fail to get one. It is that
 * the answer stated the ABSENCE and never the CAUSE, which leaves a reader unable to tell a hard blocker
 * from a step nobody took.
 *
 * ## Why this is a separate table from `./requestedDeliverables.ts`
 *
 * That module's two rows are decidable from a VERB the question uses — "deploy" demands a link back,
 * "screenshot" demands images. This one is keyed on the question's SUBJECT, and the measured question is
 * exactly why: it said "backtest these monitors, post screenshots" and never said "deploy", so `deploy-link`
 * did not fire; `screenshots` did, and the two generated charts satisfied it, because a chart is an image.
 * Both existing gates passed an answer built entirely out of things the bot drew itself.
 *
 * A monitor, a dashboard, an alert — these have a real artifact whether or not the question names it, and
 * the owner reads only that one. That property belongs to the subject, not to a verb.
 *
 * ## The rule, stated as the two ways to discharge it
 *
 * A matched question's answer must carry EITHER a clickable `link` run — the real thing, openable — OR at
 * least one `grounding.evidence.substitutedForReal` entry, whose schema cannot be constructed without a
 * `why`. Never neither. `./realArtifactGate.ts` refuses the send; this module holds the table, the check and
 * the worker's own pre-flight, exactly as `./requestedDeliverables.ts` and `./coreDeliverableGate.ts` split.
 *
 * Scoped to what one real ask proved. Add a row alongside a measured miss, never speculatively.
 */
import { allRunsOf } from "../outbound/artifact/runs.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";

/**
 * One subject whose real artifact outranks anything an answer can draw for itself.
 *
 * @internal — the row shape {@link realArtifactSubjectsOf} returns; exported so a test can name a subject
 * without re-deriving it from a finding's prose.
 */
export interface RealArtifactSubject {
  /** Stable id, used in the door finding's code so a refusal names which subject tripped it. */
  readonly id: string;
  /** Lower-cased substrings; any single match against the (lower-cased) question fires this row. */
  readonly keywords: readonly string[];
  /** The real artifact, named the way the worker has to go and get it. */
  readonly real: string;
  /** Why a generated stand-in does not discharge it — the sentence a worker reads and acts on. */
  readonly why: string;
}

/**
 * The table. One row, from the measured ask; see this module's header before adding a second.
 *
 * `alert` sits alongside `monitor` because it is the same artifact under the word the owner actually uses
 * half the time — "does it alert when we care" was that very question's acceptance test.
 *
 * @internal — exported so a test can assert the table's own contents rather than only its matches.
 */
export const REAL_ARTIFACT_SUBJECTS: readonly RealArtifactSubject[] = [
  {
    id: "deployed-monitor",
    keywords: ["monitor", "alerting", "alert threshold", "backtest"],
    real: "the monitor deployed (locally, routed nowhere) and a labelled `link` run to it, plus its own evaluation panel captured as an image",
    why: "a chart this session drew is a picture of its own arithmetic, and it can be right about the data while being wrong about what the monitor would do; the deployed thing's own panel and link are the only evidence that carries the monitor's real evaluation",
  },
];

/**
 * Which real-artifact subjects this question raises, in table order. Pure and total.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns every subject whose keyword appears (case-insensitively) — empty when none do
 *
 * @internal — exported so a test can assert which subjects a question raises, independently of the gate.
 */
export function realArtifactSubjectsOf({ question }: { question: string }): readonly RealArtifactSubject[] {
  const lower = question.toLowerCase();
  return REAL_ARTIFACT_SUBJECTS.filter((subject) => subject.keywords.some((keyword) => lower.includes(keyword)));
}

/**
 * Whether an answer hands back something openable — a `link` run anywhere it renders.
 *
 * Deliberately the same test `./requestedDeliverables.ts`'s `clickable-link` evidence uses, and deliberately
 * NOT a check that the link points at the deployed thing: only a reader can settle that, and a gate that
 * guessed would refuse correct answers. What is checkable is that SOMETHING openable is there at all — the
 * measured answer carried zero `link` runs of any kind.
 *
 * @param answer the composed answer about to be sent
 * @returns whether any `link` run renders in `index` or `body`
 *
 * @internal — exported so a test can assert the link check on its own.
 */
export function answerCarriesOpenableLink({ answer }: { answer: AnswerFormAnswer }): boolean {
  const rendered = [...answer.index.flat(), ...allRunsOf({ detail: answer.body })];
  return rendered.some((run) => run.type === "link");
}

/**
 * Every real-artifact subject this question raises that the answer neither proves nor accounts for.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked
 * @returns the unaccounted subjects, in table order; empty when the answer links the real thing, or says why
 *   it could not, or the question raises no such subject at all
 */
export function unaccountedRealArtifacts({
  answer,
  question,
}: {
  answer: AnswerFormAnswer;
  question: string;
}): readonly RealArtifactSubject[] {
  if (answerCarriesOpenableLink({ answer }) || answer.grounding.evidence.substitutedForReal.length > 0) {
    return [];
  }
  return realArtifactSubjectsOf({ question });
}

/**
 * The worker's pre-flight for this rule, rendered only when the question raises a matching subject.
 *
 * Nothing renders for every other ask, on purpose: the standing "attach the picture when the proof is a
 * picture" default already covers those (`../live/turn/visualEvidenceGuidance.ts`), and this is the narrower
 * claim that a picture the session DREW is not that picture.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns the lines to print, in order; empty when no subject matches
 */
export function realArtifactPreflightLines({ question }: { question: string }): readonly string[] {
  const subjects = realArtifactSubjectsOf({ question });
  if (subjects.length === 0) {
    return [];
  }
  return [
    "REAL EVIDENCE, OR SAY WHY — this ask has a real artifact, and a picture you generate is not it:",
    ...subjects.flatMap((subject) => [`  - go and get: ${subject.real}`, `    why: ${subject.why}`]),
    "  The send door REFUSES an answer that carries neither a clickable `link` run nor a",
    "  `grounding.evidence.substitutedForReal` entry. That entry takes `real` (what you could not produce)",
    "  and `why` (the REASON — a blocked credential, a stack that would not come up, a step you judged too",
    "  costly). Naming the gap without its cause is the exact failure this exists for: state WHY, in one line.",
  ];
}
