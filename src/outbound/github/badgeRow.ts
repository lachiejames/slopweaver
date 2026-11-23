/**
 * The badge row a C3 description opens with — risk, problem, proof — and its reader. Pure.
 *
 * Each badge is an anchor to the heading it summarises, carrying its hover as a `title`, around a shields.io image
 * whose alt repeats the visible words. The reader recovers exactly the facts only a hover carries
 * (`./tooltips.ts`); `./parse.ts` re-renders the whole body against them to prove the read.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type BadgeVerdict, canonicalKindOf, problemBadgeOf, proofBadgeOf, riskBadgeOf } from "./derive.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import { escapeAttr, imageTag } from "./htmlText.js";
import { decodeAttr } from "./parseContent.js";
import { type Cursor, stop, take } from "./parseCursor.js";
import { readNotSeenHover, readProofActors, readRiskHover, readSeenHover } from "./tooltips.js";
import type { BodyLayout, Level, PrBody, ProblemSeen, ProofActor, RiskItem } from "./types.js";

/**
 * The anchor names the badges jump to. A pull-request body's headings get NO id from GitHub (measured on a pull
 * request's `bodyHTML`: `<h3 dir="auto">Problem</h3>`), so each target heading carries its own `<a name>`, which the
 * sanitiser keeps as `user-content-<name>` and GitHub's page script scrolls `#<name>` to.
 */
export const BADGE_TARGETS = {
  checks: "checks",
  notChecked: "not-checked-and-why",
  problem: "proof-of-the-problem",
  solution: "proof-of-the-solution",
} as const;

/**
 * Encode one shields.io path segment: `-` and `_` doubled (their field separator and space), then percent-encoded.
 *
 * @param segment the raw label or message
 * @returns the encoded path segment
 */
function encodeShieldsSegment({ segment }: { segment: string }): string {
  return encodeURIComponent(segment.replaceAll("-", "--").replaceAll("_", "__"));
}

/** One badge: an anchor to its heading, a hover, and the shields image. */
function badge({ label, target, verdict }: { label: string; target: string; verdict: BadgeVerdict }): string {
  const path = [
    encodeShieldsSegment({ segment: label }),
    encodeShieldsSegment({ segment: verdict.message }),
    encodeShieldsSegment({ segment: verdict.color }),
  ].join("-");
  const img = imageTag({ alt: `${label}: ${verdict.message}`, url: `https://img.shields.io/badge/${path}?style=flat` });
  return `<a href="#${target}" title="${escapeAttr({ text: verdict.tooltip })}">${img}</a>`;
}

/**
 * A body's badge row: risk, problem, proof.
 *
 * @param layout the body layout the row is rendered for
 * @returns the row's one line, or a refusal when a badge cannot be derived
 */
export function badgeRowOf({ body, layout }: { body: PrBody; layout: BodyLayout }): Result<string, PrBodyError> {
  return riskBadgeOf({ items: body.risk.items }).andThen((risk) =>
    problemBadgeOf({ seen: body.problemSeen }).andThen((problem) =>
      proofBadgeOf({ body, layout }).map((proof) =>
        [
          badge({ label: "risk", target: BADGE_TARGETS.solution, verdict: risk }),
          badge({ label: "problem", target: BADGE_TARGETS.problem, verdict: problem }),
          badge({ label: "proof", target: BADGE_TARGETS.solution, verdict: proof }),
        ].join(" "),
      ),
    ),
  );
}

/** One badge as the row writes it, capturing its hover and its alt. */
const ONE_BADGE = '<a href="#[a-z-]+" title="([^"]*)"><img src="[^"]*" alt="([^"]*)"></a>';

/** The whole row: three badges, one space apart. */
const BADGE_ROW = new RegExp(`^${ONE_BADGE} ${ONE_BADGE} ${ONE_BADGE}$`, "u");

/** The facts only the badge row carries. */
export interface BadgeFacts {
  /** The top risk item, its kind canonicalised to the level its badge shows. */
  readonly topRisk: RiskItem;
  readonly problemSeen: ProblemSeen;
  readonly problemBy: ProofActor | undefined;
  readonly solutionBy: ProofActor | undefined;
  /** Whether the proof badge reads `tests only`, which is what `nothing-on-screen` renders as. */
  readonly testsOnly: boolean;
}

/** The level a risk badge's alt names. */
function levelOfAlt({ alt }: { alt: string }): Level | undefined {
  const match = /^risk: (low|medium|high)(?:, unchecked)?$/u.exec(alt);
  return match === null ? undefined : (["low", "medium", "high"] as const).find((level) => level === match[1]);
}

/** The problem's seen state, read off its hover by the template its alt names. */
function seenOf({ alt, hover }: { alt: string; hover: string }): ProblemSeen | undefined {
  if (alt === "problem: not seen yet") {
    return readNotSeenHover({ text: hover });
  }
  return alt.startsWith("problem: seen ") ? readSeenHover({ text: hover }) : undefined;
}

/**
 * Read the badge row at the cursor — the inverse of {@link badgeRowOf}, which `./parse.ts` re-renders against.
 *
 * @param cursor the body's block cursor, at the badge row
 * @returns the facts the hovers carry, or where the read stopped
 */
export function readBadgeRow({ cursor }: { cursor: Cursor }): Result<BadgeFacts, PrBodyError> {
  const block = take({ cursor });
  const row = block === undefined ? null : BADGE_ROW.exec(block);
  if (row === null) {
    return stop({ at: "the badge row" });
  }
  const [riskHover, riskAlt, problemHover, problemAlt, proofHover, proofAlt] = row
    .slice(1, 7)
    .map((text) => decodeAttr({ text: text }));
  const level = levelOfAlt({ alt: riskAlt! });
  const risk = readRiskHover({ text: riskHover! });
  const problemSeen = seenOf({ alt: problemAlt!, hover: problemHover! });
  if (level === undefined || risk === undefined || problemSeen === undefined) {
    return err(PrBodyErrors.structure({ at: "the badge hovers" }));
  }
  const actors = readProofActors({ text: proofHover! });
  return ok({
    problemBy: actors.problemBy,
    problemSeen,
    solutionBy: actors.solutionBy,
    testsOnly: proofAlt === "proof: tests only",
    topRisk: { ...risk, worstKind: canonicalKindOf({ level }) },
  });
}
