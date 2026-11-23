/**
 * Question-first intake: the record that exists BEFORE a proposal is drafted.
 *
 * ## Why a proposal starts as questions
 *
 * The gap-question set is what stops a document being written past the things only a stakeholder can settle.
 * A proposal drafted without knowing who decides, what the actual ask is, or which claims need a frozen
 * citation is a document that has to be rewritten once someone reads it — and rewriting it is the expensive
 * part, because the numbers and the shots have already been gathered around the wrong argument.
 *
 * `proposal intake` seeds the questions and refuses to advance while a blocking one is unanswered. That
 * refusal is the feature.
 *
 * ## The intake also carries the proposal's stable identity
 *
 * A destination assigns its own ids, so the only thing that can name "this proposal" across a draft, a
 * publish and a re-publish is a local id. The intake slug is it, and `proposal publish` uses it to find the
 * artifact it is re-publishing over.
 *
 * Pure shape builders here; the filesystem tail is `intakeStore.ts`.
 */
import type { ProposalAddress } from "./address.js";

/** Where an intake has got to. */
export type IntakeStatus = "intake" | "ready-to-draft" | "drafted" | "published";

/** One gap question, and its answer once the stakeholder has given one. */
export interface IntakeQuestion {
  readonly key: string;
  readonly question: string;
  /** A blocking question refuses a draft while it is unanswered. */
  readonly blocking: boolean;
  readonly answer?: string | undefined;
}

/** One proposal's intake record. */
export interface ProposalIntake {
  /** The stable local id for this proposal, used as its ledger key across drafts and re-publishes. */
  readonly id: string;
  readonly brief: string;
  readonly questions: readonly IntakeQuestion[];
  readonly status: IntakeStatus;
  readonly createdIso: string;
  /** Where this intake published to, once it has — whichever destination wrote it. */
  readonly address?: ProposalAddress | undefined;
  /**
   * A legacy record's Notion page URL with no page id beside it. Enough for a teaser to link, never enough
   * for a publish to update in place, so publish refuses rather than creating a second page.
   */
  readonly linkOnlyPageUrl?: string | undefined;
}

/**
 * The standing gap questions every proposal resolves with its stakeholder before a draft exists.
 *
 * Six, and each maps to something the FORM will demand later: the audience and the ask decide the TL;DR, the
 * anchors decide the evidence table, the claims decide which figures need a frozen link, and the shots
 * decide whether there is a hero. A question here that nothing downstream needs would be ceremony.
 */
export const GAP_QUESTIONS: readonly (readonly [string, string])[] = [
  ["audience", "Who reads this, and who actually decides? Name the stakeholder it is addressed to."],
  ["ask", "What is the one concrete ask or decision you need from them?"],
  ["posture", "Are you asking for shaping input, or for a decision to approve or reject?"],
  ["anchors", "What are the one to three anchors this rests on: the problem, the data point, the fix?"],
  ["claims", "Which numbers need a frozen citation before this can publish?"],
  ["shots", "Which proof shots are needed, hero and inline, and are they captured and hosted yet?"],
];

/**
 * Derive a stable, filename-safe id from a brief.
 *
 * Deterministic given the same brief and instant, and deliberately readable: this id names the proposal in
 * every later command, so `nightly-failure-reproducible-k3f9x` is worth the extra characters over a digest.
 *
 * @param brief what the proposal is about, in a sentence
 * @param now the instant the intake was opened, whose milliseconds disambiguate two same-day briefs
 * @returns the slug
 */
export function intakeId({ brief, now }: { brief: string; now: Date }): string {
  const slug = brief
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .split("-")
    .filter((word) => word.length > 0)
    .slice(0, 5)
    .join("-");
  const suffix = now.getTime().toString(36).slice(-5);
  return `${slug.length === 0 ? "proposal" : slug}-${suffix}`;
}

/**
 * Build a fresh intake: the brief, plus every gap question, unanswered and blocking.
 *
 * @param id the stable local id
 * @param brief what the proposal is about
 * @param now the instant the intake was opened
 * @returns the new record
 */
export function deriveIntake({ id, brief, now }: { id: string; brief: string; now: Date }): ProposalIntake {
  return {
    brief,
    createdIso: now.toISOString(),
    id,
    questions: GAP_QUESTIONS.map(([key, question]) => ({ blocking: true, key, question })),
    status: "intake",
  };
}

/** What a re-seed did to an intake that was already there. */
export interface IntakeMerge {
  readonly intake: ProposalIntake;
  /** Answers carried across from the stored record. */
  readonly keptAnswers: number;
  /** Questions the derivation declares that the stored record did not have. */
  readonly addedQuestions: number;
  /**
   * Stored questions no derived slot claimed: one the standing set no longer asks, one an operator added,
   * or a second copy of a standing key. Each is kept verbatim.
   */
  readonly carriedQuestions: number;
  /** Whether the brief the caller passed differs from the stored one. */
  readonly briefChanged: boolean;
}

