/**
 * The card gate's PLAIN-WORDING and ASK-FRAMING rules, read over every section of the briefing rather than
 * over a react-now card alone.
 *
 * The card-quality gate's four rules are scoped to a card, and the whole briefing is held to the same plain
 * way of writing, since it is much easier to read. Without this file everything else on the page would be held
 * to lengths and to nothing at all about how it READS.
 *
 * ## What was measured, and the one length that moved
 *
 * MEASURED over the 156 forms this install has rendered
 * (`yarn tsx src/measurement/briefingSectionQuality.entry.ts`, which prints the whole table):
 *
 * ```text
 *   cell                     n     median words  max   over 60w      unglossed fleet word
 *   card `what` (gated)      726   52            60    0             42, every one pre-gate
 *   header lede              156   64            155   79 (51%)      50 (32%)
 *   recent note headline     627   93            157   589 (94%)     292 (47%)
 *   earlier-today headline   2867  95            162   2857 (99.7%)  1844 (64%)
 *   history note headline    2432  12            29    0             0
 *   alignment headline       156   38            50    0             0
 * ```
 *
 * The length half of that table is deliberately NOT acted on below the fold. `./caps.ts` § "The three per-cell
 * fold caps that stood here for one day" records that every per-cell word and sentence cap comes off prose
 * INSIDE a fold — 148 of one dry render's 169 refusals landed in `earlierToday` and `history`, the folded log
 * nobody reads unfolded. `recent`, `earlierToday`, `history` and the owner's own list all render inside a
 * `<details>`, so a length rule there would reverse a standing ruling. The two rules do not collide: one is
 * about FRAMING and VOCABULARY, the other about LENGTH. This file takes the first everywhere and leaves the
 * second exactly where `./caps.ts` left it. The one length that moved is `./caps.ts`'s `LEDE_MAX_WORDS`, on the one composed cell above the fold that had
 * no word cap at all.
 *
 * ## A SCOPE is one disclosure level, and that is what the gloss may come from
 *
 * `./fleetJargon.ts` lets a card gloss a word anywhere above its own fold, because a card is what a reader
 * meets in one go. A section is that unit one level up, with one correction the measurement cannot settle on
 * its own: a definition a reader has NOT opened explains nothing. So a
 * scope is one disclosure level — a section's own visible prose, or one fold's contents — and a gloss counts
 * from that level or from any level ENCLOSING it, never from a sibling fold, a descendant fold or another
 * section. That is the card rule's own principle ("a term explained only inside a `details` body is a term
 * the owner meets unexplained") applied downwards instead of abandoned.
 *
 * MEASURED by running the shipped projection over those same forms — 147 of the 156 in a shape this
 * projection can read — and counting the DISCLOSURE LEVELS it refuses: `recent` 601 of 735 (82%),
 * `earlierToday` 2,771 of 4,488 (62%), `history` 294 of 882 (33%), the lede 50 of 147 (34%) and the
 * alignment line 31 of 441 (7%). That is a real cost and it is stated rather than buried; what makes it
 * payable is that the refusal names ONE word and the plain phrase that replaces it, so the fix is a
 * substitution rather than the re-composition the per-cell length caps would ask for.
 *
 * ## Cells inside one scope are joined by a separator no collocation crosses
 *
 * {@link CELL_SEPARATOR}. Two adjacent cells must not be able to manufacture a fleet collocation
 * ("…the board · rows…") or a definitional frame ("…row · is one entry…") that neither cell wrote, and a
 * plain space between them does exactly that. Both halves of the gate join with this one string, which is
 * also why the HTML reader extracts cells rather than taking one region's whole plain text.
 *
 * Pure: scopes, asks and pointers in, defects out. No I/O, no clock — the instant a pointer's age is judged
 * against is a VALUE the caller read, the same way `./cardPremise.ts` takes one.
 */
import { LEDE_MAX_WORDS } from "./caps.js";

import { DOCTRINE_SETTLED_ADVICE, doctrineSettled, MECHANISM_ADVICE, mechanismFramed } from "./doctrineSettled.js";
import { FLEET_JARGON_ADVICE, ungloss } from "./fleetJargon.js";
import { wordCount } from "./text.js";

