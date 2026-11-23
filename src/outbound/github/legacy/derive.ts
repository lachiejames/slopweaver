/**
 * The three badges, DERIVED — never authored. Pure: no clock, no I/O.
 *
 * A badge an author types can disagree with the section under it, and the reader meets the badge first. So
 * each one is a function of the section it links to: risk from the ranked items, problem from the seen day
 * against the day the door stamped the body, solved from the claim rows and the reviewer's grade. The bold
 * `Risk: …` line comes from the same function as the risk badge, for the same reason.
 *
 * The one ruling worth stating here (relayed, P2 plan): a body nobody has reviewed shows solved `unproven`
 * in red. There is no grey "unreviewed" state — an unreviewed claim is shown unproven where none proves it.
 */
import { err, ok, type Result } from "#lib/result.js";
import { daysBetween, shortDay, utcMidnightOf } from "../days.js";
import { type ReadingOrderError, ReadingOrderErrors } from "./errors.js";
import {
  plainProblemBadge,
  plainRiskHover,
  problemTooltip,
  type RiskProof,
  riskTooltip,
  solvedTooltip,
} from "./tooltips.js";
import type {
  Claim,
  Content,
  EvidenceContent,
  IsoDay,
  Level,
  PrForm,
  PrFormDraft,
  Priority,
  ProblemSeen,
  Review,
  ReviewGrade,
  RiskItem,
} from "./types.js";

/** Red: a P0/P1 risk, an unevidenced problem, an unproven solve. */
const RED = "d73a49";
/** Amber: a P2 risk, an unchecked P0-P3 one or a list with no check at all, a problem last seen over 15 days before the write. */
const AMBER = "dbab09";
/** Green: a P3/P4 risk with at least one check and none missing at P0-P3, a problem seen within 15 days. */
const GREEN = "2ea44f";

/** The colour each review grade shows in, matching the retired proof badge's colours. */
const GRADE_COLOR: Readonly<Record<ReviewGrade, string>> = {
  bronze: "cd7f32",
  gold: "ffd700",
  silver: "9ea7ad",
  unproven: RED,
};

/** The longest gap, in whole UTC days, a seen problem stays green — Datadog's retention window. */
const SEEN_FRESH_DAYS = 15;

/** What one badge shows: its message, colour and tooltip. */
export interface BadgeVerdict {
  readonly message: string;
  readonly color: string;
  readonly tooltip: string;
}

/** The risk badge plus the facts the bold line and the tooltip are built from. */
export interface RiskVerdict extends BadgeVerdict {
  readonly level: Level;
  readonly top: Priority;
  /** P0-P3 items with no check; a P4 item is never counted. */
  readonly unchecked: number;
  /** The bold verdict that opens the risk section: `Risk: medium, 1 unchecked.` */
  readonly line: string;
}

/** The level a top priority implies. */
function levelOf({ top }: { top: Priority }): Level {
  if (top <= 1) {
    return "high";
  }
  return top === 2 ? "medium" : "low";
}

/**
 * The risk badge: the top item decides the level, and an unchecked P0-P3 item turns a non-red badge amber.
 *
 * So does a list where NO item carries a check, at any priority: an all-P4 list with nothing checked would
 * otherwise show a green "low" with no check behind it, and a risk with no check says so rather than asserting low.
 *
 * Refuses an empty list and one ranked out of order, because "the top item" means nothing otherwise.
 *
 * @param items the ranked risk items, most urgent first
 * @returns the verdict, or a typed refusal
 */
export function riskVerdict({ items }: { items: readonly RiskItem[] }): Result<RiskVerdict, ReadingOrderError> {
  const first = items[0];
  if (first === undefined) {
    return err(ReadingOrderErrors.riskUnranked({ detail: "there are none; name at least one" }));
  }
  const outOfOrder = items.findIndex((item, index) => index > 0 && item.priority < items[index - 1]!.priority);
  if (outOfOrder > 0) {
    return err(
      ReadingOrderErrors.riskUnranked({
        detail:
          `item ${String(outOfOrder + 1)} is P${String(items[outOfOrder]!.priority)} after ` +
          `P${String(items[outOfOrder - 1]!.priority)}; rank them so priority never decreases`,
      }),
    );
  }
  const top = first.priority;
  const level = levelOf({ top });
  const atRisk = items.filter((item) => item.priority <= 3);
  const unchecked = atRisk.filter((item) => item.check.kind === "unchecked").length;
  const noneChecked = items.every((item) => item.check.kind === "unchecked");
  const tooltip = riskTooltip({ atRisk: atRisk.length, noneChecked, top, unchecked });
  let suffix = "";
  if (unchecked > 0) {
    suffix = `, ${String(unchecked)} unchecked`;
  } else if (noneChecked) {
    suffix = ", none checked";
  }
  const line = `Risk: ${level}${suffix}.`;
  const base = { level, line, tooltip, top, unchecked };
  if (level === "high") {
    return ok({ ...base, color: RED, message: "high" });
  }
  if (unchecked > 0 || noneChecked) {
    return ok({ ...base, color: AMBER, message: "unchecked" });
  }
  return ok({ ...base, color: level === "medium" ? AMBER : GREEN, message: level });
}

