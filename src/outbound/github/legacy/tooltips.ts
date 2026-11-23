/**
 * The badge hovers, in both badge-row shapes, and the exact inverse of every one that carries a fact the
 * sections do not.
 *
 * The `plain` row is what every write renders. Two badges,
 * risk first with one plain why-line, then the problem's freshness ("last seen" and a short day), with the one
 * evidence line on hover. Proof has no badge of its own: it is an input to the risk level, and no grade or gap
 * count appears on a badge or a hover, because "what do you mean solved, and if you solved it why is it not gold"
 * is what a reader makes of one.
 *
 * The `withSolved` row is the three-badge row every body carried before that (`meaning · derivation · watch out for`
 * tooltips, a `solved` badge holding the review). It is read, and re-rendered byte for byte for the parse's
 * comparison, so a live body written in it stays editable; nothing writes it new.
 *
 * The problem hover is where the door's `writtenOn` stamp and the problem's seen day live, in both shapes. The
 * review lives in the legacy solved tooltip, or in the plain row's invisible review comment. Template and inverse
 * sit side by side in this one file so they cannot drift apart; `./parse.ts` still re-renders and compares bytes,
 * so an inverse that read something the template never wrote would be caught there.
 */
import { isOneOf } from "#lib/parsers.js";
import { isoOfLongDay, longDay, shortDay } from "../days.js";
import type { IsoDay, ProblemSeen, Review, ReviewGrade } from "./types.js";

/** Which badge row a body carries: `plain` for anything written, `withSolved` only to re-render a body read in it. */
export type BadgeRowShape = "plain" | "withSolved";

/** Every grade a review can carry. */
const REVIEW_GRADES: readonly ReviewGrade[] = ["gold", "silver", "bronze", "unproven"];

/** `n thing` or `n things`. */
function counted({ n, one, many }: { n: number; one: string; many: string }): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** Text as a hover ends it: with its own terminal punctuation, or a full stop added. */
function asSentence({ text }: { text: string }): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The first sentence of some plain text, which is what a hover has room for.
 *
 * @param text the plain text, already stripped of markup
 * @returns up to and including the first `.`, `!` or `?` followed by a space or the end; the whole text otherwise
 */
function firstSentence({ text }: { text: string }): string {
  const trimmed = text.trim();
  const end = /[.!?](?=\s|$)/.exec(trimmed);
  return end === null ? trimmed : trimmed.slice(0, end.index + 1);
}

/** What the proof behind a body did to its risk level, in the plain row. */
export type RiskProof =
  | { readonly kind: "proven"; readonly lowered: boolean }
  | { readonly kind: "failed" }
  | { readonly kind: "unchecked" }
  | { readonly kind: "untested" }
  | { readonly kind: "nothing-tested" };

/** The plain sentence each proof state reads as: what was tested, never a count or a grade. */
function proofSentence({ proof }: { proof: RiskProof }): string {
  const held = "so it reads no lower than the worst case.";
  switch (proof.kind) {
    case "proven":
      return proof.lowered
        ? "Every risk has a check behind it and every claim below was tested, so it reads one step lower than the worst case alone."
        : "Every risk has a check behind it and every claim below was tested.";
    case "failed":
      return `A claim below failed when it was tested, ${held}`;
    case "unchecked":
      return `Some risks have no check behind them yet, ${held}`;
    case "untested":
      return `Some claims below were not tested yet, ${held}`;
    case "nothing-tested":
      return `Nothing below says what was tested, ${held}`;
  }
}

/**
 * The plain risk hover: where the change reaches, the worst case, and what the proof did to the level.
 *
 * @param reach the Blast radius cell as plain text
 * @param worst the top risk item's worst case as plain text
 * @param proof what the proof did to the level
 * @returns the hover text, unescaped
 */
export function plainRiskHover({ reach, worst, proof }: { reach: string; worst: string; proof: RiskProof }): string {
  return `Reaches: ${asSentence({ text: reach })} Worst case: ${asSentence({ text: worst })} ${proofSentence({ proof })}`;
}

/**
 * The plain problem badge: its message and its hover, which carries the two days a read-back recovers.
 *
 * @param seen the problem's seen state
 * @param writtenOn the day the door stamped the body
 * @param stale whether the seen day is older than the badge's freshness window
 * @param evidence the Before-and-after problem evidence as plain text, when there is any
 * @param problem the Problem cell as plain text
 * @returns the badge message and the hover text, unescaped
 */
