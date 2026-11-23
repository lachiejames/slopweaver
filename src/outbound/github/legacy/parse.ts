/**
 * The exact inverse of `./render.ts` — recover a stamped body from a reading-order pull-request description.
 *
 * A parse is accepted only when re-rendering it reproduces the consumed bytes EXACTLY; anything else is
 * DECLINED, never guessed at — a guessed form would be merged into and written back, which is how a
 * description gets silently rewritten. Content APPENDED after the rendered body (a review bot's footer) is
 * opaque and handed back as `remainder`, provided it carries no markup a renderer of either shape emits. Media a
 * human pasted BETWEEN the rendered blocks — one user-attachments image or video per block, nothing else
 * (`./pastedMedia.ts`) — is lifted out, keyed to the block it followed and handed back as `pasted`; the
 * comparison is still over the whole prefix with those blocks put back, so nothing canonical goes unchecked. Split
 * points are tried longest-first, so a body with no remainder is read whole, and when none parses the longest
 * candidate's refusal is the one reported.
 *
 * The title, routing and draft state are not in the body, so the caller supplies them from the live pull
 * request. The one routing fact the bytes DO carry is the owner and repository of a gold anchor's commit link,
 * returned as `anchorRepo` so a caller can check it against the target it supplies.
 *
 * A body in the RETIRED table shape is declined as `RETIRED_SHAPE`, naming the whole-replace conversion: there
 * is no decoder for the old shape. Risk items are different: a body written before they became sentences is
 * read in its dotted row shape and re-rendered in that SAME shape for the byte comparison (`./riskRow.ts`), so it
 * stays readable, and `riskRows` says which it was. The badge row works the same way: a body written while it
 * carried three badges (risk, problem, solved with the review in its hover) is read and re-rendered in that
 * `withSolved` shape, and `badges` says which it was; every write renders the two-badge `plain` row, so re-sending
 * an old body converts it. The block cursor lives in `./parseCursor.ts` and the what-and-why section,
 * the one with tables, in `./parseWhat.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { parseContent } from "../parseContent.js";
import { readBadgeRow } from "./badgeRow.js";
import {
  carriesAny,
  READING_ORDER_SENTINELS,
  READING_ORDER_SHAPE_MARKERS,
  RETIRED_TABLE_MARKERS,
} from "./bodyMarkers.js";
import { type ReadingOrderError, ReadingOrderErrors } from "./errors.js";
import { parseProofBlocks } from "./parseBlocks.js";
import { allOf, between, type Cursor, listRows, stop, take, takeLiteral } from "./parseCursor.js";
import { leftoversSection } from "./parseLeftovers.js";
import { reviewersSection } from "./parseReviewers.js";
import { whatSection } from "./parseWhat.js";
import { liftPasted, type PastedMediaBlock, pastedMediaEnds } from "./pastedMedia.js";
import { LAYOUT, renderStampedBlocks, renderStampedBody } from "./render.js";
import { type RiskRowCheck, type RiskRowShape, readRiskRowLine } from "./riskRow.js";
import { stampedBodySchema } from "./schema.js";
import type { BadgeRowShape } from "./tooltips.js";
import type { Content, GoldAnchor, RepoRef, RiskItem, RiskSection, StampedPrBody } from "./types.js";

/** A successful read: the stamped body, the anchor's repository when there is one, and the opaque tail. */
export interface ReadingOrderParse {
  readonly body: StampedPrBody;
  readonly anchorRepo: RepoRef | undefined;
  /** Third-party content after the rendered body, to be re-appended verbatim. Empty when there was none. */
  readonly remainder: string;
  /** Media a human pasted BETWEEN the rendered blocks, each keyed to the block it follows. Empty when none. */
  readonly pasted: readonly PastedMediaBlock[];
  /** The risk items' row shape as written; `dotted` is a body no write has touched since rows became sentences. */
  readonly riskRows: RiskRowShape;
  /** The badge row's shape as written; `withSolved` is a body no write has touched since the row became two badges. */
  readonly badges: BadgeRowShape;
}

/** A risk item's check half, its HTML read as content. */
function riskCheckOf({ check }: { check: RiskRowCheck }): RiskItem["check"] | undefined {
  const content = parseContent({ source: check.html });
  if (content === undefined) {
    return undefined;
  }
  return check.kind === "checked" ? { check: content, kind: "checked" } : { kind: "unchecked", why: content };
}