/**
 * Plain text of a cell, as a hover carries it: every run's text, pictures dropped.
 *
 * @param content the runs
 * @returns their text joined
 */
function plainTextOf({ content }: { content: EvidenceContent }): string {
  return content.map((run) => (run.kind === "image" ? "" : run.text)).join("");
}

/** One level lower, never below low: proof moves a level by one step at most. */
function stepDown({ level }: { level: Level }): Level {
  if (level === "high") {
    return "medium";
  }
  return "low";
}

/**
 * What the proof behind a body says about its risk, before any step is taken.
 *
 * Failed first, because a claim that broke under test outweighs every other fact; then a risk with no check, at
 * ANY priority, so the hover's "every risk has a check behind it" is literally true when it is shown; then an
 * empty claims list, then a claim nobody tested. Only a body with every one of those clear is `proven`. The form
 * cannot tie a claim to the risk it tests, so a check here is the author's word that one ran, judged by a reader.
 *
 * @param items the ranked risk items
 * @param claims the claim rows
 * @returns the proof state, `lowered: false` until the caller knows whether a step was taken
 */
function riskProofOf({ items, claims }: { items: readonly RiskItem[]; claims: readonly Claim[] }): RiskProof {
  if (claims.some((claim) => claim.proof.kind === "failed")) {
    return { kind: "failed" };
  }
  if (items.some((item) => item.check.kind === "unchecked")) {
    return { kind: "unchecked" };
  }
  if (claims.length === 0) {
    return { kind: "nothing-tested" };
  }
  if (claims.some((claim) => claim.proof.kind === "gap")) {
    return { kind: "untested" };
  }
  return { kind: "proven", lowered: false };
}

/**
 * The risk badge every write renders: the legacy derivation, then the proof as an input to the level.
 *
 * Proof is one factor in the risk badge: a scary problem with the best possible proof
 * reads MEDIUM, not low, while code that is tested well enough can read LOW. Read here as ONE step down when
 * every risk carries a check and every claim was tested: a P0/P1 item reads medium at best, a P2 item tested
 * well reads low. Never two steps, so proof cannot talk a serious worst case down to low.
 *
 * @param items the ranked risk items, most urgent first
 * @param claims the claim rows, whose proof is the level's second input
 * @param blastRadius the Blast radius cell, which the hover leads with
 * @returns the verdict, or the same typed refusal the legacy derivation gives
 */
export function plainRiskVerdict({
  items,
  claims,
  blastRadius,
}: {
  items: readonly RiskItem[];
  claims: readonly Claim[];
  blastRadius: Content;
}): Result<RiskVerdict, ReadingOrderError> {
  return riskVerdict({ items }).map((base) => {
    const proof = riskProofOf({ claims, items });
    const level = proof.kind === "proven" ? stepDown({ level: base.level }) : base.level;
    const shown: RiskProof = proof.kind === "proven" ? { kind: "proven", lowered: level !== base.level } : proof;
    const tooltip = plainRiskHover({
      proof: shown,
      reach: plainTextOf({ content: blastRadius }),
      worst: plainTextOf({ content: items[0]!.worst }),
    });
    const line = base.line.replace(`Risk: ${base.level}`, `Risk: ${level}`);
    const verdict = { level, line, tooltip, top: base.top, unchecked: base.unchecked };
    if (level === "high") {
      return { ...verdict, color: RED, message: "high" };
    }
    if (base.message === "unchecked") {
      return { ...verdict, color: AMBER, message: "unchecked" };
    }
    return { ...verdict, color: level === "medium" ? AMBER : GREEN, message: level };
  });
}

/**
 * The problem badge every write renders: "last seen" and a short day, with the evidence line on hover, or "no evidence yet".
 *
 * The colour and the refusals are the legacy derivation's; only the words change. A problem nobody can reproduce
 * on demand (a transient error in prod) is still `seen` on the day it was last observed, with what was observed
 * as its evidence: nothing here claims a reproduction.
 *
 * @param seen the problem's seen state
 * @param writtenOn the day the door stamped the body
 * @param evidence the Before-and-after problem evidence, when the body has the table
 * @param problem the Problem cell, which the no-evidence hover quotes
 * @returns the verdict, or a refusal naming a malformed day or a seen day after the write
 */
