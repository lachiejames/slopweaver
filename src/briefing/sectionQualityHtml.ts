/**
 * The READER's projection: one rendered briefing page read as the disclosure levels `./sectionQuality.ts`
 * judges, and the adapter `./check.ts` calls.
 *
 * `../outbound/briefing/sectionQuality.ts` is the writer's projection of the same thing off the typed form.
 * The two are held to agreeing by `src/__tests__/unit/briefing/sectionQualityParity.test.ts`, which renders
 * a form and asserts both projections produce the same sections and the same text — the failure this pair
 * cannot afford is a form that admits what `briefing render`'s own check then refuses.
 *
 * ## Why this is not `ungloss` over `plainText` of a region
 *
 * Codex's planning pass named three ways that reading is wrong, and each is a rule here:
 *
 * 1. **A region's plain text runs its cells together**, so two adjacent blocks can manufacture a fleet
 *    collocation ("…the board" + "rows…") or a definitional frame nobody wrote. Cells are extracted
 *    separately and joined with `./sectionQuality.ts`'s `CELL_SEPARATOR`, which no pattern in
 *    `./fleetJargon.ts` can cross.
 * 2. **It would credit a definition the reader has not opened.** A fold's contents are their own level, and
 *    a gloss travels DOWN into a nested fold, never up out of one.
 * 3. **It would read text nobody here composed** — the owner's own list is a projection of what the session-start
 *    verb found, so this skips the section the renderer marks `data-section="your-list"` outright.
 *
 * ## The structural markers, and why the page carries them
 *
 * `../outbound/briefing/render.ts` stamps `class="sub lede"` on the lede, `data-section` on the two folds
 * whose identity a reader cannot infer, and `class="ask"` around a ranked line's own ask. Without them this
 * file would be guessing: the page carries four other `p.sub` contract lines, the `recent` fold and the
 * history folds are siblings under one heading, and a ranked line's ask sits between a page title somebody
 * else wrote and two stamps the renderer computed.
 *
 * A page rendered BEFORE those markers existed carries none of them. That is not silently clean: the section
 * this file cannot identify becomes a `section-parse` defect, and `./fleetJargon.ts`'s reader-only
 * break-glass lifts it for exactly the archive case it was built for. That lane is stated rather than
 * assumed — a defect outside the break-glass would make `briefing check` refuse an old page with no way
 * through, which makes the verb useless on the pages a correction has to be computed against. `briefing
 * render` lifts nothing, so a CURRENT render can never carry one.
 *
 * Pure: HTML in, defects out.
 */
import {
  LEDE_CLASS,
  QUOTED_NOTE_ID,
  RECENT_ID,
  RECENT_SECTION_NAME,
  YOUR_LIST_ID,
} from "../outbound/briefing/types.js";
import {
  ALIGNMENT_SECTION,
  CELL_SEPARATOR,
  checkSectionQuality,
  LEDE_SECTION,
  RANKED_SECTION,
  type SectionQualityAsk,
  type SectionQualityCheck,
  type SectionQualityInput,
  type SectionQualityPointer,
  type SectionQualityScope,
} from "./sectionQuality.js";
import { balancedElement, plainText } from "./text.js";

const STYLE_OR_SCRIPT = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const H1_CLOSE = /<\/h1>/i;
const ANY_H2_OPEN = /<h2[ >]/i;
const LEDE_PARAGRAPH = new RegExp(`<p class="sub ${LEDE_CLASS}"[^>]*>([\\s\\S]*?)</p>`, "i");
const RANKED_LINE = /<p class="ranked"[^>]*>([\s\S]*?)<\/p>/gi;
const RANKED_ASK = /<span class="ask">([\s\S]*?)<\/span>/i;
const RANKED_AGE = /<span class="age" data-landed-iso="([^"]*)"[^>]*>([\s\S]*?)<\/span>/i;
const ALIGNMENT_HEADING = /<h2[^>]*>\s*(?:what we are actually working|what the fleet is working on)\s*<\/h2>/i;
const RECENT_HEADING = /<h2[^>]*>\s*done since you last looked\s*<\/h2>/i;
const DETAILS_OPEN = /<details\b[^>]*>/gi;
const SUMMARY = /<summary[^>]*>([\s\S]*?)<\/summary>/i;
const SECTION_ROLE = /\sdata-section="([^"]*)"/i;
/**
 * Every element that is one cell of prose at its own level. `div.q` is a note's own headline.
 *
 * A lazy body is correct here and nowhere else in this file: every fold has already been removed from the
 * fragment these run over, so the nested `</div>` that `../briefing/pageBudget.ts` has to walk past cannot
 * be present. One alternative per element rather than one alternation of names, because `div class="q"`
 * carries no word boundary after its quote.
 */