/**
 * Fold a fresh derivation into the intake already on disk, so re-seeding never destroys an answer.
 *
 * The rule in one sentence: **the derivation owns the question WORDING, the stored record owns everything an
 * operator can have written, and nothing is ever deleted.** Re-running `proposal intake` with the same id is
 * how an operator re-reads the questions, and the verb's own advice is to hand-edit the record — so a
 * re-seed that replaced the file cost one real run its six stakeholder answers. That is the
 * behaviour this function ends.
 *
 * "Nothing is ever deleted" is literal, and it is why a stored question is consumed by INDEX rather than by
 * key: at most one stored question fills each derived slot, and every stored question left over is carried.
 * Matching on key alone loses a DUPLICATE of a standing key — it loses the first-wins race and is then
 * excluded from what is carried, taking its answer with it — which is this same defect at a smaller scale.
 *
 * `blocking` comes from the STORED record for a shared key, because `deriveIntake` writes `true` on every
 * standing question unconditionally: a `false` on disk can only ever be an operator's deliberate edit, so
 * taking the derived value would revert it rather than protect canon from drift. The wording still comes
 * from the derivation, so an improved standing question does reach an open intake. The residue: if
 * `GAP_QUESTIONS` ever declares a standing question non-blocking, an older record's `true` wins until
 * someone edits the file.
 *
 * Three things survive from the stored record because a re-seed is not a new intake: `createdIso` (when the
 * intake was OPENED), `status` (a re-seed is not an unpublish), and `address`/`linkOnlyPageUrl` (the
 * intake is the proposal's identity across a re-publish, so dropping them would make the next publish create
 * a SECOND artifact). The brief is the one field the caller updates, since no question is derived from its text.
 *
 * A question the derivation no longer declares is KEPT rather than dropped — an operator may add their own,
 * and a retired gap question may already carry an answer. The stated cost is that a retired blocking
 * question stays blocking until someone edits the file, which is a visible state a vanished answer is not.
 *
 * The id comes from the DERIVATION, not from the stored record, and that is load-bearing rather than
 * cosmetic: `saveIntake` paths off `intake.id`, so a hand-edited record whose `id` field disagrees with its
 * own filename would otherwise be read from one path and written to another, leaving the original untouched
 * and a stray second file behind.
 *
 * @param existing the record already on disk
 * @param fresh a `deriveIntake` result for the same id, carrying the caller's brief
 * @returns the merged record, and what the merge did to it
 */
export function mergeIntake({ existing, fresh }: { existing: ProposalIntake; fresh: ProposalIntake }): IntakeMerge {
  const firstOfKey = new Map<string, { readonly index: number; readonly question: IntakeQuestion }>();
  existing.questions.forEach((question, index) => {
    if (!firstOfKey.has(question.key)) {
      firstOfKey.set(question.key, { index, question });
    }
  });
  const consumed = new Set<number>();
  let keptAnswers = 0;
  let addedQuestions = 0;
  const derived = fresh.questions.map((question): IntakeQuestion => {
    const match = firstOfKey.get(question.key);
    if (match === undefined) {
      addedQuestions += 1;
      return question;
    }
    consumed.add(match.index);
    const previous = match.question;
    if (isAnswered({ question: previous })) {
      keptAnswers += 1;
    }
    const merged = { ...question, blocking: previous.blocking };
    if (previous.answer === undefined) {
      return merged;
    }
    return { ...merged, answer: previous.answer };
  });
  const carried = existing.questions.filter((_question, index) => !consumed.has(index));
  return {
    addedQuestions,
    briefChanged: existing.brief !== fresh.brief,
    carriedQuestions: carried.length,
    intake: { ...existing, brief: fresh.brief, id: fresh.id, questions: [...derived, ...carried] },
    keptAnswers,
  };
}

/**
 * Whether a question has a real answer.
 *
 * A missing answer and a whitespace-only one are the same state — nothing has been settled — so this names
 * that state once rather than coalescing `undefined` into an empty string at each call site.
 *
 * @param question the gap question
 * @returns true when someone has actually answered it
 */
function isAnswered({ question }: { question: IntakeQuestion }): boolean {
  return question.answer !== undefined && question.answer.trim().length > 0;
}

/**
 * The blocking questions still without an answer.
 *
 * @param intake the record
 * @returns every blocking question whose answer is missing or blank
 */
export function blockingUnanswered({ intake }: { intake: ProposalIntake }): readonly IntakeQuestion[] {
  return intake.questions.filter((question) => question.blocking && !isAnswered({ question }));
}

/**
 * Whether the intake may advance to a draft.
 *
 * @param intake the record
 * @returns true when no blocking question is unanswered
 */
export function canAdvance({ intake }: { intake: ProposalIntake }): boolean {
  return blockingUnanswered({ intake }).length === 0;
}

/**
 * The operator-facing view of an intake: what was asked, and what has been answered.
 *
 * @param intake the record
 * @returns the lines to print
 */
export function intakeLines({ intake }: { intake: ProposalIntake }): readonly string[] {
  return [
    `intake ${intake.id}  (${intake.status})`,
    `brief: ${intake.brief}`,
    ...intake.questions.map((question) =>
      isAnswered({ question })
        ? `  [answered] ${question.key}: ${question.answer!.trim()}`
        : `  [OPEN] ${question.key}: ${question.question}`,
    ),
  ];
}