/** One risk item, in whichever row shape it was written (`./riskRow.ts`), with that shape. */
function riskItemOf({ row }: { row: string }): { item: RiskItem; shape: RiskRowShape } | undefined {
  const fields = readRiskRowLine({ line: row });
  if (fields === undefined) {
    return undefined;
  }
  const worst = parseContent({ source: fields.worstHtml });
  const reach = parseContent({ source: fields.reachHtml });
  const check = riskCheckOf({ check: fields.check });
  if (worst === undefined || reach === undefined || check === undefined) {
    return undefined;
  }
  const { impact, likelihood, priority, shape } = fields;
  return { item: { check, impact, likelihood, priority, reach, worst }, shape };
}

/** The bold verdict line opening the risk section; only its prose is authored. */
const RISK_LINE = /^<p><strong>Risk: (?:low|medium|high)(?:, \d+ unchecked|, none checked)?\.<\/strong> (.*)<\/p>$/;

/** The risk section, and the one row shape every one of its items was written in. */
function riskSection({
  cursor,
}: {
  cursor: Cursor;
}): Result<{ risk: RiskSection; riskRows: RiskRowShape }, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.riskHeading })) {
    return stop({ at: "the risk heading" });
  }
  const block = take({ cursor });
  const verdict = block === undefined ? null : RISK_LINE.exec(block);
  const line = verdict === null ? undefined : parseContent({ source: verdict[1]! });
  if (line === undefined) {
    return stop({ at: "the risk line" });
  }
  const rows = allOf({ read: (row) => riskItemOf({ row }), rows: listRows({ block: take({ cursor }), tag: "ol" }) });
  const riskRows = rows?.[0]?.shape;
  if (rows === undefined || riskRows === undefined || rows.some((row) => row.shape !== riskRows)) {
    return stop({ at: "the risk items" });
  }
  const blastRadius = between({ block: take({ cursor }), close: "</p>", open: LAYOUT.blastOpen });
  if (blastRadius === undefined) {
    return stop({ at: "the blast radius" });
  }
  return ok({ risk: { blastRadius, items: rows.map((row) => row.item), line }, riskRows });
}

/** The items of a one-line-per-item list, each read as content. */
function listContent({ block, tag }: { block: string | undefined; tag: "ol" | "ul" }): Content[] | undefined {
  return allOf({
    read: (row) => between({ block: row, close: "</li>", open: "<li>" }),
    rows: listRows({ block, tag }),
  });
}

/** The code section, which must consume every remaining block. */
function codeSection({
  cursor,
}: {
  cursor: Cursor;
}): Result<Pick<StampedPrBody, "whyApproach" | "whereToLook">, ReadingOrderError> {
  if (!takeLiteral({ cursor, literal: LAYOUT.codeHeading })) {
    return stop({ at: "the code heading" });
  }
  const hasWhy = takeLiteral({ cursor, literal: LAYOUT.whyHeading });
  const whyApproach = hasWhy ? listContent({ block: take({ cursor }), tag: "ul" }) : undefined;
  if (hasWhy && whyApproach === undefined) {
    return stop({ at: "Why this approach" });
  }
  const whereToLook = takeLiteral({ cursor, literal: LAYOUT.whereHeading })
    ? listContent({ block: take({ cursor }), tag: "ol" })
    : undefined;
  if (whereToLook === undefined || cursor.at !== cursor.blocks.length) {
    return stop({ at: "Where to look" });
  }
  return ok({ whereToLook, ...(whyApproach === undefined ? {} : { whyApproach }) });
}

/** The gold anchor block `./render.ts`'s `anchorLines` emits. */
const ANCHOR =
  /^proof-commit: \[`([0-9a-f]{7,40})`\]\(https:\/\/github\.com\/([^/\s()]+)\/([^/\s()]+)\/commit\/([0-9a-f]{7,40})\)(?:\nproof-patch-id: ([0-9a-f]{40}|[0-9a-f]{64}) — [^\n]+)?$/;

/** What the Longer notes carry. */
interface NotesFields {
  readonly notes: StampedPrBody["notes"];
  readonly goldAnchor: GoldAnchor | undefined;
  readonly anchorRepo: RepoRef | undefined;
}

