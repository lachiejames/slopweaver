/**
 * A row's authored RECOMMENDATION SET — parsed, checked, and matched against what actually fired. PURE.
 *
 * The card side is `outbound/artifact/recommendations.ts`; this is the author side, shared by both verbs that
 * carry the lane (`datadog alert-digest`, `slack alert-summary`) and by both recipe kinds that pass it through.
 * A team's daily post names the act that would clear each finding. The acts are written by a
 * visible session onto the row, because nothing on a clock may compose one (rule 2); what runs unattended is
 * only the selection below, which is arithmetic over keys.
 *
 * ## Why selection happens in the verb and not on the card
 *
 * The key a recommendation names is only in hand where the finding was measured: a digest's probe `id` is gone
 * by the time `readingToDigestItem` has built the card's item, and an alert's stable name has been condensed,
 * bounded and folded by the time a summary row carries it. So the verb matches, and the card receives only the
 * severity it should colour the line with.
 *
 * ## A drop is always reported
 *
 * A recommendation that was not selected comes back in `dropped` with its reason. A mistyped alert name reads
 * exactly like "did not fire" on any one day, and the only way to find one is a report that lists it every day.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import {
  RECOMMENDATION_OPPORTUNITIES_MAX,
  RECOMMENDATIONS_MAX,
  type RecommendationAuthored,
  type RecommendationForm,
  recommendationAuthorSchema,
} from "../../outbound/artifact/recommendations.js";
import type { Severity } from "../../outbound/artifact/severity.js";

/** How many recommendations one row may declare — enough for a finding act per table row plus opportunities. */
export const RECOMMENDATION_SET_MAX = 20;

/** How many of the card's places are HELD for an opportunity when the row authored one. */
const RECOMMENDATION_OPPORTUNITY_SLOT = 1;

/** The document a row or a `--recommendations` flag carries. */
const recommendationSetSchema = z
  .object({ recommendations: z.array(recommendationAuthorSchema).min(1).max(RECOMMENDATION_SET_MAX) })
  .strict();

/** A parsed recommendation set. */
export type RecommendationSet = z.infer<typeof recommendationSetSchema>;

/** The `--recommendations` document is not JSON, or not a readable file. */
export interface RecommendationDocumentUnreadableError {
  readonly code: "RECOMMENDATION_DOCUMENT_UNREADABLE";
  readonly message: string;
  readonly detail: string;
}

/** The document parsed as JSON but is not a recommendation set. */
export interface RecommendationSetInvalidError {
  readonly code: "RECOMMENDATION_SET_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Every way an authored recommendation set can fail to become one a verb can select from. */
export type RecommendationSetError = RecommendationDocumentUnreadableError | RecommendationSetInvalidError;

/**
 * Construct one {@link RecommendationSetError}. Tests build fixtures through these, never a hand-built literal.
 */
export const RecommendationSetErrors = {
  documentUnreadable: ({ detail }: { readonly detail: string }): RecommendationDocumentUnreadableError => ({
    code: "RECOMMENDATION_DOCUMENT_UNREADABLE",
    detail,
    message: `--recommendations could not be read: ${detail}`,
  }),
  setInvalid: ({ issues }: { readonly issues: readonly string[] }): RecommendationSetInvalidError => ({
    code: "RECOMMENDATION_SET_INVALID",
    issues,
    message: `--recommendations is not a recommendation set: ${issues.join("; ")}`,
  }),
} as const;

/** One zod issue's path, named when it is the root rather than defaulted. */
function issueLine({ issue }: { issue: z.core.$ZodIssue }): string {
  const path = issue.path.map(String).join(".");
  if (path.length === 0) {
    return `recommendations: ${issue.message}`;
  }
  return `${path}: ${issue.message}`;
}

/**
 * Parse a decoded `{ "recommendations": [...] }` document.
 *
 * @param value the decoded JSON
 * @returns the set, or why it is not one
 */
export function parseRecommendationSet({
  value,
}: {
  readonly value: unknown;
}): Result<RecommendationSet, RecommendationSetError> {
  const parsed = recommendationSetSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      RecommendationSetErrors.setInvalid({ issues: parsed.error.issues.map((issue) => issueLine({ issue })) }),
    );
  }
  return ok(parsed.data);
}

/** One finding that fired, by the key a recommendation names it with, in the card's rank order. */
export interface FiredFinding {
  readonly key: string;
  readonly severity: Severity;
}

/** Why a recommendation did not reach the card.
 *
 * @internal — a field of {@link DroppedRecommendation}, which is what a caller reads.
 */
export type RecommendationDropReason = "not-fired-this-window" | "over-cap" | "shed-to-fit" | "clears-unknown";

/** A recommendation that was not selected, and why.
 *
 * @internal — reached through {@link RecommendationSelection}'s `dropped`.
 */
export interface DroppedRecommendation {
  readonly change: string;
  /** The key it named; absent for an opportunity. */
  readonly clears?: string;
  readonly reason: RecommendationDropReason;
}

/** What selection kept, in card order, and what it did not. */
export interface RecommendationSelection {
  readonly kept: readonly RecommendationForm[];
  readonly dropped: readonly DroppedRecommendation[];
}

