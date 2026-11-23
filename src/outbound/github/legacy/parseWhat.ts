/**
 * The what-and-why section of a reading-order body, read back: the origin line, Problem and Change, the
 * optional Before-and-after table, fails-on-main witness and click-through line, Other claims, and the optional
 * visible Proof section.
 *
 * The inverse of that section in `./render.ts`, split out of `./parse.ts` because it is the largest section and
 * the only one with tables. Like every reader under `./parse.ts` it declines rather than guesses: the caller
 * re-renders what this returns and compares bytes.
 */
import { ok, type Result } from "#lib/result.js";
import { longDay } from "../days.js";
import { IMG, imageRunOf, parseContent } from "../parseContent.js";
import type { ReadingOrderError } from "./errors.js";
import { allOf, between, type Cursor, cellsOf, stop, take, takeLiteral } from "./parseCursor.js";
import { LAYOUT } from "./render.js";
import type {
  BeforeAfter,
  Claim,
  ClaimProof,
  ClickThrough,
  Content,
  EvidenceContent,
  EvidenceRun,
  FailsOnMain,
  ProblemSeen,
  ProofItem,
  StampedPrBody,
} from "./types.js";

/** An evidence cell: images where the renderer put them, inline runs between. */
function evidenceOf({ source }: { source: string }): EvidenceContent | undefined {
  const runs: EvidenceRun[] = [];
  let rest = source;
  while (rest.length > 0) {
    const imageAt = rest.indexOf("<img ");
    const text = imageAt < 0 ? rest : rest.slice(0, imageAt);
    const content = text.length === 0 ? [] : parseContent({ source: text });
    if (content === undefined) {
      return undefined;
    }
    runs.push(...content);
    if (imageAt < 0) {
      break;
    }
    const image = IMG.exec(rest.slice(imageAt));
    if (image === null) {
      return undefined;
    }
    runs.push(imageRunOf({ match: image }));
    rest = rest.slice(imageAt + image[0].length);
  }
  return runs.length === 0 ? undefined : runs;
}

/** The problem's Where cell, with the seen-day suffix the renderer appends stripped and checked. */
function problemWhereOf({ cell, seen }: { cell: string; seen: ProblemSeen }): Content | undefined {
  if (seen.kind === "unevidenced") {
    return parseContent({ source: cell });
  }
  const suffix = `, seen ${longDay({ day: seen.on })}`;
  return cell.endsWith(suffix) ? parseContent({ source: cell.slice(0, -suffix.length) }) : undefined;
}

/** The Before-and-after table. */
function beforeAfterOf({ block, seen }: { block: string | undefined; seen: ProblemSeen }): BeforeAfter | undefined {
  const lines = block?.split("\n");
  const framed =
    lines?.length === 5 && lines[0] === "<table>" && lines[1] === LAYOUT.beforeAfterHeader && lines[4] === "</table>";
  if (!framed) {
    return undefined;
  }
  const where = cellsOf({ count: 3, line: lines[2] });
  const evidence = cellsOf({ count: 3, line: lines[3] });
  if (where?.[0] !== "<strong>Where</strong>" || evidence?.[0] !== "<strong>Evidence</strong>") {
    return undefined;
  }
  const problemWhere = problemWhereOf({ cell: where[1]!, seen });
  const fixWhere = parseContent({ source: where[2]! });
  const problemEvidence = evidenceOf({ source: evidence[1]! });
  const fixEvidence = evidenceOf({ source: evidence[2]! });
  if (problemWhere === undefined || fixWhere === undefined || problemEvidence === undefined) {
    return undefined;
  }
  if (fixEvidence === undefined) {
    return undefined;
  }
  return {
    fix: { evidence: fixEvidence, where: fixWhere },
    problem: { evidence: problemEvidence, where: problemWhere },
  };
}

/** The fails-on-main line. */
const FAILS_ON_MAIN =
  /^<p><strong>Fails on main, passes here:<\/strong> <code>(.*)<\/code>: ❌ on main at <code>([0-9a-f]{7,40})<\/code>, ✅ on this branch\.<\/p>$/;