/** The interior of the Longer notes: blocks, then the anchor when there is one. */
function notesOf({ inner }: { inner: string | undefined }): Result<NotesFields, ReadingOrderError> {
  if (inner === undefined) {
    return ok({ anchorRepo: undefined, goldAnchor: undefined, notes: undefined });
  }
  const lastBreak = inner.lastIndexOf("\n\n");
  const anchor = ANCHOR.exec(lastBreak < 0 ? inner : inner.slice(lastBreak + 2));
  const blocksSource = anchor === null ? inner : inner.slice(0, Math.max(lastBreak, 0));
  const notes = blocksSource.length === 0 ? [] : parseProofBlocks({ source: blocksSource });
  if (notes === undefined || (anchor !== null && anchor[1] !== anchor[4])) {
    return stop({ at: "the Longer notes" });
  }
  const withNotes = notes.length === 0 ? undefined : notes;
  if (anchor === null) {
    return ok({ anchorRepo: undefined, goldAnchor: undefined, notes: withNotes });
  }
  const goldAnchor: GoldAnchor = { commit: anchor[1]!, ...(anchor[5] === undefined ? {} : { patchId: anchor[5] }) };
  return ok({ anchorRepo: { owner: anchor[2]!, repo: anchor[3]! }, goldAnchor, notes: withNotes });
}

/** The prefix (without its final newline) split into its main part and the Longer notes interior. */
function splitNotes({
  text,
}: {
  text: string;
}): Result<{ main: string; inner: string | undefined }, ReadingOrderError> {
  const open = `\n\n${LAYOUT.notesOpen}\n\n`;
  // The FIRST occurrence: nothing in the main part can carry these bytes, because every cell escapes `<`.
  const at = text.indexOf(open);
  if (at < 0) {
    return ok({ inner: undefined, main: text });
  }
  const close = "\n\n</details>";
  if (!text.endsWith(close) || text.length < at + open.length + close.length) {
    return stop({ at: "the Longer notes" });
  }
  return ok({ inner: text.slice(at + open.length, text.length - close.length), main: text.slice(0, at) });
}

/** A candidate prefix read structurally: the fields as found, before the schema and the re-render. */
interface PrefixReading {
  readonly candidate: Record<string, unknown>;
  readonly anchorRepo: RepoRef | undefined;
  readonly riskRows: RiskRowShape;
  readonly badges: BadgeRowShape;
  /** Each pasted block lifted out of the main part, with how many canonical blocks preceded it. */
  readonly lifted: readonly { readonly before: number; readonly raw: string }[];
}

/** Read a candidate prefix into the fields a stamped body would carry. */
function readPrefix({ prefix }: { prefix: string }): Result<PrefixReading, ReadingOrderError> {
  return splitNotes({ text: prefix.slice(0, -1) }).andThen(({ main, inner }) => {
    const { canonical, pasted: lifted } = liftPasted({ blocks: main.split("\n\n") });
    const cursor: Cursor = { at: 0, blocks: canonical };
    return readBadgeRow({ cursor }).andThen((facts) =>
      reviewersSection({ cursor }).andThen((reviewers) =>
        riskSection({ cursor }).andThen(({ risk, riskRows }) =>
          leftoversSection({ cursor }).andThen((reviewLeftovers) =>
            whatSection({ cursor, seen: facts.problemSeen }).andThen((what) =>
              codeSection({ cursor }).andThen((code) =>
                notesOf({ inner }).map((notes): PrefixReading => ({
                  anchorRepo: notes.anchorRepo,
                  badges: facts.badges,
                  candidate: {
                    ...what,
                    ...code,
                    problemSeen: facts.problemSeen,
                    risk,
                    writtenOn: facts.writtenOn,
                    ...(reviewers === undefined ? {} : { reviewers }),
                    ...(reviewLeftovers === undefined ? {} : { reviewLeftovers }),
                    ...(notes.notes === undefined ? {} : { notes: notes.notes }),
                    ...(notes.goldAnchor === undefined ? {} : { goldAnchor: notes.goldAnchor }),
                    ...(facts.review === undefined ? {} : { review: facts.review }),
                  },
                  lifted,
                  riskRows,
                })),
              ),
            ),
          ),
        ),
      ),
    );
  });
}

/**
 * Each lifted paste keyed to the canonical block it followed, read off the blocks the decoded body renders. A paste
 * after the last main block keys to that block — the notes are split off first — so a key is always found.
 */
function keyedPastes({
  lifted,
  render,
}: {
  lifted: PrefixReading["lifted"];
  render: Parameters<typeof renderStampedBlocks>[0];
}): readonly PastedMediaBlock[] {
  if (lifted.length === 0) {
    return [];
  }
  const blocks = renderStampedBlocks(render);
  const keys = blocks.isOk() ? blocks.value.map((block) => block.key) : [];
  return lifted.map(({ before, raw }) => ({ after: before === 0 ? "start" : keys[before - 1]!, raw }));
}

