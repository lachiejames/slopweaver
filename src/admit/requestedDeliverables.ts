/**
 * REQUESTED DELIVERABLES — what an ask asked to be HANDED, as opposed to what answering it happened to teach
 * you.
 *
 * ## The measured failure this exists for
 *
 * One ask: deploy a pair of monitors locally, backtest them over seven days, send screenshots.
 * The worker ran SIX review rounds over roughly two hours and shipped without the one artifact the ask
 * existed for — a clickable link to each monitor it had deployed. It had the ids and the screenshots; a
 * reader still had to assemble the URL by hand to open the thing. In the same answer it had self-assigned a
 * full gate evaluation, a before/after comparison and an honest-inconclusive characterisation nobody had
 * asked for, and the fail-closed review loop then verified all of THAT, rigorously, round after round.
 *
 * The owner asks for backtests roughly daily, and the rule is exact: the quality bar does not move,
 * the SCOPE and the PRIORITIES do. So nothing here relaxes a check. It reorders which check comes first, and
 * turns the two artifact classes that are decidable from the question into something the door can refuse.
 *
 * ## Which half is a gate, and which half is a priority
 *
 * "Did you deliver what was asked" is not decidable from an arbitrary question. Two narrow cases are, and
 * only those two are in {@link REQUESTED_DELIVERABLES}: an ask that says DEPLOY must hand back a link the
 * reader can click, and one that asks for SCREENSHOTS must hand back images. Both are properties of the
 * composed answer's own bytes, so `coreDeliverableGate.ts` refuses a send that misses one rather than hoping
 * a reviewer notices.
 *
 * Everything else is a PRIORITY, and it is RENDERED rather than enforced: {@link coreDeliverablePreflightLines}
 * leads the worker's own brief, and {@link coreDeliverableReviewLines} is the reviewer's first section — where
 * it also carries the half that ends the six rounds, namely that scope the question never requested is not
 * grounds for another one.
 *
 * ## A citation chip is not the deliverable, deliberately
 *
 * A `link` run is a labelled thing the reader opens; a `citation` is provenance attached to a claim, rendered
 * as a bare `[n]`. Counting citations would make the gate pass almost every answer ever composed, including
 * the one measured above, which is a gate that never fires. So the deploy deliverable is satisfied only by a
 * real `link` run — and the worker is told that in its pre-flight, so it is never a surprise at the door.
 *
 * Scoped to what one real ask proved, exactly like `../live/turn/localSkillGuidance.ts`: add a row alongside
 * a measured miss, never speculatively.
 */
import { allRunsOf } from "../outbound/artifact/runs.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";

/**
 * What in a composed answer discharges one deliverable — a property of the answer's own bytes, always.
 *
 * @internal — the vocabulary {@link answerCarries} and {@link REQUESTED_DELIVERABLES} share; exported so a
 * test can name an evidence kind without going through a deliverable row.
 */
export type DeliverableEvidence = "clickable-link" | "attached-image";

/**
 * One class of artifact a question asks to be handed, and what in the answer proves it was.
 *
 * @internal — the row shape {@link requestedDeliverablesOf} and {@link missingDeliverables} return; exported
 * so a caller can name what is missing rather than re-deriving it from a finding's prose.
 */
export interface RequestedDeliverable {
  /** Stable id, used in the door finding's summary so a refusal names which deliverable is missing. */
  readonly id: string;
  /** Lower-cased substrings; any single match against the (lower-cased) question requests this deliverable. */
  readonly keywords: readonly string[];
  /** What in the composed answer discharges it. */
  readonly evidence: DeliverableEvidence;
  /** What the worker must put in the answer, in the answer form's own vocabulary. */
  readonly what: string;
  /** Why it is the CORE of this ask rather than a nicety — the sentence a worker reads and acts on. */
  readonly why: string;
}

/**
 * The first of the reviewer's two STANDING claims, word for word — one constant, so the packet's section 1, its
 * verdict section and the worker's pre-review checklist (`../live/turn/reviewObligations.ts`) cannot drift.
 */
export const DELIVERABLE_STANDING_CLAIM = "the answer delivers every artifact the question asked for";

/**
 * The table. Two rows, both from that ask; see this module's header before adding a third.
 *
 * @internal — exported so a test can assert the table's own contents rather than only its matches.
 */
export const REQUESTED_DELIVERABLES: readonly RequestedDeliverable[] = [
  {
    evidence: "clickable-link",
    id: "deploy-link",
    keywords: ["deploy"],
    what: 'a labelled `link` run — {"type":"link","label":"…","url":"…"} — per deployed thing, in `index` so it is above the fold',
    why: "opening the deployed thing IS the point of a deploy ask; an id is not a link, and a reader assembling the URL by hand did not get the deliverable (a `[n]` citation chip is provenance for a claim, not this)",
  },
  {
    evidence: "attached-image",
    id: "screenshots",
    keywords: ["screenshot", "screen shot", "screengrab"],
    what: "the images themselves in `images`, as absolute paths",
    why: "a description of what a screenshot shows is not the screenshot; the ask named the artifact",
  },
];

