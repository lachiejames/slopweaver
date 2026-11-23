/**
 * The exact inverse of `./render.ts` — recover a C3 body from a pull-request description.
 *
 * A parse is accepted only when re-rendering it reproduces the consumed bytes EXACTLY; anything else is DECLINED,
 * never guessed at — a guessed form would be merged into and written back, which is how a description gets silently
 * rewritten. Content APPENDED after the rendered body (a review bot's footer) is opaque and handed back as
 * `remainder`, provided it carries no markup any renderer emits. Split points are tried longest-first, so a body
 * with no remainder is read whole, and when none parses the longest candidate's refusal is the one reported.
 *
 * The title, routing and draft state are not in the body, so the caller supplies them from the live pull request.
 * Three facts ride the badge hovers rather than a section (`./badgeRow.ts`): the top risk item, the problem's seen
 * state and who ran each screenshot. The risk items below the top one are not published, so a read-back carries the
 * top item alone, its kind canonicalised to its level.
 *
 * Both layouts read (`./render.ts`): the problem heading says which one a body is in, and the read is proved against
 * that layout's own render, so an older body reads back exactly as it was published.
 *
 * A body in a pre-C3 shape is declined as `PRE_C3_SHAPE`, naming the conversion verb, which reads it with the frozen
 * reading-order parser (`./legacy/parse.ts`) and sends nothing.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type BadgeFacts, readBadgeRow } from "./badgeRow.js";
import { carriesAny, DESCRIPTION_SENTINELS, descriptionShapeOf } from "./bodyMarkers.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import { lfLineEndings } from "./lineEndings.js";
import { checksOf } from "./parseChecks.js";
import { IMG, imageRunOf, parseContent } from "./parseContent.js";
import { allOf, between, type Cursor, listRows, stop, take, takeLiteral } from "./parseCursor.js";
import { rerunItemsOf, splitFold } from "./parseRerunFold.js";
import { headingsOf, NOT_SHOWN, renderBodyIn } from "./render.js";
import { prBodySchema } from "./schema.js";
import type { BodyLayout, PrBody, ProofActor, ProofSlot, UncheckedItem } from "./types.js";

/** A successful read: the body, and the opaque tail. */
export interface PrBodyParse {
  readonly body: PrBody;
  /** The layout the bytes were in. A write always renders the current one; the CI gate judges by this one. */
  readonly layout: BodyLayout;
  /** Third-party content after the rendered body, to be re-appended verbatim. Empty when there was none. */
  readonly remainder: string;
}

/** A proof slot's block, its screenshot's actor taken from the proof hover. */
function slotOf({ block, runBy }: { block: string | undefined; runBy: ProofActor | undefined }): ProofSlot | undefined {
  const lines = block?.split("\n");
  if (lines?.length === 1) {
    const reason = between({ block: lines[0], close: "</p>", open: "<p>" });
    return reason === undefined ? undefined : { kind: "reason", reason };
  }
  if (lines?.length !== 2 || runBy === undefined) {
    return undefined;
  }
  const proves = between({ block: lines[0], close: "</p>", open: "<p>" });
  const picture = lines[1]!.startsWith("<p>") && lines[1]!.endsWith("</p>") ? lines[1]!.slice(3, -4) : "";
  const image = IMG.exec(picture);
  if (proves === undefined || image === null || image[0] !== picture) {
    return undefined;
  }
  return { image: imageRunOf({ match: image }), kind: "screenshot", proves, runBy };
}

/**
 * Where the first `. ` sits OUTSIDE every tag, or -1. A link's `href` is inside a tag and may carry `. ` (a URL
 * the write schema accepts), so a plain `indexOf` split a rendered row inside its own attribute.
 */
function separatorOutsideTags({ text }: { text: string }): number {
  let inTag = false;
  for (let index = 0; index < text.length - 1; index += 1) {
    const char = text[index];
    if (char === "<") {
      inTag = true;
    } else if (char === ">") {
      inTag = false;
    } else if (!inTag && char === "." && text[index + 1] === " ") {
      return index;
    }
  }
  return -1;
}

