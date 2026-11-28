/**
 * The exact inverse of `./render.ts` — recover a C3 body from a pull-request description.
 *
 * A parse is accepted only when re-rendering it reproduces the consumed bytes EXACTLY; anything else is DECLINED,
 * never guessed at — a guessed form would be merged into and written back, which is how a description gets silently
 * rewritten. Content APPENDED after the rendered body (a review bot's footer) is opaque and handed back as
 * `remainder`, provided it carries no markup any renderer emits. Split points are tried longest-first, so a body
 * with no remainder is read whole, and when none parses the longest candidate's refusal is the one reported.
 *
 * Layout 1's checks are the one run with no heading and no close, so a body ending on them could go on for any
 * number of checks. After such an ending the remainder may not carry the `<p>` or `</p>` every check is wrapped in:
 * the same bytes read as a shorter body with a footer, or as a longer one with something inserted between its
 * checks, and no parser can tell them apart. That is refused, never guessed.
 *
 * Media a human pasted BETWEEN the rendered blocks on github.com — one user-attachments image or video per block,
 * nothing else (`./pastedMedia.ts`) — is lifted out, keyed to the block it followed and handed back as `pasted`; the
 * re-render puts it back, and the whole prefix, pastes included, is what is compared. A paste after the LAST rendered
 * block is not between two, and stays in the remainder.
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
import { isQuoteSourceLine, quoteSlotAt } from "./parseQuote.js";
import { rerunItemsOf, splitFold } from "./parseRerunFold.js";
import { type KeyedBlock, liftPasted } from "./pastedMedia.js";
import {
  type C3BlockKey,
  type C3PastedMediaBlock,
  headingsOf,
  LAYOUT,
  NOT_SHOWN,
  renderBodyIn,
  renderKeyedBlocksIn,
} from "./render.js";
import { prBodySchema } from "./schema.js";
import type { BodyLayout, PrBody, ProofActor, ProofSlot, UncheckedItem } from "./types.js";

/** A successful read: the body, the media pasted into it, and the opaque tail. */
export interface PrBodyParse {
  readonly body: PrBody;
  /** The layout the bytes were in. A write always renders the current one; the CI gate judges by this one. */
  readonly layout: BodyLayout;
  /** Media a human pasted BETWEEN the rendered blocks, each keyed to the block it follows. Empty when none. */
  readonly pasted: readonly C3PastedMediaBlock[];
  /**
   * Third-party content after the rendered body, to be re-appended verbatim. Empty when there was none. Never a
   * `<p>` or `</p>` after a layout-1 body ending on its checks, which could be one of those checks displaced.
   */
  readonly remainder: string;
}