/**
 * What separates two cells of one scope when they are joined for the vocabulary read.
 *
 * A middle dot with spaces around it, because every fleet collocation and every gloss frame in
 * `./fleetJargon.ts` is built from words, `\s+`, commas, dashes and brackets — none of which matches this —
 * so two cells can never combine into a use or into a definition neither of them wrote.
 */
export const CELL_SEPARATOR = " · ";

/**
 * Which section rule the page or the form broke.
 *
 * @internal — the tag on a {@link SectionQualityDefect}; a caller reads the `reason`, never the code.
 */
export type SectionQualityRule =
  "section-parse" | "fleet-jargon" | "lede-words" | "settled-ask" | "mechanism-ask" | "pointer-instant" | "pointer-age";

/**
 * One section defect.
 *
 * @internal — the row {@link SectionQualityCheck} carries; `../briefing/check.ts` prints it through that.
 */
export interface SectionQualityDefect {
  readonly rule: SectionQualityRule;
  /** The section, as both halves of the gate print it — `the lede`, `"earlier today, in order" › note 2`. */
  readonly section: string;
  /** Where the writer's own refusal points; empty for a defect only the rendered page can carry. */
  readonly path: readonly (string | number)[];
  readonly reason: string;
}

/**
 * One disclosure level of one section: the prose a reader has open at that level, and the prose enclosing it.
 *
 * `text` is where a fleet word is READ FROM. `ancestors` is the extra text a gloss may come from and is
 * never searched for uses, because a use in an enclosing level is that level's own scope's defect and
 * reporting it twice would name the wrong section.
 */
export interface SectionQualityScope {
  readonly section: string;
  readonly path: readonly (string | number)[];
  readonly text: string;
  readonly ancestors: readonly string[];
}

/** One cell that asks the owner for something: a ranked open page's ask, held to a card question's framing. */
export interface SectionQualityAsk {
  readonly section: string;
  readonly path: readonly (string | number)[];
  readonly text: string;
}

/**
 * One pointer the RENDERED page ranks, with the instant it landed and the age the page printed for it.
 *
 * `renderedAge` is what a reader actually sees, which is the half `./cardPremise.ts` had to add for a card:
 * an instant in an attribute nobody renders dates nothing. It is a READER-only lane — the form carries the
 * instant and `./schema.ts`'s `instant` already refuses one no clock can parse, so the writer's projection
 * emits no pointers rather than judging a line the renderer has not written yet.
 */
export interface SectionQualityPointer {
  readonly section: string;
  readonly path: readonly (string | number)[];
  readonly landedIso: string;
  readonly renderedAge: string | undefined;
}

/** The whole page or form, projected into what these rules read. */
export interface SectionQualityInput {
  readonly scopes: readonly SectionQualityScope[];
  readonly asks: readonly SectionQualityAsk[];
  readonly pointers: readonly SectionQualityPointer[];
  /** The lede's own text, absent when the page carries none. */
  readonly lede: string | undefined;
  /** Anything the projection could not read, which is a defect rather than a silently clean result. */
  readonly parseProblems: readonly string[];
}

/** What checking one page's or one form's sections found. */
export interface SectionQualityCheck {
  readonly scopesChecked: number;
  readonly defects: readonly SectionQualityDefect[];
}

/** The lede's own path in the form, so a refusal lands on the field a composer edits. */
export const LEDE_PATH: readonly (string | number)[] = ["header", "lede"];

/** The section name both halves print for the page's opening paragraph. */
export const LEDE_SECTION = "the lede";

/** The section name both halves print for the ranked index of open pages. */
export const RANKED_SECTION = "the ranked open-pages index";

/** The section name both halves print for the forced alignment line and its two folds. */
export const ALIGNMENT_SECTION = "the alignment line";

/**
 * The plain-wording rule over one disclosure level.
 *
 * @param scope the level's own text, plus every level enclosing it
 * @returns the defect, or `undefined` when every fleet word the level uses is explained where the owner can see it
 */
