/**
 * The badge row a pull-request body opens with, in either of its two shapes, and its reader. Pure.
 *
 * `plain` is what every write renders: risk with the proof folded into its level and a why-line on hover, then
 * the problem's freshness, and a review (when there is one) as a comment no reader sees. `withSolved` is the
 * three-badge row bodies carried before the badges went plain, rendered only so `./parse.ts` can compare an old
 * body byte for byte.
 */
import { ok, type Result } from "#lib/result.js";
import { escapeAttr, imageTag } from "../htmlText.js";
import { decodeAttr } from "../parseContent.js";
import {
  type BadgeVerdict,
  plainProblemStatus,
  plainRiskVerdict,
  problemStatus,
  riskVerdict,
  solvedVerdict,
} from "./derive.js";
import type { ReadingOrderError } from "./errors.js";
import { type Cursor, stop, take } from "./parseCursor.js";
import {
  type BadgeRowShape,
  readPlainProblemHover,
  readProblemTooltip,
  readReviewComment,
  readSolvedTooltip,
  reviewComment,
} from "./tooltips.js";
import type { ProblemSeen, Review, StampedPrBody } from "./types.js";

/**
 * The anchor names the badges jump to. A pull-request body's headings get NO id from GitHub (measured on
 * a pull request's `bodyHTML`: `<h3 dir="auto">Problem</h3>`), so each target heading carries its own
 * `<a name>`, which the sanitiser keeps as `user-content-<name>` and GitHub's page script scrolls `#<name>` to.
 */
export const BADGE_TARGETS = {
  problem: "problem",
  risk: "what-can-go-wrong-if-this-merges",
  solved: "other-claims",
} as const;

/**
 * Encode one shields.io path segment.
 *
 * shields.io uses `-` as its field separator, so a literal `-` is doubled; `_` is doubled because a single
 * `_` means a space in their grammar. Doubling happens BEFORE percent-encoding, which is safe because
 * `encodeURIComponent` leaves `-` and `_` untouched.
 *
 * @param segment the raw label or message
 * @returns the encoded path segment
 */
function encodeShieldsSegment({ segment }: { segment: string }): string {
  return encodeURIComponent(segment.replaceAll("-", "--").replaceAll("_", "__"));
}

/** One badge: an anchor to its heading, a tooltip, and the shields image. */
function badge({ label, target, verdict }: { label: string; target: string; verdict: BadgeVerdict }): string {
  const path = [
    encodeShieldsSegment({ segment: label }),
    encodeShieldsSegment({ segment: verdict.message }),
    encodeShieldsSegment({ segment: verdict.color }),
  ].join("-");
  const img = imageTag({ alt: `${label}: ${verdict.message}`, url: `https://img.shields.io/badge/${path}?style=flat` });
  return `<a href="#${target}" title="${escapeAttr({ text: verdict.tooltip })}">${img}</a>`;
}

/** The badge row and the bold risk line, in one badge-row shape. */
interface BadgeRow {
  readonly row: string;
  readonly riskLine: string;
}

/** The solved row: three badges, the review carried in the solved tooltip. */
function solvedBadgeRow({ body }: { body: StampedPrBody }): Result<BadgeRow, ReadingOrderError> {
  return riskVerdict({ items: body.risk.items }).andThen((risk) =>
    problemStatus({ seen: body.problemSeen, writtenOn: body.writtenOn }).map((problem) => {
      const solved = solvedVerdict({ claims: body.claims, review: body.review });
      const row = [
        badge({ label: "risk", target: BADGE_TARGETS.risk, verdict: risk }),
        badge({ label: "problem", target: BADGE_TARGETS.problem, verdict: problem }),
        badge({ label: "solved", target: BADGE_TARGETS.solved, verdict: solved }),
      ].join(" ");
      return { riskLine: risk.line, row };
    }),
  );
}

/** The plain row: risk then problem, the review in a comment after them. */
function plainBadgeRow({ body }: { body: StampedPrBody }): Result<BadgeRow, ReadingOrderError> {
  const risk = plainRiskVerdict({ blastRadius: body.risk.blastRadius, claims: body.claims, items: body.risk.items });
  return risk.andThen((verdict) =>
    plainProblemStatus({
      evidence: body.beforeAfter?.problem.evidence,
      problem: body.problem,
      seen: body.problemSeen,
      writtenOn: body.writtenOn,
    }).map((problem) => {
      const review = body.review === undefined ? "" : reviewComment({ review: body.review });
      const row =
        `${badge({ label: "risk", target: BADGE_TARGETS.risk, verdict })} ` +
        `${badge({ label: "problem", target: BADGE_TARGETS.problem, verdict: problem })}${review}`;
      return { riskLine: verdict.line, row };
    }),
  );
}