export function plainProblemBadge({
  seen,
  writtenOn,
  stale,
  evidence,
  problem,
}: {
  seen: ProblemSeen;
  writtenOn: IsoDay;
  stale: boolean;
  evidence: string;
  problem: string;
}): { message: string; tooltip: string } {
  const written = longDay({ day: writtenOn });
  if (seen.kind === "unevidenced") {
    const what = firstSentence({ text: problem });
    const tail = what.length === 0 ? "" : ` ${what}`;
    return { message: "no evidence yet", tooltip: `No evidence yet that this happens, written up ${written}.${tail}` };
  }
  const check = stale ? ", so check it still happens" : "";
  const line = firstSentence({ text: evidence });
  const tail = line.length === 0 ? "" : ` ${line}`;
  return {
    message: `last seen ${shortDay({ day: seen.on })}`,
    tooltip: `Last seen ${longDay({ day: seen.on })}, written up ${written}${check}.${tail}`,
  };
}

/** One long day as the plain hover prints it: day, month abbreviation and year. */
const LONG_DAY = "(\\d{1,2} [A-Z][a-z]{2} \\d{4})";

/** The inverse of {@link plainProblemBadge}'s seen hover. */
const PLAIN_SEEN = new RegExp(`^Last seen ${LONG_DAY}, written up ${LONG_DAY}(?:, so check it still happens)?\\.`, "u");

/** The inverse of {@link plainProblemBadge}'s no-evidence hover. */
const PLAIN_NONE = new RegExp(`^No evidence yet that this happens, written up ${LONG_DAY}\\.`, "u");

/**
 * Recover the seen state and the write stamp from a plain problem hover. Only the two days are read: the rest
 * is derived from the body, and the parse's byte comparison checks it.
 *
 * @param text the decoded hover
 * @returns both facts, or undefined when the text is neither template or a day is not real
 */
export function readPlainProblemHover({
  text,
}: {
  text: string;
}): { problemSeen: ProblemSeen; writtenOn: IsoDay } | undefined {
  const seen = PLAIN_SEEN.exec(text);
  if (seen !== null) {
    const on = isoOfLongDay({ text: seen[1]! });
    const writtenOn = isoOfLongDay({ text: seen[2]! });
    return on === undefined || writtenOn === undefined ? undefined : { problemSeen: { kind: "seen", on }, writtenOn };
  }
  const none = PLAIN_NONE.exec(text);
  const writtenOn = none === null ? undefined : isoOfLongDay({ text: none[1]! });
  return writtenOn === undefined ? undefined : { problemSeen: { kind: "unevidenced" }, writtenOn };
}

/** The opening and close of the plain row's review comment, which no reader sees. */
export const REVIEW_OPEN = "<!-- slopweaver-review ";
const REVIEW_CLOSE = " -->";

/**
 * The plain row's review, as an HTML comment GitHub does not render: the gold anchor's CI check and `gold owe`
 * still read the grade, and no reader is shown one. Every `-` is written as a JSON `-` escape, so the
 * comment can never hold the `--` that would end it early.
 *
 * @param review the reviewer's verdict
 * @returns the comment
 */
export function reviewComment({ review }: { review: Review }): string {
  const json = JSON.stringify({ grade: review.grade, reviewer: review.reviewer, why: review.why });
  return `${REVIEW_OPEN}${json.replaceAll("-", "\\u002d")}${REVIEW_CLOSE}`;
}

/**
 * The inverse of {@link reviewComment}.
 *
 * @param text the comment, exactly as written
 * @returns the review, or undefined when the text is not one
 */
export function readReviewComment({ text }: { text: string }): Review | undefined {
  if (!text.startsWith(REVIEW_OPEN) || !text.endsWith(REVIEW_CLOSE)) {
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.slice(REVIEW_OPEN.length, -REVIEW_CLOSE.length));
  } catch {
    return undefined;
  }
  // Structure only: `./parse.ts` decodes the recovered body through the stamped-body schema, review included.
  if (typeof decoded !== "object" || decoded === null || !("grade" in decoded)) {
    return undefined;
  }
  if (!("reviewer" in decoded) || !("why" in decoded)) {
    return undefined;
  }
  const { grade, reviewer, why } = decoded;
  if (typeof grade !== "string" || !isOneOf(grade, REVIEW_GRADES)) {
    return undefined;
  }
  return typeof reviewer === "string" && typeof why === "string" ? { grade, reviewer, why } : undefined;
}

/**
 * The legacy risk badge tooltip.
 *
 * @param top the top item's priority
 * @param unchecked how many P0-P3 items carry no check
 * @param atRisk how many items are P0-P3 at all
 * @param noneChecked whether no item at any priority carries a check; it rewords the derivation only when no
 * item sits at P0-P3, so every tooltip a P0-P3 item already shaped keeps its exact bytes and its body still parses
 * @returns the tooltip text, unescaped
 */