/** One "Not checked, and why" row: the check up to the first `. ` outside a tag, then why. */
function uncheckedOf({ row }: { row: string }): UncheckedItem | undefined {
  if (!row.startsWith("<li>") || !row.endsWith("</li>")) {
    return undefined;
  }
  const interior = row.slice("<li>".length, -"</li>".length);
  const split = separatorOutsideTags({ text: interior });
  if (split < 0) {
    return undefined;
  }
  const check = parseContent({ source: interior.slice(0, split) });
  const why = parseContent({ source: interior.slice(split + 2) });
  return check === undefined || why === undefined ? undefined : { check, why };
}

/**
 * A proof heading at the cursor: the bare heading, or in layout 2 the heading with `: not shown`. Which one the slot
 * under it needs is left to the re-render, which refuses a heading that disagrees with its slot.
 */
function takeProofHeading({
  cursor,
  heading,
  layout,
}: {
  cursor: Cursor;
  heading: string;
  layout: BodyLayout;
}): boolean {
  return (
    takeLiteral({ cursor, literal: heading }) ||
    (layout === 2 && takeLiteral({ cursor, literal: `${heading}${NOT_SHOWN}` }))
  );
}

/** The main part's blocks after the badge row, read in order into the fields a body carries. */
function mainSections({
  cursor,
  facts,
  layout,
}: {
  cursor: Cursor;
  facts: BadgeFacts;
  layout: BodyLayout;
}): Result<Omit<PrBody, "risk" | "problemSeen" | "rerun" | "visualProof">, PrBodyError> {
  const headings = headingsOf({ layout });
  const explainer = between({ block: take({ cursor }), close: "</p>", open: "<p>" });
  if (explainer === undefined) {
    return stop({ at: "the explainer" });
  }
  if (!takeProofHeading({ cursor, heading: headings.problemHeading, layout })) {
    return stop({ at: "the Proof of the problem heading" });
  }
  const problemProof = slotOf({ block: take({ cursor }), runBy: facts.problemBy });
  if (problemProof === undefined) {
    return stop({ at: "the proof of the problem" });
  }
  if (!takeProofHeading({ cursor, heading: headings.solutionHeading, layout })) {
    return stop({ at: "the Proof of the solution heading" });
  }
  const solutionProof = slotOf({ block: take({ cursor }), runBy: facts.solutionBy });
  if (solutionProof === undefined) {
    return stop({ at: "the proof of the solution" });
  }
  const read = checksOf({ cursor, layout });
  if (read === undefined) {
    return stop({ at: "the checks" });
  }
  const hasNotChecked = takeLiteral({ cursor, literal: headings.notCheckedHeading });
  const notChecked = hasNotChecked
    ? allOf({ read: (row) => uncheckedOf({ row }), rows: listRows({ block: take({ cursor }), tag: "ul" }) })
    : [];
  if (notChecked === undefined || cursor.at !== cursor.blocks.length) {
    return stop({ at: "Not checked, and why" });
  }
  const sections = { checks: read.checks, explainer, notChecked, problemProof, solutionProof };
  return ok(read.checkGroups.length > 0 ? { ...sections, checkGroups: read.checkGroups } : sections);
}

/** The visual-proof applicability the bytes imply: a screenshot, or an amber `not run yet`, means a screen change. */
function visualProofOf({
  facts,
  body,
}: {
  facts: BadgeFacts;
  body: Pick<PrBody, "problemProof" | "solutionProof">;
}): PrBody["visualProof"] {
  const anyScreenshot = body.problemProof.kind === "screenshot" || body.solutionProof.kind === "screenshot";
  return !anyScreenshot && facts.testsOnly ? "nothing-on-screen" : "screen-change";
}