const CELL = new RegExp(
  [
    String.raw`<p\b[^>]*>([\s\S]*?)<\/p>`,
    String.raw`<li\b[^>]*>([\s\S]*?)<\/li>`,
    String.raw`<dd\b[^>]*>([\s\S]*?)<\/dd>`,
    String.raw`<div class="q">([\s\S]*?)<\/div>`,
    // A paste block's LABEL and an image's alt and caption are composed prose too, and each is the only
    // wording in its element. A missing paste label would let the form count its gloss while the page could not
    // see it, so a form that explained a word in one would parse clean and render refused.
    String.raw`<span class="paste-label">([\s\S]*?)<\/span>`,
    String.raw`<figcaption>([\s\S]*?)<\/figcaption>`,
    String.raw`<img [^>]*\balt="([^"]*)"`,
  ].join("|"),
  "gi",
);

/** One `<details>` element found at one level, split into the parts each level owns. */
interface FoldElement {
  readonly summary: string;
  readonly inner: string;
  readonly role: string | undefined;
}

/** Every top-level `<details>` in one fragment, and the fragment with all of them removed. */
function splitFolds({ html }: { html: string }): { readonly own: string; readonly folds: readonly FoldElement[] } {
  const folds: FoldElement[] = [];
  let own = "";
  let cursor = 0;
  const opens = new RegExp(DETAILS_OPEN.source, DETAILS_OPEN.flags);
  for (const open of html.matchAll(opens)) {
    if (open.index < cursor) {
      continue;
    }
    const element = balancedElement({ html, start: open.index, tag: "details" });
    if (element === undefined) {
      break;
    }
    own += `${html.slice(cursor, open.index)} `;
    cursor = open.index + element.length;
    const summary = SUMMARY.exec(element);
    folds.push({
      inner: summary === null ? element : element.slice(summary.index + summary[0].length),
      role: SECTION_ROLE.exec(open[0])?.[1],
      summary: summary?.[1] === undefined ? "" : plainText({ html: summary[1] }),
    });
  }
  return { folds, own: own + html.slice(cursor) };
}

/** Every cell of prose written at ONE level, in page order. */
function cellsOf({ html }: { html: string }): readonly string[] {
  const cells = new RegExp(CELL.source, CELL.flags);
  // One alternative matches per cell, so exactly one capture group is filled and the rest are empty. The
  // types say `string`, which is why this is a filter on emptiness rather than on `undefined`.
  return [...html.matchAll(cells)].flatMap((match) => {
    const body = match.slice(1).join("");
    const text = plainText({ html: body });
    return text.length === 0 ? [] : [text];
  });
}

/**
 * One disclosure level and every level nested inside it.
 *
 * @param html the level's markup
 * @param section the section's name, carried down into every nested level
 * @param ancestors the text of every level enclosing this one
 * @param lead cells the caller owns that belong to this level, ahead of the markup's own
 * @returns the level and its descendants, in reading order
 */
function levelScopes({
  html,
  section,
  ancestors,
  lead,
}: {
  html: string;
  section: string;
  ancestors: readonly string[];
  lead: readonly string[];
}): readonly SectionQualityScope[] {
  const { own, folds } = splitFolds({ html });
  const cells = [...lead, ...cellsOf({ html: own }), ...folds.map((fold) => fold.summary)];
  const text = cells.filter((cell) => cell.length > 0).join(CELL_SEPARATOR);
  return [
    { ancestors, path: [], section, text },
    // A fold the renderer marked QUOTED holds the owner's own recorded words, so this level reads its summary —
    // which the projection composed — and goes no deeper. Same call `logScopes` makes about the owner's list one
    // level up, and the writer's projection makes the identical one off `BriefingNote.lane`.
    ...folds.flatMap((fold) =>
      fold.role === QUOTED_NOTE_ID
        ? []
        : levelScopes({ ancestors: [...ancestors, text], html: fold.inner, lead: [], section }),
    ),
  ];
}

/** The markup between one heading and the next `<h2>`, absent when the page carries no such heading. */
function regionAfter({ html, heading }: { html: string; heading: RegExp }): string | undefined {
  const match = heading.exec(html);
  if (match === null) {
    return undefined;
  }
  const after = html.slice(match.index + match[0].length);
  const next = ANY_H2_OPEN.exec(after);
  return next === null ? after : after.slice(0, next.index);
}

/** The lede: the marked `p.sub` between the `<h1>` and the first `<h2>`. */
function ledeText({ html }: { html: string }): string | undefined {
  const heading = H1_CLOSE.exec(html);
  if (heading === null) {
    return undefined;
  }
  const after = html.slice(heading.index + heading[0].length);
  const next = ANY_H2_OPEN.exec(after);
  const region = next === null ? after : after.slice(0, next.index);
  const paragraph = LEDE_PARAGRAPH.exec(region);
  return paragraph?.[1] === undefined ? undefined : plainText({ html: paragraph[1] });
}

/** One ranked line, split into the ask a session composed and the age the renderer computed. */
interface RankedLine {
  readonly ask: string | undefined;
  readonly landedIso: string | undefined;
  readonly renderedAge: string | undefined;
}