export function riskTooltip({
  top,
  unchecked,
  atRisk,
  noneChecked,
}: {
  top: number;
  unchecked: number;
  atRisk: number;
  noneChecked: boolean;
}): string {
  const verb = unchecked === 1 ? "has" : "have";
  let derivation = `${String(unchecked)} of ${counted({ many: "items", n: atRisk, one: "item" })} at P0-P3 ${verb} no check`;
  if (noneChecked && atRisk === 0) {
    derivation = "no item at any priority has a check";
  }
  return `Risk if this merges · top item P${String(top)}; ${derivation} · an item with no check is a guess, not a finding`;
}

/** The opening every problem tooltip shares. */
const PROBLEM_MEANING = "When the problem was last seen";

/**
 * The problem badge tooltip — always carrying `written YYYY-MM-DD`, from which a read-back recovers the stamp.
 *
 * @param seen the problem's seen state
 * @param writtenOn the day the door stamped the body
 * @param days whole UTC days from the seen day to the write day; ignored when unevidenced
 * @returns the tooltip text, unescaped
 */
export function problemTooltip({
  seen,
  writtenOn,
  days,
}: {
  seen: ProblemSeen;
  writtenOn: IsoDay;
  days: number;
}): string {
  if (seen.kind === "unevidenced") {
    return `${PROBLEM_MEANING} · no evidence, written ${writtenOn} · an assertion, not an observation`;
  }
  return (
    `${PROBLEM_MEANING} · seen ${seen.on}, written ${writtenOn}, ${counted({ many: "days", n: days, one: "day" })} ` +
    "apart; green within 15 (Datadog retention) · older evidence may have rotated out"
  );
}

/** The inverse of {@link problemTooltip}'s seen template. */
const PROBLEM_SEEN =
  /^When the problem was last seen · seen (\d{4}-\d{2}-\d{2}), written (\d{4}-\d{2}-\d{2}), \d+ days? apart; green within 15 \(Datadog retention\) · older evidence may have rotated out$/;

/** The inverse of {@link problemTooltip}'s unevidenced template. */
const PROBLEM_UNEVIDENCED =
  /^When the problem was last seen · no evidence, written (\d{4}-\d{2}-\d{2}) · an assertion, not an observation$/;

/**
 * Recover the seen state and the write stamp from a problem tooltip.
 *
 * @param text the decoded tooltip
 * @returns both facts, or undefined when the text is not one of the two templates
 */
export function readProblemTooltip({
  text,
}: {
  text: string;
}): { problemSeen: ProblemSeen; writtenOn: IsoDay } | undefined {
  const seen = PROBLEM_SEEN.exec(text);
  if (seen !== null) {
    return { problemSeen: { kind: "seen", on: seen[1]! }, writtenOn: seen[2]! };
  }
  const unevidenced = PROBLEM_UNEVIDENCED.exec(text);
  if (unevidenced !== null) {
    return { problemSeen: { kind: "unevidenced" }, writtenOn: unevidenced[1]! };
  }
  return undefined;
}

/**
 * The solved badge tooltip, carrying the review whole so a read-back recovers it.
 *
 * @param review the reviewer's verdict, absent until somebody gives one
 * @param gaps how many claim rows are gaps
 * @returns the tooltip text, unescaped
 */
export function solvedTooltip({ review, gaps }: { review: Review | undefined; gaps: number }): string {
  const verdict = review === undefined ? "not yet reviewed" : `${review.grade} by ${review.reviewer}: ${review.why}`;
  return (
    `Reviewer verdict on the claims · ${verdict}; ${counted({ many: "gaps", n: gaps, one: "gap" })} · ` +
    "a gap is a claim nobody checked"
  );
}

/**
 * The inverse of {@link solvedTooltip}. The reviewer is lazy and the reason greedy: the schema refuses `: ` in
 * a reviewer, so the first `: ` ends it, and the template's own `; n gaps · …` tail ends the reason.
 */
const SOLVED =
  /^Reviewer verdict on the claims · (?:not yet reviewed|(gold|silver|bronze|unproven) by (.+?): (.+)); \d+ gaps? · a gap is a claim nobody checked$/;

/**
 * Recover the review from a solved tooltip.
 *
 * @param text the decoded tooltip
 * @returns the review, or `review: undefined` for "not yet reviewed"; undefined when the text is not the template
 */
export function readSolvedTooltip({ text }: { text: string }): { review: Review | undefined } | undefined {
  const match = SOLVED.exec(text);
  if (match === null) {
    return undefined;
  }
  const grade = match[1];
  if (grade === undefined) {
    return { review: undefined };
  }
  // The capture is regex-constrained to exactly these four, so `isOneOf` proves and narrows it with no cast.
  if (!isOneOf(grade, REVIEW_GRADES)) {
    return undefined;
  }
  return { review: { grade, reviewer: match[2]!, why: match[3]! } };
}