/** Read one candidate prefix into the fields a body carries, before the schema and the re-render. */
function readPrefix({
  prefix,
  layout,
}: {
  prefix: string;
  layout: BodyLayout;
}): Result<Record<string, unknown>, PrBodyError> {
  return splitFold({ text: prefix.slice(0, -1) }).andThen(({ main, inner }) => {
    const rerun = inner === undefined ? [] : rerunItemsOf({ inner });
    if (rerun === undefined) {
      return stop<Record<string, unknown>>({ at: "the re-run fold" });
    }
    const cursor: Cursor = { at: 0, blocks: main.split("\n\n") };
    return readBadgeRow({ cursor }).andThen((facts) =>
      mainSections({ cursor, facts, layout }).map((sections) => ({
        ...sections,
        problemSeen: facts.problemSeen,
        rerun,
        risk: { items: [facts.topRisk] },
        visualProof: visualProofOf({ body: sections, facts }),
      })),
    );
  });
}

/** Decode, re-render and compare one candidate split. */
function parseAt({
  body,
  end,
  layout,
}: {
  body: string;
  end: number;
  layout: BodyLayout;
}): Result<PrBodyParse, PrBodyError> {
  const prefix = body.slice(0, end);
  const remainder = body.slice(end);
  if (remainder.length > 0 && carriesAny({ markers: DESCRIPTION_SENTINELS, text: remainder })) {
    return err(PrBodyErrors.trailingMarkup());
  }
  return readPrefix({ layout, prefix }).andThen((candidate) => {
    const decoded = prBodySchema.safeParse(candidate);
    if (!decoded.success) {
      return err(PrBodyErrors.recoveredSchema({ issues: decoded.error.issues.map((issue) => issue.message) }));
    }
    return renderBodyIn({ body: decoded.data, layout }).andThen((rendered) =>
      rendered === prefix
        ? ok({ body: decoded.data, layout, remainder })
        : err<PrBodyParse, PrBodyError>(PrBodyErrors.nonCanonical()),
    );
  });
}

/**
 * Which layout a body is in, read off its FIRST problem anchor: layout 2 when a blank line and `## ` open it, else
 * layout 1. Only the badge line and the escaped explainer come before that heading, so neither can carry the anchor,
 * while a Re-run command quoting a heading sits after it and is never read.
 */
function layoutOf({ body }: { body: string }): BodyLayout {
  const heading = headingsOf({ layout: 2 }).problemHeading;
  const hashes = heading.slice(0, heading.indexOf("<a "));
  const at = body.indexOf(heading.slice(hashes.length));
  return at >= 0 && body.slice(0, at).endsWith(`\n\n${hashes}`) ? 2 : 1;
}

/** Every place the rendered body could end, longest-first: after a line closing a paragraph, a list or the fold. */
function splitCandidates({ body }: { body: string }): readonly number[] {
  const ends: number[] = [];
  for (const marker of ["</p>\n", "</ul>\n", "\n</details>\n"]) {
    for (let at = body.indexOf(marker); at >= 0; at = body.indexOf(marker, at + 1)) {
      ends.push(at + marker.length);
    }
  }
  return ends.toSorted((a, b) => b - a);
}

/**
 * Read a C3 pull-request body back into the body that renders it.
 *
 * Line endings are read as LF: GitHub's web editor stores a body saved through it with CRLF, and every caller means
 * the content. The remainder comes back with LF too.
 *
 * @param body the live body exactly as GitHub stores it, or undefined when the read yielded none
 * @returns the body and the opaque remainder; or a typed refusal — `PRE_C3_SHAPE` for a pre-C3 body, naming the
 *   conversion verb
 */
export function parsePrBody({ body: raw }: { body: string | undefined }): Result<PrBodyParse, PrBodyError> {
  if (raw === undefined || raw.length === 0) {
    return err(PrBodyErrors.absentBody());
  }
  const body = lfLineEndings({ text: raw });
  const shape = descriptionShapeOf({ text: body });
  if (shape === "reading-order" || shape === "retired-table") {
    return err(PrBodyErrors.preC3Shape({ shape }));
  }
  const layout = layoutOf({ body });
  const outcomes = splitCandidates({ body }).map((end) => parseAt({ body, end, layout }));
  const parsed = outcomes.find((outcome) => outcome.isOk());
  if (parsed !== undefined) {
    return parsed;
  }
  const first = outcomes[0];
  if (first !== undefined) {
    return first;
  }
  return err(PrBodyErrors.structure({ at: "the end of the body" }));
}
