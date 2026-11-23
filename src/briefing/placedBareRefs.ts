/**
 * Where each bare reference on a page sits, and which entry's links it resolves against: the marking and cutting
 * half of `./bareRef.ts`, which owns the finding and the refusing.
 *
 * Entry bounds, GitHub links and a form writer's own references are written into the markup as private-use marks
 * before it is stripped and cut into places, so each survives the strip and the cut, and then read back out of
 * each place's plain text with its position. A bare reference resolves against the nearest link in its own
 * entry (`./entryBareRefContext.ts`), or the page context when its entry links nothing.
 */
import {
  type AttestedNumber,
  attestedNumbersInText,
  type BareRefContext,
  type BareRefSpan,
  type RepoRef,
  scanBareRefs,
} from "../outbound/linkify/bareRefs.js";
import { bareRefContextAt, type EntryRepoAnchor } from "./entryBareRefContext.js";
import type { PagePlace } from "./pagePlaces.js";
import { balancedElement, plainText } from "./text.js";

/** Which region of the page a bare-reference defect was found in. */
export type BareRefRegion = "react-now" | "page";

/** One place, and its visible text with every mark taken out. */
export interface ReadPlace {
  readonly place: PagePlace;
  readonly region: BareRefRegion;
  readonly text: string;
}

/** One GitHub link the marks index into: its repository and the object numbers it proves exist there. */
export interface MarkedAnchor {
  readonly repo: RepoRef;
  readonly attested: readonly AttestedNumber[];
}

/** One bare reference found in an entry, with the context its entry resolves it against. */
export interface PlacedRef {
  readonly place: PagePlace;
  readonly region: BareRefRegion;
  readonly span: BareRefSpan;
  readonly context: BareRefContext;
  /** The writer's reference this one exactly IS — fenced on both ends and nowhere inside — or undefined. */
  readonly writerSpan: number | undefined;
}

/**
 * A link into a repository — never `github.com/orgs/<org>/…` or another of GitHub's own top-level routes. Other
 * attributes may stand either side of `href`: the renderer auto-links a URL in text as `<a class="raw" href=…>`,
 * which a Codex review measured going unread, so a note's own link was skipped for another note's. The
 * repository's own root, `github.com/<owner>/<repo>` with no path after it, names it just as well, and a host
 * is read in any case, as the entry's own link marks already read it.
 */
export const GITHUB_LINK =
  /<a (?:[^>]*?\s)?href="https:\/\/github\.com\/(?!(?:orgs|users|settings|apps|marketplace|sponsors|enterprises|topics|features|notifications|search)\/)([^"/]+)\/([^"/#?]+)(?:[/#?][^"]*)?"[^>]*>/gi;

/**
 * The marks this scan writes into the markup before it is cut into places, so an entry's bounds and its links'
 * positions survive the strip and the cut. Private-use characters, swapped out of the page first so only a mark
 * carries one, distinct from `./pagePlaces.ts`'s card fences, and neither `<` nor `>`, so no tag pattern matches
 * across one.
 */
const ENTRY_OPEN = "";
const ENTRY_CLOSE = "";
const LINK_OPEN = "";
const LINK_CLOSE = "";
/** One reference a form writer found: opened with its index, closed by {@link SPAN_END} — see {@link spanMarked}. */
const SPAN_OPEN = "";
const SPAN_CLOSE = "";
const SPAN_END = "";
/** Every private-use character this scan writes as a mark. */
export const ANY_SCAN_MARK_CHARACTER = /[-]/g;
/**
 * What a page-supplied scan character becomes before the marks go in: another private-use character, outside the
 * mark range, so it is still the non-word, non-space separator it was. A space would not be:`alert#N` blanked to a space reads as`alert #N` and the alert exemption hides it.
 * The residue, accepted: such a character in a heading reads as U+F8F0 in the place a defect names. Only a
 * form whose own text carries one shows it, and the label still names the right place.
 */