/**
 * A stamped body's badge row and the risk line under it, in the given shape.
 *
 * @param body the stamped body
 * @param shape `plain` for anything written, `withSolved` only to re-render a body `./parse.ts` read in that shape
 * @returns the row and the risk line, or a refusal when a badge cannot be derived
 */
export function badgeRowOf({
  body,
  shape,
}: {
  body: StampedPrBody;
  shape: BadgeRowShape;
}): Result<BadgeRow, ReadingOrderError> {
  return shape === "plain" ? plainBadgeRow({ body }) : solvedBadgeRow({ body });
}

/** The risk and problem anchors both rows open with, the problem one capturing its hover. */
const RISK_AND_PROBLEM =
  `^<a href="#${BADGE_TARGETS.risk}" title="[^"]*"><img src="[^"]*" alt="[^"]*"></a> ` +
  `<a href="#${BADGE_TARGETS.problem}" title="([^"]*)"><img src="[^"]*" alt="[^"]*"></a>`;

/** The solved row: a third, solved anchor carrying the review in its tooltip. */
const SOLVED_BADGE_ROW = new RegExp(
  `${RISK_AND_PROBLEM} <a href="#${BADGE_TARGETS.solved}" title="([^"]*)"><img src="[^"]*" alt="[^"]*"></a>$`,
);

/** The plain row: two anchors, then at most one review comment. */
const PLAIN_BADGE_ROW = new RegExp(`${RISK_AND_PROBLEM}(<!-- .* -->)?$`);

/** The facts only the badge row carries, and which shape it was written in. */
interface BadgeFacts {
  readonly problemSeen: ProblemSeen;
  readonly writtenOn: string;
  readonly review: Review | undefined;
  readonly badges: BadgeRowShape;
}

/** Read the solved row's two tooltips. */
function solvedBadgeFacts({ row }: { row: RegExpExecArray }): BadgeFacts | undefined {
  const problem = readProblemTooltip({ text: decodeAttr({ text: row[1]! }) });
  const solved = readSolvedTooltip({ text: decodeAttr({ text: row[2]! }) });
  if (problem === undefined || solved === undefined) {
    return undefined;
  }
  return {
    badges: "withSolved",
    problemSeen: problem.problemSeen,
    review: solved.review,
    writtenOn: problem.writtenOn,
  };
}

/** Read the plain row's problem hover and its review comment, when it has one. */
function plainBadgeFacts({ row }: { row: RegExpExecArray }): BadgeFacts | undefined {
  const problem = readPlainProblemHover({ text: decodeAttr({ text: row[1]! }) });
  const comment = row[2];
  const review = comment === undefined ? undefined : readReviewComment({ text: comment });
  if (problem === undefined || (comment !== undefined && review === undefined)) {
    return undefined;
  }
  return { badges: "plain", problemSeen: problem.problemSeen, review, writtenOn: problem.writtenOn };
}

/**
 * Read the badge row at the cursor, in whichever shape it was written — the inverse of `badgeRowOf`, which
 * `./parse.ts` re-renders against to prove the read.
 *
 * @param cursor the body's block cursor, at the badge row
 * @returns the problem's seen day, the stamp, the review and the row's shape; or where the read stopped
 */
export function readBadgeRow({ cursor }: { cursor: Cursor }): Result<BadgeFacts, ReadingOrderError> {
  const block = take({ cursor });
  if (block === undefined) {
    return stop({ at: "the badge row" });
  }
  const withSolved = SOLVED_BADGE_ROW.exec(block);
  const plain = PLAIN_BADGE_ROW.exec(block);
  let facts: BadgeFacts | undefined;
  if (withSolved !== null) {
    facts = solvedBadgeFacts({ row: withSolved });
  } else if (plain !== null) {
    facts = plainBadgeFacts({ row: plain });
  } else {
    return stop({ at: "the badge row" });
  }
  return facts === undefined ? stop({ at: "the badge tooltips" }) : ok(facts);
}