/** The fails-on-main witness, when the next block is one. */
function failsOnMainOf({ cursor }: { cursor: Cursor }): Result<FailsOnMain | undefined, ReadingOrderError> {
  const next = cursor.blocks[cursor.at];
  if (next?.startsWith(LAYOUT.failsOnMainOpen) !== true) {
    return ok(undefined);
  }
  cursor.at += 1;
  const match = FAILS_ON_MAIN.exec(next);
  const command = match === null ? undefined : parseContent({ source: `<code>${match[1]!}</code>` });
  // The command renders through `escapeCell` inside one `<code>`, so it reads back as exactly one code run.
  const run = command?.length === 1 ? command[0] : undefined;
  if (match === null || run?.kind !== "code") {
    return stop({ at: "the fails-on-main line" });
  }
  return ok({ command: run.text, mainSha: match[2]! });
}

/** The click-through line: the commit, then the control and what it opened either side of the one `<br>`. */
const CLICK_THROUGH =
  /^<p><strong>Clicked through on the running build at <code>([0-9a-f]{7,40})<\/code>:<\/strong> (.*)<\/p>$/;

/** The click-through witness, when the next block is one. */
function clickThroughOf({ cursor }: { cursor: Cursor }): Result<ClickThrough | undefined, ReadingOrderError> {
  const next = cursor.blocks[cursor.at];
  if (next?.startsWith(LAYOUT.clickThroughOpen) !== true) {
    return ok(undefined);
  }
  cursor.at += 1;
  const match = CLICK_THROUGH.exec(next);
  // Every run escapes `<`, so a rendered line holds exactly one `<br>`; a second one was typed by hand.
  const halves = match === null ? [] : match[2]!.split("<br>");
  const control = halves.length === 2 ? parseContent({ source: halves[0]! }) : undefined;
  const destination = halves.length === 2 ? evidenceOf({ source: halves[1]! }) : undefined;
  if (match === null || control === undefined || destination === undefined) {
    return stop({ at: "the click-through line" });
  }
  return ok({ commit: match[1]!, control, destination });
}

/** The prefix each claim proof kind renders with. */
const CLAIM_PREFIXES = [
  { kind: "proven", prefix: "✅ " },
  { kind: "gap", prefix: "⚠️ not checked: " },
  { kind: "failed", prefix: "❌ " },
] as const;

/** One claim's proof cell. */
function claimProofOf({ cell }: { cell: string }): ClaimProof | undefined {
  const found = CLAIM_PREFIXES.find((candidate) => cell.startsWith(candidate.prefix));
  if (found === undefined) {
    return undefined;
  }
  const source = cell.slice(found.prefix.length);
  if (found.kind === "proven") {
    // A proven claim's evidence is an evidence cell, so a screenshot reads back as the image it rendered.
    const evidence = evidenceOf({ source });
    return evidence === undefined ? undefined : { evidence, kind: "proven" };
  }
  const content = parseContent({ source });
  return content === undefined ? undefined : { kind: found.kind, why: content };
}

/** One claim row. */
function claimOf({ row }: { row: string }): Claim | undefined {
  const cells = cellsOf({ count: 2, line: row });
  if (cells === undefined) {
    return undefined;
  }
  const claim = parseContent({ source: cells[0]! });
  const proof = claimProofOf({ cell: cells[1]! });
  return claim === undefined || proof === undefined ? undefined : { claim, proof };
}

/** The Other claims block. */
function claimsOf({ block }: { block: string | undefined }): readonly Claim[] | undefined {
  if (block === LAYOUT.claimsEmpty) {
    return [];
  }
  const lines = block?.split("\n");
  const framed =
    lines !== undefined &&
    lines.length >= 4 &&
    lines[0] === "<table>" &&
    lines[1] === LAYOUT.claimsHeader &&
    lines.at(-1) === "</table>";
  if (!framed) {
    return undefined;
  }
  return allOf({ read: (row) => claimOf({ row }), rows: lines.slice(2, -1) });
}