export function plainProblemStatus({
  seen,
  writtenOn,
  evidence,
  problem,
}: {
  seen: ProblemSeen;
  writtenOn: IsoDay;
  evidence: EvidenceContent | undefined;
  problem: Content;
}): Result<BadgeVerdict, ReadingOrderError> {
  return problemStatus({ seen, writtenOn }).map(({ color }) => ({
    color,
    ...plainProblemBadge({
      evidence: evidence === undefined ? "" : plainTextOf({ content: evidence }),
      problem: plainTextOf({ content: problem }),
      seen,
      stale: seen.kind === "seen" && color === AMBER,
      writtenOn,
    }),
  }));
}

/**
 * The problem badge: when the problem was last seen, measured against the day the body was written.
 *
 * @param seen the problem's seen state
 * @param writtenOn the day the door stamped the body
 * @returns the verdict, or a refusal naming a malformed day or a seen day after the write
 */
export function problemStatus({
  seen,
  writtenOn,
}: {
  seen: ProblemSeen;
  writtenOn: IsoDay;
}): Result<BadgeVerdict, ReadingOrderError> {
  const written = utcMidnightOf({ day: writtenOn });
  if (written === undefined) {
    return err(ReadingOrderErrors.invalidDay({ field: "writtenOn", value: writtenOn }));
  }
  if (seen.kind === "unevidenced") {
    return ok({ color: RED, message: "unevidenced", tooltip: problemTooltip({ days: 0, seen, writtenOn }) });
  }
  const on = utcMidnightOf({ day: seen.on });
  if (on === undefined) {
    return err(ReadingOrderErrors.invalidDay({ field: "problemSeen.on", value: seen.on }));
  }
  const days = daysBetween({ from: on, to: written });
  if (days < 0) {
    return err(ReadingOrderErrors.seenAfterWritten({ on: seen.on, writtenOn }));
  }
  const tooltip = problemTooltip({ days, seen, writtenOn });
  if (days <= SEEN_FRESH_DAYS) {
    return ok({ color: GREEN, message: `seen ${shortDay({ day: seen.on })}`, tooltip });
  }
  return ok({ color: AMBER, message: `last seen ${shortDay({ day: seen.on })}`, tooltip });
}

/** The solved badge plus the grade it shows and the gap count behind its suffix. */
export interface SolvedVerdict extends BadgeVerdict {
  readonly shown: ReviewGrade;
  readonly gaps: number;
}

/**
 * Whether the claims can carry any grade at all: there is at least one, and none failed.
 *
 * @param claims the claim rows
 * @returns false when the mechanical floor pins the solved badge to unproven
 */
function claimsClearFloor({ claims }: { claims: readonly Claim[] }): boolean {
  return claims.length > 0 && claims.every((claim) => claim.proof.kind !== "failed");
}

/**
 * The solved badge: unproven red when nothing is claimed, a claim failed or nobody reviewed; otherwise the
 * reviewer's grade. A ` · n gaps` suffix counts the claims nobody checked.
 *
 * @param claims the claim rows
 * @param review the reviewer's verdict, absent until somebody gives one
 * @returns the verdict
 */
export function solvedVerdict({
  claims,
  review,
}: {
  claims: readonly Claim[];
  review: Review | undefined;
}): SolvedVerdict {
  const gaps = claims.filter((claim) => claim.proof.kind === "gap").length;
  const shown: ReviewGrade = claimsClearFloor({ claims }) && review !== undefined ? review.grade : "unproven";
  const suffix = gaps > 0 ? ` · ${String(gaps)} ${gaps === 1 ? "gap" : "gaps"}` : "";
  return {
    color: GRADE_COLOR[shown],
    gaps,
    message: `${shown}${suffix}`,
    shown,
    tooltip: solvedTooltip({ gaps, review }),
  };
}

/**
 * Stamp a draft with the UTC day the door wrote it. The day is an argument, never read from a clock here.
 *
 * @param draft the caller's validated draft
 * @param writtenOn the door's UTC day
 * @returns the stamped form, or a refusal when the day is malformed or the problem is seen after it
 * @internal — exported for its unit test
 */
export function stampPrForm({
  draft,
  writtenOn,
}: {
  draft: PrFormDraft;
  writtenOn: IsoDay;
}): Result<PrForm, ReadingOrderError> {
  return problemStatus({ seen: draft.problemSeen, writtenOn }).map(() => ({ ...draft, writtenOn }));
}