function jargonDefect({ scope }: { scope: SectionQualityScope }): SectionQualityDefect | undefined {
  const found = ungloss({
    aboveFold: scope.text,
    glossScope: [...scope.ancestors, scope.text].join(CELL_SEPARATOR),
  });
  if (found === undefined) {
    return undefined;
  }
  return {
    path: scope.path,
    reason:
      `${scope.section} uses the fleet word "${found.used}" and never says what it means — ` +
      `"${found.term}" here is ${found.plainly}. ${FLEET_JARGON_ADVICE}`,
    rule: "fleet-jargon",
    section: scope.section,
  };
}

/**
 * Whether one ask cell actually ASKS, rather than describing what a page is about.
 *
 * A ranked ask such as "the page is out, discussion first, implementation held" carries the bare word
 * `implementation`, which `./doctrineSettled.ts`'s registry matches — and the line is not asking the owner to
 * pick one, it is reporting that nobody is building yet. A card's `question` is required to end in `?`, so the
 * registry never had to tell the two apart; an `ask` is free prose and does.
 *
 * The trade is stated rather than hidden: an ask that puts a mechanism choice to the owner WITHOUT asking a
 * question escapes both rules here. That is the same call `./fleetJargon.ts` makes about a collocation — a
 * rule that fires on every mention of a word fires on nothing useful.
 */
function asksAQuestion({ text }: { text: string }): boolean {
  return text.includes("?") || /^\s*(?:should|shall|which|who|what|do we|does he|can we|is it)\b/i.test(text);
}

/**
 * The card question's two framing rules over one cell that asks the owner for something.
 *
 * A ranked open page's `ask` is the cell a card's `question` is — the one sentence saying what this line
 * wants from the owner — so it carries the same two refusals, wherever it is actually asking
 * ({@link asksAQuestion}). It deliberately does NOT carry `./optionPickability.ts`'s rule: that one refuses a
 * choice that sends the owner elsewhere to decide, and sending them to the page is this band's entire job.
 *
 * @internal — one leg of {@link checkSectionQuality}; no caller outside this module names it.
 *
 * @param ask the cell
 * @returns every framing defect it carries, in the order the card gate reports them
 */
function askFramingDefects({ ask }: { ask: SectionQualityAsk }): readonly SectionQualityDefect[] {
  if (!asksAQuestion({ text: ask.text })) {
    return [];
  }
  const defects: SectionQualityDefect[] = [];
  const settled = doctrineSettled({ question: ask.text });
  if (settled !== undefined) {
    defects.push({
      path: ask.path,
      reason:
        `${ask.section} asks permission for ${settled.act}, which is already settled by ${settled.settledBy}. ` +
        DOCTRINE_SETTLED_ADVICE,
      rule: "settled-ask",
      section: ask.section,
    });
  }
  const framed = mechanismFramed({ question: ask.text });
  if (framed !== undefined) {
    defects.push({
      path: ask.path,
      reason: `${ask.section} asks the owner to choose between implementations, with "${framed}". ${MECHANISM_ADVICE}`,
      rule: "mechanism-ask",
      section: ask.section,
    });
  }
  return defects;
}

/**
 * The premise rule over one ranked pointer: a landing instant a clock can read, and an age the page PRINTED.
 *
 * The rule for a card, over the band that needs it most: a ranked line printing the landing STAMP alone
 * leaves the one thing the owner wants from it — how long this page has been sitting there — a subtraction
 * to do against the eyebrow.
 *
 * ## Two halves of the card's own rule are deliberately absent
 *
 * **The FUTURE arm.** A card's premise is something a session READ, so an instant after the page's own
 * refresh is incoherent. A ranked page's `landedIso` is when it appeared, and the open-pages document is
 * read when the page is BUILT rather than when the corpus was — so a page landing between those two
 * instants is ordinary, and `src/__tests__/unit/outbound/briefing/form/fixtures.ts`'s own `openArtifact`
 * carries exactly that shape. Refusing it would refuse a true statement.
 *
 * **The exact WORDING.** The reader is handed the instant the corpus was read, never the instant the page
 * was rendered, and the renderer dates this band from the second. Re-deriving the words from the wrong clock
 * would refuse a correct page, and a tolerance around it would be a number sized by nothing. So what is
 * refused is an age that is not there at all — which is the defect that reaches the owner.
 *
 * @param pointer the ranked line
 * @returns every premise defect the pointer carries
 */