export const PAGE_MARK_STAND_IN = "";
/** The entry and link marks alone, which a span-marked fragment is swapped out of while its span marks stay. */
export const ENTRY_OR_LINK_MARK_CHARACTER = /[-]/g;

/**
 * `text` with every run of spaces read as one and none at either end, which is how the unmarked page text reads,
 * and where each character it keeps sits in `text`. `plainText` collapses whitespace while the marks still
 * stand, so a removed mark leaves a space either side of it; a Codex review measured that extra space pushing a
 * PR-list lead-in past its length limit, hiding the reference. Positions stay in `text`, so a link's distance
 * from a reference is measured exactly as before.
 */
function collapsedSpaces({ text }: { text: string }): { scan: string; at: readonly number[] } {
  const kept: string[] = [];
  const at: number[] = [];
  // By UTF-16 index, the unit every other position here counts in.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character !== " " || (kept.length > 0 && kept.at(-1) !== " ")) {
      kept.push(character);
      at.push(index);
    }
  }
  if (kept.at(-1) === " ") {
    kept.pop();
    at.pop();
  }
  return { at, scan: kept.join("") };
}

/** One mark as it reads in a place's plain text: an entry bound, a link or a span opening with its index, a span end. */
const SCAN_MARK = /||(\d+)|(\d+)|/g;

/**
 * One reference's text fenced by span marks carrying `index`, so `./bareRef.ts`'s `resolvedGithubRefsOf` can say
 * which of the writer's references each one it reads IS: it credits a reference only when its own reading starts
 * and ends exactly on one fence. The marks are taken out before anything is scanned or measured.
 *
 * @param index the reference's index in the writer's own list
 * @param text the reference's text, which must carry no private-use scan character of its own
 * @returns the fenced text
 */
export function spanMarked({ index, text }: { index: number; text: string }): string {
  return `${SPAN_OPEN}${String(index)}${SPAN_CLOSE}${text}${SPAN_END}`;
}

/** Every span mark {@link spanMarked} writes, as it sits in rendered markup. */
const SPAN_MARK = /\d+|/g;

/**
 * Rendered markup with every span mark taken out — what the same note renders to unmarked, when the renderer
 * treated the marks as the inert characters they are meant to be.
 *
 * @returns the markup without span marks
 */
export function withoutSpanMarks({ html }: { html: string }): string {
  return html.replace(SPAN_MARK, "");
}

/**
 * Whether a text carries any private-use character this scan writes as a mark.
 *
 * @returns true when one is there, so a writer fencing runs would have its own marks misread
 */
export function carriesScanMark({ text }: { text: string }): boolean {
  return new RegExp(ANY_SCAN_MARK_CHARACTER.source).test(text);
}

/** One scan mark in a place's label, with the space beside it and the quote it may sit against. */
const MARK_IN_LABEL = new RegExp(`(")?\\s*(?:${SCAN_MARK.source})\\s*(")?`, "g");

/**
 * A place's label with every scan mark taken out, as the chair should read it: a mark against a label's quote
 * goes with its space, as the link it stands for used to, and one inside a label leaves a single space.
 *
 * @internal
 * @returns the label without scan marks
 */
export function withoutScanMarks({ text }: { text: string }): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(
      MARK_IN_LABEL,
      (_mark, open: string | undefined, _link: unknown, _span: unknown, close: string | undefined) => {
        const quotes = [open, close].filter((quote) => quote !== undefined).join("");
        return quotes === "" ? " " : quotes;
      },
    );
  } while (current !== previous);
  // A label capped mid-mark leaves half a mark behind, which no complete-mark pattern matches.
  return current.replace(/[-]\d*/g, "");
}

/** An entry's opening tag — a react-now card or a note below the line, both `div.need`. */
const NEED_OPEN = /<div class="need"[^>]*>/g;