/** Decode, re-render and compare one candidate prefix — the postconditions every accepted read clears. */
function accept({
  reading,
  prefix,
  remainder,
}: {
  reading: PrefixReading;
  prefix: string;
  remainder: string;
}): Result<ReadingOrderParse, ReadingOrderError> {
  const decoded = stampedBodySchema.safeParse(reading.candidate);
  if (!decoded.success) {
    return err(ReadingOrderErrors.recoveredSchema({ issues: decoded.error.issues.map((issue) => issue.message) }));
  }
  const body = decoded.data;
  const anchor =
    body.goldAnchor === undefined || reading.anchorRepo === undefined
      ? undefined
      : { goldAnchor: body.goldAnchor, repo: reading.anchorRepo };
  const render = { anchor, badges: reading.badges, body, riskRows: reading.riskRows };
  const pasted = keyedPastes({ lifted: reading.lifted, render });
  // The WHOLE prefix, pastes put back, is what is compared — never the stripped body — so a pasted block is
  // accepted only in the exact place the re-render puts it, and every canonical byte is still checked.
  return renderStampedBody({ ...render, pasted }).andThen((rendered) =>
    rendered === prefix
      ? ok({
          anchorRepo: reading.anchorRepo,
          badges: reading.badges,
          body,
          pasted,
          remainder,
          riskRows: reading.riskRows,
        })
      : err<ReadingOrderParse, ReadingOrderError>(ReadingOrderErrors.nonCanonical()),
  );
}

/** One candidate split: everything before `end` must be a canonical render, everything after it opaque. */
function parseAt({ body, end }: { body: string; end: number }): Result<ReadingOrderParse, ReadingOrderError> {
  const prefix = body.slice(0, end);
  const remainder = body.slice(end);
  if (remainder.length > 0 && carriesAny({ markers: READING_ORDER_SENTINELS, text: remainder })) {
    return err(ReadingOrderErrors.trailingMarkup());
  }
  return readPrefix({ prefix }).andThen((reading) => accept({ prefix, reading, remainder }));
}

/**
 * Every place the body could end: after a `</ol>` line (Where to look) or a `</details>` line (the Longer
 * notes), longest-first — and after any pasted-media block, so a paste after the final main block of a notes-free
 * body is lifted and keyed rather than read as appended content, which an edit adding notes would otherwise move
 * below them. That holds with a third party's footer after the paste too.
 */
function splitCandidates({ body }: { body: string }): readonly number[] {
  const ends: number[] = [...pastedMediaEnds({ text: body })];
  for (const marker of ["</ol>\n", "\n</details>\n"]) {
    for (let at = body.indexOf(marker); at >= 0; at = body.indexOf(marker, at + 1)) {
      ends.push(at + marker.length);
    }
  }
  return ends.toSorted((a, b) => b - a);
}

/**
 * Read a reading-order pull-request body back into the stamped body that renders it.
 *
 * Line endings are read as LF: GitHub's web editor stores a body saved through it with CRLF, and every caller —
 * the gate, the whole-form review check, the live write stamp, an `--edit`'s recovery — means the content. The
 * remainder comes back with LF too. For the same reason a body ending on a pasted block that no newline closes —
 * github.com saves one typed at the end that way — is read with that newline, so the paste is keyed to the block
 * before it like any other.
 *
 * @param body the live body exactly as GitHub stores it, or undefined when the read yielded none
 * @returns the stamped body, the gold anchor's repository and the opaque remainder; or a typed refusal —
 *   `RETIRED_SHAPE` for the old table shape, naming the whole-replace conversion
 */
export function parseReadingOrderBody({
  body: raw,
}: {
  body: string | undefined;
}): Result<ReadingOrderParse, ReadingOrderError> {
  if (raw === undefined || raw.length === 0) {
    return err(ReadingOrderErrors.absentBody());
  }
  const lf = raw.replace(/\r\n/g, "\n");
  const endsOnUnclosedPaste = !lf.endsWith("\n") && pastedMediaEnds({ text: lf }).at(-1) === lf.length;
  const body = endsOnUnclosedPaste ? `${lf}\n` : lf;
  const isNew = carriesAny({ markers: READING_ORDER_SHAPE_MARKERS, text: body });
  if (!isNew && carriesAny({ markers: RETIRED_TABLE_MARKERS, text: body })) {
    return err(ReadingOrderErrors.retiredShape());
  }
  const outcomes = splitCandidates({ body }).map((end) => parseAt({ body, end }));
  const parsed = outcomes.find((outcome) => outcome.isOk());
  if (parsed !== undefined) {
    return parsed;
  }
  const first = outcomes[0];
  if (first !== undefined) {
    return first;
  }
  return err(ReadingOrderErrors.structure({ at: "the end of the body" }));
}