function pointerDefects({ pointer }: { pointer: SectionQualityPointer }): readonly SectionQualityDefect[] {
  if (Number.isNaN(Date.parse(pointer.landedIso))) {
    return [
      {
        path: pointer.path,
        reason:
          `${pointer.section} carries the landing instant "${pointer.landedIso}", which no clock can parse, ` +
          "so the page cannot say how long it has been open on the owner.",
        rule: "pointer-instant",
        section: pointer.section,
      },
    ];
  }
  if (pointer.renderedAge !== undefined) {
    return [];
  }
  return [
    {
      path: pointer.path,
      reason:
        `${pointer.section} prints a landing stamp with no age beside it, so how long the page has been ` +
        "waiting is a subtraction the owner has to do themselves. Re-render with `slopweaver briefing render`.",
      rule: "pointer-age",
      section: pointer.section,
    },
  ];
}

/**
 * The lede's word cap, which is the one LENGTH these rules add — see `./caps.ts`'s `LEDE_MAX_WORDS`.
 *
 * @param lede the lede's text
 * @returns the defect, or `undefined` when it is inside the cap
 */
function ledeDefect({ lede }: { lede: string }): SectionQualityDefect | undefined {
  const words = wordCount({ text: lede });
  if (words <= LEDE_MAX_WORDS) {
    return undefined;
  }
  return {
    path: LEDE_PATH,
    reason:
      `${LEDE_SECTION} runs to ${String(words)} words, over the cap of ${String(LEDE_MAX_WORDS)}. ` +
      "It is the first thing the owner reads and it is held to what a card's `what` is held to — say the one thing " +
      "the page is about, and let the sections below carry the rest.",
    rule: "lede-words",
    section: LEDE_SECTION,
  };
}

/**
 * Check one projected page or form against the section rules.
 *
 * @param input the page or the form, projected into scopes, asks and pointers
 * @param applyFraming whether the vocabulary, ask-framing and pointer rules run at all, lifted by
 *   `./fleetJargon.ts`'s `CARD_FRAMING_OVERRIDE_ENV` at the reading door and never at the publishing one.
 *   The lede's cap is a LENGTH and runs either way, exactly as every other cap does.
 * @returns how many disclosure levels were read, and one defect per rule broken
 */
export function checkSectionQuality({
  input,
  applyFraming,
}: {
  input: SectionQualityInput;
  applyFraming: boolean;
}): SectionQualityCheck {
  const lede = input.lede === undefined ? undefined : ledeDefect({ lede: input.lede });
  // The LEDE's cap is a length and runs either way, exactly as every other cap does. A PARSE problem does
  // not: it fires when a page carries a section in a shape this cannot read, and the only page that does is
  // one rendered before the renderer stamped its markers. That is the archive `./fleetJargon.ts`'s
  // break-glass exists for — an old page would otherwise be refused with no way through — so it sits
  // in the lifted lane. `briefing render` never lifts anything, so a CURRENT render still cannot carry one.
  const lengths = lede === undefined ? [] : [lede];
  if (!applyFraming) {
    return { defects: lengths, scopesChecked: input.scopes.length };
  }
  const parse = input.parseProblems.map((reason): SectionQualityDefect => ({
    path: [],
    reason,
    rule: "section-parse",
    section: "the page",
  }));
  return {
    defects: [
      ...lengths,
      ...parse,
      ...input.scopes.flatMap((scope) => {
        const defect = jargonDefect({ scope });
        return defect === undefined ? [] : [defect];
      }),
      ...input.asks.flatMap((ask) => askFramingDefects({ ask })),
      ...input.pointers.flatMap((pointer) => pointerDefects({ pointer })),
    ],
    scopesChecked: input.scopes.length,
  };
}