/**
 * The markup with every `div.need` fenced by entry marks just inside its own tags, outermost only — a card
 * inside a card is read with its parent, as `./pagePlaces.ts` reads it.
 *
 * @returns the fenced markup
 */
export function withEntryMarks({ html }: { html: string }): string {
  let out = "";
  let cursor = 0;
  for (const match of html.matchAll(NEED_OPEN)) {
    const element = match.index < cursor ? undefined : balancedElement({ html, start: match.index, tag: "div" });
    if (element === undefined) {
      continue;
    }
    const open = match.index + match[0].length;
    const close = match.index + element.length - "</div>".length;
    out += `${html.slice(cursor, open)}${ENTRY_OPEN}${html.slice(open, close)}${ENTRY_CLOSE}`;
    cursor = close;
  }
  return out + html.slice(cursor);
}

/** A whole GitHub repository link, label and all — the {@link GITHUB_LINK} shape with its element. */
const GITHUB_ANCHOR = new RegExp(`${GITHUB_LINK.source}[\\s\\S]*?</a>`, "gi");

/**
 * The markup with every GitHub repository link replaced by a mark carrying its index, and the links found.
 *
 * @param html the markup, entry marks already in it
 * @param anchors the list each found link is appended to, so one index space spans every region of the page
 * @returns the markup with each link standing as a mark
 */
export function withLinkMarks({ html, anchors }: { html: string; anchors: MarkedAnchor[] }): string {
  return html.replace(GITHUB_ANCHOR, (anchor, owner: string, repo: string) => {
    anchors.push({ attested: attestedNumbersInText({ text: anchor }), repo: { owner, repo } });
    return `${LINK_OPEN}${String(anchors.length - 1)}${LINK_CLOSE}`;
  });
}

/** What reading the places so far has opened, linked and fenced, in positions running across every place. */
interface ScanState {
  readonly entryAnchors: Map<number, EntryRepoAnchor[]>;
  /** Where each writer reference opens (its index) and ends (undefined), in the same positions anchors use. */
  readonly spanBounds: { at: number; opens: number | undefined }[];
  readonly open: number[];
  entries: number;
  offset: number;
}

/**
 * Apply one mark to the scan's state.
 *
 * @param at the mark's position across every place
 * @returns whether the mark opened or closed an entry, so the entry text after it belongs to changed
 */
function readMark({
  mark,
  state,
  anchors,
  at,
}: {
  mark: RegExpMatchArray;
  state: ScanState;
  anchors: readonly MarkedAnchor[];
  at: number;
}): boolean {
  if (mark[0] === ENTRY_OPEN) {
    state.entryAnchors.set(state.entries, []);
    state.open.push(state.entries);
    state.entries += 1;
    return true;
  }
  if (mark[0] === ENTRY_CLOSE) {
    state.open.pop();
    return true;
  }
  if (mark[0] === SPAN_END || mark[2] !== undefined) {
    state.spanBounds.push({ at, opens: mark[2] === undefined ? undefined : Number(mark[2]) });
    return false;
  }
  const entry = state.open.at(-1);
  // SCAN_MARK's link arm always captures the index `withLinkMarks` wrote, and every index names a link.
  const anchor = anchors[Number(mark[1]!)]!;
  if (entry !== undefined) {
    state.entryAnchors.get(entry)!.push({ at, attested: anchor.attested, repo: anchor.repo });
  }
  return false;
}

/**
 * One place's marked text read into its visible text, each mark applied to the state as it is passed.
 *
 * @param marked the place's plain text, marks still in it
 * @returns the visible text, and from which position of it each run belongs to which entry
 */