/** One Proof line: the caption, the one `<br>`, then exactly one canonical image. */
const PROOF_LINE = /^<p>(.*)<br>(<img [^\n]*>)<\/p>$/;

/** One Proof item, or undefined when its line is not the renderer's. */
function proofItemOf({ line }: { line: string }): ProofItem | undefined {
  const match = PROOF_LINE.exec(line);
  const caption = match === null ? undefined : parseContent({ source: match[1]! });
  const image = match === null ? null : IMG.exec(match[2]!);
  if (caption === undefined || image === null || image[0] !== match?.[2]) {
    return undefined;
  }
  return { caption, image: imageRunOf({ match: image }) };
}

/** The optional Proof section, under its heading. */
function proofSection({ cursor }: { cursor: Cursor }): Result<readonly ProofItem[] | undefined, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.proofHeading })) {
    return ok(undefined);
  }
  const block = take({ cursor });
  const items =
    block === undefined ? undefined : allOf({ read: (line) => proofItemOf({ line }), rows: block.split("\n") });
  return items === undefined ? stop({ at: "the Proof section" }) : ok(items);
}

/** The what-and-why section's fields. */
type WhatFields = Pick<
  StampedPrBody,
  "origin" | "problem" | "change" | "beforeAfter" | "failsOnMain" | "clickThrough" | "claims" | "proof"
>;

/** A paragraph under a fixed heading. */
function headedParagraph({ cursor, heading }: { cursor: Cursor; heading: string }): Content | undefined {
  return takeLiteral({ cursor, literal: heading })
    ? between({ block: take({ cursor }), close: "</p>", open: "<p>" })
    : undefined;
}

/** The optional Before-and-after table, under its heading. */
function beforeAfterSection({
  cursor,
  seen,
}: {
  cursor: Cursor;
  seen: ProblemSeen;
}): Result<BeforeAfter | undefined, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.beforeAfterHeading })) {
    return ok(undefined);
  }
  const beforeAfter = beforeAfterOf({ block: take({ cursor }), seen });
  return beforeAfter === undefined ? stop({ at: "the Before-and-after table" }) : ok(beforeAfter);
}

/**
 * Read the what-and-why section from the cursor's position.
 *
 * @param cursor the main part's blocks, positioned at the section heading; advanced past the section
 * @param seen the problem-seen fact the badge tooltip carried, which the Before-and-after Where cell echoes
 * @returns the section's fields, or a `STRUCTURE` refusal naming the block it stopped at
 */
export function whatSection({
  cursor,
  seen,
}: {
  cursor: Cursor;
  seen: ProblemSeen;
}): Result<WhatFields, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.whatHeading })) {
    return stop({ at: "the what-and-why heading" });
  }
  const origin = between({ block: take({ cursor }), close: "</em></p>", open: "<p><em>" });
  if (origin === undefined) {
    return stop({ at: "the origin line" });
  }
  const problem = headedParagraph({ cursor, heading: LAYOUT.problemHeading });
  const change = problem === undefined ? undefined : headedParagraph({ cursor, heading: LAYOUT.changeHeading });
  if (problem === undefined || change === undefined) {
    return stop({ at: "Problem and Change" });
  }
  return beforeAfterSection({ cursor, seen }).andThen((beforeAfter) =>
    failsOnMainOf({ cursor }).andThen((failsOnMain) =>
      clickThroughOf({ cursor }).andThen((clickThrough) => {
        const claims = takeLiteral({ cursor, literal: LAYOUT.claimsHeading })
          ? claimsOf({ block: take({ cursor }) })
          : undefined;
        if (claims === undefined) {
          return stop<WhatFields>({ at: "Other claims" });
        }
        return proofSection({ cursor }).map((proof): WhatFields => ({
          change,
          claims,
          origin,
          problem,
          ...(beforeAfter === undefined ? {} : { beforeAfter }),
          ...(failsOnMain === undefined ? {} : { failsOnMain }),
          ...(clickThrough === undefined ? {} : { clickThrough }),
          ...(proof === undefined ? {} : { proof }),
        }));
      }),
    ),
  );
}