/**
 * Which deliverables this question requests, in table order. Pure and total.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns every deliverable whose keyword appears (case-insensitively) — empty when none do
 */
export function requestedDeliverablesOf({ question }: { question: string }): readonly RequestedDeliverable[] {
  const lower = question.toLowerCase();
  return REQUESTED_DELIVERABLES.filter((deliverable) =>
    deliverable.keywords.some((keyword) => lower.includes(keyword)),
  );
}

/**
 * Whether a composed answer carries one kind of evidence. Reads the answer's own bytes and nothing else.
 *
 * `clickable-link` looks in `index` and `body` — every place a `link` run can render — and deliberately not
 * in `citations`; see this module's header for why counting those would make the gate never fire.
 *
 * @param answer the composed answer
 * @param evidence the evidence kind to look for
 * @returns whether the answer carries it
 */
export function answerCarries({
  answer,
  evidence,
}: {
  answer: AnswerFormAnswer;
  evidence: DeliverableEvidence;
}): boolean {
  if (evidence === "attached-image") {
    return answer.images.length > 0;
  }
  const rendered = [...answer.index.flat(), ...allRunsOf({ detail: answer.body })];
  return rendered.some((run) => run.type === "link");
}

/**
 * Every deliverable this question requested that the composed answer does not carry.
 *
 * @param answer the composed answer about to be sent
 * @param question the question as asked
 * @returns the missing deliverables, in table order; empty when the answer hands back everything asked for
 */
export function missingDeliverables({
  answer,
  question,
}: {
  answer: AnswerFormAnswer;
  question: string;
}): readonly RequestedDeliverable[] {
  return requestedDeliverablesOf({ question }).filter(
    (deliverable) => !answerCarries({ answer, evidence: deliverable.evidence }),
  );
}

/**
 * The worker's pre-flight — the FIRST thing its brief says, before the decision or any step.
 *
 * Always renders, because the standing half applies to every ask; the concrete list is added only when the
 * question actually requests one of the two decidable classes. Both halves come from the same measured
 * failure, and the second is the one that turns six review rounds into one.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns the lines to print, in order
 */
export function coreDeliverablePreflightLines({ question }: { question: string }): readonly string[] {
  const requested = requestedDeliverablesOf({ question });
  const concrete =
    requested.length === 0
      ? []
      : [
          "  THIS ASK REQUESTS, and the send door REFUSES an answer that omits them:",
          ...requested.flatMap((deliverable) => [`    - ${deliverable.what}`, `      why: ${deliverable.why}`]),
        ];
  return [
    "CORE DELIVERABLE FIRST — deliver what was literally asked, then stop widening:",
    "  1. Name the artifacts this question asks to be HANDED before you investigate, and get those into the",
    "     answer first. A miss there is the whole answer failing, however correct the rest of it is.",
    "  2. Do NOT self-assign scope. Deeper analysis you discovered on the way — a gate evaluation, a",
    "     before/after, an honest inconclusive — is worth keeping and goes in CONCISELY, below the fold. It",
    "     never displaces the requested artifacts and never becomes the thing the answer is about.",
    "  3. Rigour is unchanged. Whatever you do deliver is held to exactly the same bar; this orders the work,",
    "     it does not lower it.",
    ...concrete,
  ];
}

/**
 * The reviewer packet's first section — what the question literally asked for, checked before anything else.
 *
 * Carries the priority REORDER, which is the half that ends the round-after-round loop: a missing requested
 * artifact is `broken` outright and outranks every fine-detail nit, and scope the question never requested is
 * never itself grounds for a further round.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns the section's lines, in order
 */
export function coreDeliverableReviewLines({ question }: { question: string }): readonly string[] {
  const requested = requestedDeliverablesOf({ question });
  const concrete =
    requested.length === 0
      ? ["- no artifact class here is decidable from the question alone — read it and name what it asked for."]
      : requested.map((deliverable) => `- ${deliverable.what} — ${deliverable.why}`);
  return [
    "## 1. What the question literally asked for — CHECK THIS FIRST",
    "",
    "Before any claim, before voice, before anything below: re-read the question in section 2 and list the",
    "artifacts it asks to be HANDED. Then check the answer carries each one.",
    "",
    ...concrete,
    "",
    `This is a STANDING material claim in every verdict, \`impact\` \`high\`: \`${DELIVERABLE_STANDING_CLAIM}\`.`,
    "A missing one is `broken` — it outranks every fine-detail correctness nit, and",
    "you say which artifact is absent so one round fixes it.",
    "",
    "The reverse also binds you. Analysis the question did NOT request is not grounds for `broken` or",
    "`incomplete`: note it in a `low`-impact claim and move on. Measured — six review rounds over",
    "two hours, every one of them spent verifying self-assigned scope, on an answer that never carried the",
    "artifact the ask existed for. Rigour on what was asked, silence on what was not.",
    "",
  ];
}