/** A proof slot at the cursor, its screenshot's or quote's actor taken from the proof hover. */
function slotAt({ cursor, runBy }: { cursor: Cursor; runBy: ProofActor | undefined }): ProofSlot | undefined {
  const lines = take({ cursor })?.split("\n");
  if (lines?.length === 1) {
    const reason = between({ block: lines[0], close: "</p>", open: "<p>" });
    return reason === undefined ? undefined : { kind: "reason", reason };
  }
  if (lines?.length !== 2 || runBy === undefined) {
    return undefined;
  }
  const proves = between({ block: lines[0], close: "</p>", open: "<p>" });
  if (isQuoteSourceLine({ line: lines[1]! })) {
    return quoteSlotAt({ cursor, proves, runBy, sourceLine: lines[1]! });
  }
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
  const problemProof = slotAt({ cursor, runBy: facts.problemBy });
  if (problemProof === undefined) {
    return stop({ at: "the proof of the problem" });
  }
  if (!takeProofHeading({ cursor, heading: headings.solutionHeading, layout })) {
    return stop({ at: "the Proof of the solution heading" });
  }
  const solutionProof = slotAt({ cursor, runBy: facts.solutionBy });
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

/**
 * The visual-proof applicability the bytes imply: a screenshot means a screen change, and otherwise the proof badge
 * says which (`tests only`, or a quote's hover saying nothing on screen changes).
 */
function visualProofOf({
  facts,
  body,
}: {
  facts: BadgeFacts;
  body: Pick<PrBody, "problemProof" | "solutionProof">;
}): PrBody["visualProof"] {
  const anyScreenshot = body.problemProof.kind === "screenshot" || body.solutionProof.kind === "screenshot";
  return !anyScreenshot && facts.nothingOnScreen ? "nothing-on-screen" : "screen-change";
}

/** Each pasted block lifted out of a candidate prefix, with how many canonical blank-line segments preceded it. */
type LiftedPastes = readonly { readonly before: number; readonly raw: string }[];

/** A candidate prefix read structurally: the fields as found, before the schema and the re-render. */
interface PrefixReading {
  readonly candidate: Record<string, unknown>;
  readonly lifted: LiftedPastes;
}

/**
 * Read one candidate prefix into the fields a body carries, before the schema and the re-render. Pasted media is
 * lifted out first, so the rest reads as the canonical body it was before somebody pasted into it.
 *
 * Only the blocks BEFORE the Re-run fold are lifted from: a fenced command's own text can hold a blank line and then
 * a bare attachment URL, and that is the command, never a paste. A paste inside the fold stays in it and fails the
 * fold's own read, as it did before any paste was lifted.
 */
function readPrefix({ prefix, layout }: { prefix: string; layout: BodyLayout }): Result<PrefixReading, PrBodyError> {
  const segments = prefix.slice(0, -1).split("\n\n");
  const foldAt = segments.indexOf(LAYOUT.rerunOpen);
  const beforeFold = foldAt < 0 ? segments : segments.slice(0, foldAt);
  const { canonical: liftedFrom, pasted: lifted } = liftPasted({ blocks: beforeFold });
  const canonical = [...liftedFrom, ...segments.slice(beforeFold.length)];
  return splitFold({ text: canonical.join("\n\n") }).andThen(({ main, inner }) => {
    const rerun = inner === undefined ? [] : rerunItemsOf({ inner });
    if (rerun === undefined) {
      return stop<PrefixReading>({ at: "the re-run fold" });
    }
    const cursor: Cursor = { at: 0, blocks: main.split("\n\n") };
    return readBadgeRow({ cursor }).andThen((facts) =>
      mainSections({ cursor, facts, layout }).map((sections) => ({
        candidate: {
          ...sections,
          problemSeen: facts.problemSeen,
          rerun,
          risk: { items: [facts.topRisk] },
          visualProof: visualProofOf({ body: sections, facts }),
        },
        lifted,
      })),
    );
  });
}

/**
 * Each lifted paste keyed to the rendered block it followed. A rendered block can itself hold blank lines (the re-run
 * fold does), so the count of preceding segments is read against each block's own segments, carrying the block's key
 * and which occurrence of that key it is. A count no segment answers is a body this renderer did not write.
 */
function keyedPastes({
  blocks,
  lifted,
}: {
  blocks: readonly KeyedBlock<C3BlockKey>[];
  lifted: LiftedPastes;
}): Result<readonly C3PastedMediaBlock[], PrBodyError> {
  const segments = blocks.flatMap((block, index) => {
    const occurrence = blocks.slice(0, index + 1).filter((earlier) => earlier.key === block.key).length;
    return block.text.split("\n\n").map(() => ({ key: block.key, occurrence }));
  });
  const keyed: C3PastedMediaBlock[] = [];
  for (const { before, raw } of lifted) {
    if (before === 0) {
      keyed.push({ after: "start", raw });
      continue;
    }
    const segment = segments[before - 1];
    if (segment === undefined) {
      return err(PrBodyErrors.nonCanonical());
    }
    keyed.push({ after: segment.key, occurrence: segment.occurrence, raw });
  }
  return ok(keyed);
}

/** The two tags every layout-1 check paragraph is wrapped in (`./render.ts`'s `checkBlocks`). */
const CHECK_PARAGRAPH_TAGS: readonly string[] = ["<p>", "</p>"];

/**
 * Whether a remainder could be the rest of an open layout-1 checks run. The run is open when the rendered body ends
 * on a check, or on the solution proof with no check at all; after that, a remainder carrying either of a check's
 * tags anywhere (on its own line, after prose on one line, behind indentation or a comment) may be a check displaced
 * by an edit before it. Both tags are read because an edit inside either one leaves the other whole: `<pX>` keeps
 * the close, `</pX>` the open. An edit breaking both is the residue, since its bytes are a footer's.
 */
function remainderMayContinueChecks({
  blocks,
  layout,
  remainder,
}: {
  blocks: readonly KeyedBlock<C3BlockKey>[];
  layout: BodyLayout;
  remainder: string;
}): boolean {
  const last = blocks.at(-1)?.key;
  const endsOnOpenChecks = layout === 1 && (last === "checks" || last === "solution-proof");
  return endsOnOpenChecks && carriesAny({ markers: CHECK_PARAGRAPH_TAGS, text: remainder });
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
  return readPrefix({ layout, prefix }).andThen(({ candidate, lifted }) => {
    const decoded = prBodySchema.safeParse(candidate);
    if (!decoded.success) {
      return err(PrBodyErrors.recoveredSchema({ issues: decoded.error.issues.map((issue) => issue.message) }));
    }
    const read = decoded.data;
    // The WHOLE prefix, pastes put back, is what is compared — never the stripped body — so a pasted block is
    // accepted only in the exact place the re-render puts it, and every canonical byte is still checked.
    return renderKeyedBlocksIn({ body: read, layout }).andThen((blocks) =>
      keyedPastes({ blocks, lifted }).andThen((pasted) =>
        renderBodyIn({ body: read, layout, pasted }).andThen((rendered) => {
          if (rendered !== prefix) {
            return err<PrBodyParse, PrBodyError>(PrBodyErrors.nonCanonical());
          }
          return remainderMayContinueChecks({ blocks, layout, remainder })
            ? err<PrBodyParse, PrBodyError>(PrBodyErrors.trailingMarkup())
            : ok({ body: read, layout, pasted, remainder });
        }),
      ),
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

/**
 * Every place the rendered body could end, longest-first: after a line closing a paragraph, a list or the fold. A
 * paste after the final rendered block ends on none of these, so it stays the opaque remainder, re-appended verbatim
 * exactly as the cached path carries it; only a paste BETWEEN rendered blocks is lifted.
 */
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
 * @returns the body, the media pasted into it and the opaque remainder; or a typed refusal — `PRE_C3_SHAPE` for a
 *   pre-C3 body, naming the conversion verb
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