function readPlaceText({
  marked,
  state,
  anchors,
}: {
  marked: string;
  state: ScanState;
  anchors: readonly MarkedAnchor[];
}): { text: string; entryAt: readonly { from: number; entry: number | undefined }[] } {
  let text = "";
  let cursor = 0;
  const entryAt: { from: number; entry: number | undefined }[] = [{ entry: state.open.at(-1), from: 0 }];
  for (const mark of marked.matchAll(SCAN_MARK)) {
    text += marked.slice(cursor, mark.index);
    cursor = mark.index + mark[0].length;
    if (readMark({ anchors, at: state.offset + text.length, mark, state })) {
      entryAt.push({ entry: state.open.at(-1), from: text.length });
    }
  }
  return { entryAt, text: text + marked.slice(cursor) };
}

/**
 * The writer reference a reading from `start` to `end` exactly is: one opened at its start, closed at its end,
 * and with no fence inside it.
 *
 * @returns the writer's index, or undefined when the reading is not exactly one of the writer's
 */
function writerSpanAt({
  spanBounds,
  start,
  end,
}: {
  spanBounds: readonly { at: number; opens: number | undefined }[];
  start: number;
  end: number;
}): number | undefined {
  const opener = spanBounds.find((bound) => bound.at === start && bound.opens !== undefined);
  const closed = spanBounds.some((bound) => bound.at === end && bound.opens === undefined);
  const inside = spanBounds.some((bound) => bound.at > start && bound.at < end);
  return closed && !inside ? opener?.opens : undefined;
}

/**
 * Every bare reference in a run of places, each resolved against the nearest GitHub link in its own entry,
 * or against the page's context when its entry links nothing — see `./entryBareRefContext.ts`.
 *
 * Places are read in the order given, and an entry is open from its opening mark to its closing one, so a note
 * whose headline and folds were cut into several places is still one entry. Positions run across places with
 * one separator between each, which is all a distance inside one entry needs.
 *
 * @param places each place and the region it sits in, in page order within each region
 * @param anchors every GitHub link the marks index into
 * @param fallback the page's own context
 * @returns every bare reference, in place order, and each place's visible text
 */
export function placedRefs({
  places,
  anchors,
  fallback,
}: {
  places: readonly { place: PagePlace; region: BareRefRegion }[];
  anchors: readonly MarkedAnchor[];
  fallback: BareRefContext;
}): { refs: readonly PlacedRef[]; read: readonly ReadPlace[] } {
  const state: ScanState = { entries: 0, entryAnchors: new Map(), offset: 0, open: [], spanBounds: [] };
  const found: (Omit<PlacedRef, "context"> & { entry: number | undefined; at: number })[] = [];
  const read: ReadPlace[] = [];
  for (const { place: cut, region } of places) {
    // A label that held a link carries its mark; the chair reads the label with every mark taken out.
    const place = { ...cut, where: withoutScanMarks({ text: cut.where }) };
    const { text, entryAt } = readPlaceText({ anchors, marked: plainText({ html: place.html }), state });
    // Scanned as the unmarked page reads, positions kept in this text: a removed mark leaves two spaces.
    const { scan, at: inText } = collapsedSpaces({ text });
    for (const scanned of scanBareRefs({ context: fallback, text: scan })) {
      // Every scanned character came from one of the text's, and a reference is never empty.
      const span = { ...scanned, end: inText[scanned.end - 1]! + 1, start: inText[scanned.start]! };
      const entry = entryAt.findLast((bound) => bound.from <= span.start)!.entry;
      const [start, end] = [state.offset + span.start, state.offset + span.end];
      const writerSpan = writerSpanAt({ end, spanBounds: state.spanBounds, start });
      found.push({ at: state.offset, entry, place, region, span, writerSpan });
    }
    read.push({ place, region, text });
    state.offset += text.length + 1;
  }
  const refs = found.map(({ place, region, span, entry, at, writerSpan }) => ({
    context: bareRefContextAt({
      // Every opened entry was given its list when it opened; text in no entry links nothing of its own.
      anchors: entry === undefined ? [] : state.entryAnchors.get(entry)!,
      end: at + span.end,
      fallback,
      start: at + span.start,
    }),
    place,
    region,
    span,
    writerSpan,
  }));
  return { read, refs };
}