/**
 * The card's copy of an authored recommendation: the same rendered fields, with `clears` swapped for a colour.
 *
 * Rebuilt field by field rather than spread, so that an optional one added to the shared `renderedFields` and
 * not added here is DROPPED silently — `exactOptionalPropertyTypes` makes the omission type-check. Every
 * rendered field therefore has an assertion in `recommendationSet.test.ts` that reddens when its line goes.
 */
function toForm({
  recommendation,
  finding,
}: {
  recommendation: RecommendationAuthored;
  finding: Severity | undefined;
}): RecommendationForm {
  const { act, change, evidenceUrl, owner, raisedPrUrl, target } = recommendation;
  return {
    act,
    change,
    evidenceUrl,
    ...(finding === undefined ? {} : { finding }),
    ...(owner === undefined ? {} : { owner }),
    ...(raisedPrUrl === undefined ? {} : { raisedPrUrl }),
    ...(target === undefined ? {} : { target }),
  };
}

/**
 * Why a `clears` matched nothing: a TYPO when the vocabulary is closed and does not hold the key, and simply
 * a quiet window otherwise.
 *
 * Told apart because they need different acts from a reader — one is an edit to the row, the other is good
 * news — and because a typo that read as "did not fire" would sit in a daily report forever.
 */
function unmatchedReason({
  clears,
  known,
}: {
  clears: string | undefined;
  known: readonly string[] | undefined;
}): RecommendationDropReason {
  if (known !== undefined && clears !== undefined && !known.includes(clears)) {
    return "clears-unknown";
  }
  return "not-fired-this-window";
}

/** The report entry for a recommendation that was left off. */
function dropOf({
  recommendation,
  reason,
}: {
  recommendation: RecommendationAuthored;
  reason: RecommendationDropReason;
}): DroppedRecommendation {
  if (recommendation.clears === undefined) {
    return { change: recommendation.change, reason };
  }
  return { change: recommendation.change, clears: recommendation.clears, reason };
}

/**
 * Choose which recommendations reach today's card.
 *
 * - A recommendation that clears a finding is kept only when that finding FIRED, ordered by the finding's rank
 *   (several for one finding keep their authored order) and coloured with its severity.
 * - An opportunity is kept in authored order, at most {@link RECOMMENDATION_OPPORTUNITIES_MAX}.
 * - The total is capped at {@link RECOMMENDATIONS_MAX}. Acts outrank opportunities, EXCEPT that one place is
 *   held for an opportunity whenever the row authored any: measured on the payments channel, five findings
 *   fire on an ordinary day, so acts-first alone means the high-leverage half of the brief — surfacing
 *   interesting or high leverage opportunities — never appears at all on the days anyone is reading.
 *
 * @param authored the row's set, in authored order
 * @param fired the findings that fired, in the card's rank order
 * @returns the kept recommendations in card order, and every one that was not
 */
export function selectRecommendations({
  authored,
  fired,
  known,
}: {
  readonly authored: readonly RecommendationAuthored[];
  readonly fired: readonly FiredFinding[];
  readonly known?: readonly string[] | undefined;
}): RecommendationSelection {
  const rank = new Map(fired.map((finding, position) => [finding.key, { position, severity: finding.severity }]));
  const notFired = authored
    .filter((recommendation) => recommendation.clears !== undefined && !rank.has(recommendation.clears))
    .map((recommendation) =>
      dropOf({ reason: unmatchedReason({ clears: recommendation.clears, known }), recommendation }),
    );
  const acts = authored
    .map((recommendation, authoredAt) => {
      if (recommendation.clears === undefined) {
        return undefined;
      }
      const found = rank.get(recommendation.clears);
      if (found === undefined) {
        return undefined;
      }
      return { authoredAt, found, recommendation };
    })
    .filter((entry) => entry !== undefined)
    .toSorted((left, right) => left.found.position - right.found.position || left.authoredAt - right.authoredAt)
    .map(({ recommendation, found }) => ({ finding: found.severity, recommendation }));
  const opportunities = authored
    .filter((recommendation) => recommendation.clears === undefined)
    .map((recommendation) => ({ finding: undefined, recommendation }));
  const openings = opportunities.slice(0, RECOMMENDATION_OPPORTUNITIES_MAX);
  const held = Math.min(openings.length, RECOMMENDATION_OPPORTUNITY_SLOT);
  const keptActs = acts.slice(0, Math.max(RECOMMENDATIONS_MAX - held, 0));
  const keptOpenings = openings.slice(0, RECOMMENDATIONS_MAX - keptActs.length);
  const overCap = [
    ...acts.slice(keptActs.length),
    ...openings.slice(keptOpenings.length),
    ...opportunities.slice(RECOMMENDATION_OPPORTUNITIES_MAX),
  ].map(({ recommendation }) => dropOf({ reason: "over-cap", recommendation }));
  const kept = [...keptActs, ...keptOpenings];
  return {
    dropped: [...notFired, ...overCap],
    kept: kept.map(({ recommendation, finding }) => toForm({ finding, recommendation })),
  };
}