/** Every line of the ranked open-pages index, in page order. */
function rankedLines({ html }: { html: string }): readonly RankedLine[] {
  const lines = new RegExp(RANKED_LINE.source, RANKED_LINE.flags);
  return [...html.matchAll(lines)].map((match) => {
    // The pattern has exactly one group and it always participates, so the assertion is honest rather than
    // a coalesce hiding a shape this could not read.
    const line = match[1]!;
    const ask = RANKED_ASK.exec(line);
    const age = RANKED_AGE.exec(line);
    return {
      ask: ask?.[1] === undefined ? undefined : plainText({ html: ask[1] }),
      landedIso: age?.[1],
      renderedAge: age?.[2] === undefined ? undefined : plainText({ html: age[2] }),
    };
  });
}

/** What the ranked band contributes: one ask and one pointer per readable line, one problem per unreadable. */
interface RankedBand {
  readonly asks: readonly SectionQualityAsk[];
  readonly pointers: readonly SectionQualityPointer[];
  readonly parseProblems: readonly string[];
}

/**
 * The ranked open-pages index, split into what each rule reads.
 *
 * A line whose ask or landing instant this cannot find becomes a parse problem rather than half a reading:
 * the markers are the renderer's, so their absence means an archive or a hand-written page, and judging its
 * wording off the label beside the ask would refuse a page title somebody else wrote.
 *
 * @param html the whole page
 * @returns the asks, the pointers and one problem per line that could not be read
 */
function rankedBand({ html }: { html: string }): RankedBand {
  const asks: SectionQualityAsk[] = [];
  const pointers: SectionQualityPointer[] = [];
  const parseProblems: string[] = [];
  for (const [index, line] of rankedLines({ html }).entries()) {
    if (line.ask === undefined || line.landedIso === undefined) {
      parseProblems.push(
        `line ${String(index + 1)} of ${RANKED_SECTION} carries no marked ask or no landing instant, so its ` +
          "wording and its age cannot be judged. Re-render the page with `slopweaver briefing render`.",
      );
      continue;
    }
    asks.push({ path: [], section: RANKED_SECTION, text: line.ask });
    pointers.push({ landedIso: line.landedIso, path: [], renderedAge: line.renderedAge, section: RANKED_SECTION });
  }
  return { asks, parseProblems, pointers };
}

/**
 * Every collapsed section under the recent heading, as its own disclosure levels.
 *
 * The owner's own list is skipped by its role. The `recent` fold's own summary counts its landings, so it would name
 * the same section differently on every page — the heading's words are what both halves of the gate use
 * instead. Every other collapsed section carries the summary the COMPOSER wrote, which is a cell of that
 * section like any other.
 *
 * @param html the markup after the recent heading
 * @returns every level of every collapsed section, in page order
 */
function logScopes({ html }: { html: string }): readonly SectionQualityScope[] {
  return splitFolds({ html }).folds.flatMap((fold) => {
    if (fold.role === YOUR_LIST_ID) {
      return [];
    }
    const named = fold.role === RECENT_ID;
    return levelScopes({
      ancestors: [],
      html: fold.inner,
      lead: named ? [] : [fold.summary],
      section: named ? RECENT_SECTION_NAME : `"${fold.summary}"`,
    });
  });
}

/**
 * Project one rendered page into the scopes, asks and pointers the section rules read.
 *
 * @param html the whole artifact file
 * @returns every disclosure level outside the cards and the owner's own list, every ranked ask and pointer, the
 *   lede, and one parse problem per structural role the page carries in a shape this cannot read
 */
export function sectionQualityOfHtml({ html }: { html: string }): SectionQualityInput {
  const page = html.replace(STYLE_OR_SCRIPT, " ");
  const lede = ledeText({ html: page });
  const band = rankedBand({ html: page });
  const alignment = regionAfter({ heading: ALIGNMENT_HEADING, html: page });
  const log = regionAfter({ heading: RECENT_HEADING, html: page });
  const scopes: readonly SectionQualityScope[] = [
    ...(lede === undefined ? [] : [{ ancestors: [], path: [], section: LEDE_SECTION, text: lede }]),
    ...(band.asks.length === 0
      ? []
      : [
          {
            ancestors: [],
            path: [],
            section: RANKED_SECTION,
            text: band.asks.map((ask) => ask.text).join(CELL_SEPARATOR),
          },
        ]),
    ...(alignment === undefined
      ? []
      : levelScopes({ ancestors: [], html: alignment, lead: [], section: ALIGNMENT_SECTION })),
    ...(log === undefined ? [] : logScopes({ html: log })),
  ];
  return {
    asks: band.asks,
    lede,
    parseProblems: band.parseProblems,
    pointers: band.pointers,
    scopes: scopes.filter((scope) => scope.text.length > 0),
  };
}

/**
 * Check one rendered briefing page's sections against the card gate's plain-wording and ask-framing rules.
 *
 * @param html the whole artifact file
 * @param applyFraming whether the vocabulary, ask-framing and pointer rules run, lifted by the same
 *   reader-only break-glass the four card-framing rules honour
 * @returns how many disclosure levels were read, and one defect per rule broken
 */
export function checkBriefingSections({
  html,
  applyFraming,
}: {
  html: string;
  applyFraming: boolean;
}): SectionQualityCheck {
  return checkSectionQuality({ applyFraming, input: sectionQualityOfHtml({ html }) });
}