/**
 * Keep the longest head of a selection the card can carry with nothing cut, and report the tail as shed.
 *
 * A digest's own prose is already able to fill its detail cap on a busy day, so recommendations are the part
 * that gives: they go from the TAIL (opportunities before finding acts, the lowest-ranked act first), one at
 * a time, until the card fits. When the card does not fit even with none, every recommendation is shed and
 * the card's own refusal is left exactly as it was — this lane never changes whether a card sends.
 *
 * @param selection what selection kept, in card order
 * @param fits whether a card carrying exactly these recommendations sends with nothing truncated
 * @returns the selection with its kept list shortened to fit, and every shed line reported
 */
export function shedToFit({
  selection,
  fits,
}: {
  readonly selection: RecommendationSelection;
  readonly fits: (kept: readonly RecommendationForm[]) => boolean;
}): RecommendationSelection {
  for (let keep = selection.kept.length; keep > 0; keep -= 1) {
    const head = selection.kept.slice(0, keep);
    if (fits(head)) {
      return withShed({ head, selection });
    }
  }
  return withShed({ head: [], selection });
}

/** The selection with only `head` kept, and the rest reported as shed. */
function withShed({
  selection,
  head,
}: {
  selection: RecommendationSelection;
  head: readonly RecommendationForm[];
}): RecommendationSelection {
  const shed = selection.kept
    .slice(head.length)
    .map((recommendation): DroppedRecommendation => ({ change: recommendation.change, reason: "shed-to-fit" }));
  return { dropped: [...selection.dropped, ...shed], kept: head };
}

/**
 * The human report of a selection: what reached the card, and every line that did not with its reason.
 *
 * Printed by both verbs' text output, so a row author reads the same account whichever card they wrote for.
 *
 * @param selection what the recommendation lane chose
 * @returns the report lines, none when the lane was off
 */
export function recommendationSelectionLines({
  selection,
}: {
  readonly selection: RecommendationSelection;
}): readonly string[] {
  if (selection.kept.length === 0 && selection.dropped.length === 0) {
    return [];
  }
  return [
    "",
    `recommendations: ${String(selection.kept.length)} on the card, ${String(selection.dropped.length)} left off`,
    ...selection.kept.map((recommendation) => `  + ${recommendation.act}: ${recommendation.change}`),
    ...selection.dropped.map((dropped) => `  - ${dropped.reason}: ${dropped.change}`),
  ];
}

/** A row's lane, resolved: the argv word to pass, or the reason the lane is off. */
export interface RecommendationLane {
  /** The document to pass as `--recommendations`; absent when the row declared none, or its set is unusable. */
  readonly document: string | undefined;
  /** Why a declared lane is not being passed. Absent when the row declared none, or its set is fine. */
  readonly problem: string | undefined;
}

/**
 * A recipe row's `params.recommendations`, checked and re-serialised as the ONE argv word its read leg takes.
 *
 * **A set that will not parse turns the LANE off, never the row.** It used to refuse the plan, and a refused
 * plan posts nothing: an adversarial review measured an empty array, a 91-character `change` and an unknown
 * field each costing the whole daily card, unattended, because `planX` runs only inside `automation run-due` and
 * nothing checks a row before then. The card a team is waiting for outranks the recommendations on it, so the
 * problem is REPORTED on the row's outcome line and the findings still post.
 *
 * @param value the row's `params.recommendations`, absent when the row does not turn the lane on
 * @returns the document to pass, or the stated reason the lane is off
 */
export function recommendationsDocumentOf({ value }: { readonly value: unknown }): RecommendationLane {
  if (value === undefined) {
    return { document: undefined, problem: undefined };
  }
  const set = parseRecommendationSet({ value: { recommendations: value } });
  if (set.isErr()) {
    return { document: undefined, problem: `recommendations lane OFF: ${set.error.message}` };
  }
  return { document: JSON.stringify(set.value), problem: undefined };
}

/**
 * The `--recommendations` flag pair, or nothing when the row does not turn the lane on — so a row without it
 * runs with exactly the argv it always did.
 *
 * @param document the recommendation set as one argv word
 * @returns the flag and its value, or no words
 */
export function recommendationsFlagArgs({ document }: { readonly document: string | undefined }): readonly string[] {
  if (document === undefined) {
    return [];
  }
  return ["--recommendations", document];
}

/**
 * The warnings a run states on its DIAGNOSTIC channel: the drops somebody has to edit the row to fix.
 *
 * A shed line and a quiet monitor are ordinary daily outcomes and stay in the report; a key naming nothing
 * the row declares is a mistake, and an unattended run that never said so would hide it forever.
 *
 * @param selection what the recommendation lane chose
 * @returns one line per drop that needs a person, none otherwise
 */
export function recommendationWarnings({
  selection,
}: {
  readonly selection: RecommendationSelection;
}): readonly string[] {
  return selection.dropped
    .filter((dropped) => dropped.reason === "clears-unknown")
    .map(
      (dropped) =>
        `a recommendation clears '${String(dropped.clears)}', which this row declares no probe for, so it can ` +
        `never be shown — fix the key or drop the recommendation: ${dropped.change}`,
    );
}
