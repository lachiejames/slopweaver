/**
 * The WRITER's projection: one typed form read as the disclosure levels `../../briefing/sectionQuality.ts`
 * judges.
 *
 * `../../briefing/sectionQualityHtml.ts` is the reader's projection of the same thing off the rendered page,
 * and the two are held to producing the same scopes by
 * `src/__tests__/unit/briefing/sectionQualityParity.test.ts`. That parity is the whole point of splitting
 * this out of `./schema.ts`: the form must not admit what the page's own check refuses, and `briefing
 * render` runs that check over its own output.
 *
 * ## What is deliberately NOT projected
 *
 * - **Every react-now card's above-the-fold prose.** It has its own rule with its own scope
 *   (`../../briefing/fleetJargon.ts` through `./schema.ts`'s card refinement), and projecting it here would
 *   report one card's word twice. A card's composed `detail` is not projected either: this gate covers
 *   every section BEYOND the cards, and the card gate is left exactly as the owner approved
 *   it — inside a fold, the fold rule governs, the same way it does for every other fold on this page.
 * - **The owner's own list, entirely.** Every field of a row is a projection of what the session-start verb read —
 *   the owner's own recorded question, a pull request's real title — so a fleet word there is the owner's or a
 *   colleague's, not the fleet's. The same split `./vocabulary.ts`'s `quotedFoldSchema` already makes about the
 *   bare-key-link rule, widened to the whole row: exempting only the
 *   headline would have left the quoted fold and the title refusing what nobody here wrote.
 * - **`awaiting`.** It renders NOTHING (`skills/supervisor/reference/one-index.md` § "RETIRED, and still
 *   accepted"), and a rule over invisible content costs a composer without reaching a reader.
 * - **A subject's own title, a page's `label`, a supersession's `by`.** Somebody else named those.
 * - **A paste block's payload.** It is bytes the owner moves into a box, not prose — `./vocabulary.ts` says so, and
 *   the same reasoning that keeps `proseLine` off it keeps the vocabulary rule off it.
 */
import { publishClaimIssues } from "../../briefing/publishClaim.js";
import {
  ALIGNMENT_SECTION,
  CELL_SEPARATOR,
  checkSectionQuality,
  LEDE_PATH,
  LEDE_SECTION,
  RANKED_SECTION,
  type SectionQualityAsk,
  type SectionQualityInput,
  type SectionQualityRule,
  type SectionQualityScope,
} from "../../briefing/sectionQuality.js";
import { plainText } from "../../briefing/text.js";
import { escapeText, renderContent } from "./render.js";
import type {
  BriefingBlock,
  BriefingContent,
  BriefingFold,
  BriefingForm,
  BriefingNote,
  BriefingSection,
} from "./types.js";
import { INTAKE_SUMMARY, RECENT_SECTION_NAME } from "./types.js";

/**
 * One cell's text, as the RENDERED page reads it back — by rendering it and reading it, never by imitation.
 *
 * `textOfContent` concatenates runs with nothing between them, because that is what the caps count. The page
 * does not agree with that, and it does not agree with a plain space either: `./render.ts` emits a `text`
 * run raw and wraps every other kind in a tag, and `../../briefing/text.ts`'s `stripTags` puts a space where
 * each tag was. So `["rea", "per"]` reads `reaper` while `["rea", strong "per"]` reads `rea per`.
 *
 * Review found BOTH halves of that, one after the other — first a concatenating projection against
 * a page that spaced tagged runs, then a spacing projection against a page that concatenated plain ones. The
 * fix is to stop guessing the rule: render the runs with the renderer and read them with the reader's own
 * plain-text pass, which is exact by construction and cannot drift when either side changes.
 *
 * @param content the cell's runs
 * @returns the text a reader meets on the page
 */
function cellText({ content }: { content: BriefingContent }): string {
  return plainText({ html: renderContent({ content }) });
}

/**
 * One PLAIN-STRING cell — a fold summary, a paste label, an image's alt or caption — read the same way.
 *
 * Escaped and then read back rather than passed through, for {@link cellText}'s reason one level down: the
 * page escapes the string and the reader's plain-text pass collapses its whitespace, so a summary written
 * with two spaces in it is one string in the form and another on the page. Review built exactly
 * that — `"Rows on  the board"` parsed clean and rendered refused, because the fleet collocation only
 * matches the single-spaced form.
 *
 * @param value the composer's own string
 * @returns the text a reader meets on the page
 */
function plainCell({ value }: { value: string }): string {
  return plainText({ html: escapeText({ text: value }) });
}

/**
 * A drafted message's own body, as the paragraphs the page renders it into.
 *
 * `./render.ts`'s `renderDraftBody` splits on a blank line and turns a single newline into a `<br>`, so the
 * page carries one `<p>` per paragraph and the reader reads one cell each. Projecting the whole draft as one
 * string would let two of its paragraphs form a phrase the page cannot.
 *
 * @param text the draft's own text
 * @returns one cell per paragraph
 */
function draftCells({ text }: { text: string }): readonly string[] {
  return text.split(/\n{2,}/).map((paragraph) => plainCell({ value: paragraph }));
}

/** One level being built: the cells written at it, and the text of every level enclosing it. */
interface LevelUnderConstruction {
  readonly section: string;
  readonly path: readonly (string | number)[];
  readonly ancestors: readonly string[];
  readonly cells: readonly string[];
}

/** A level, plus every level nested inside it, flattened in reading order. */
function levelScopes({
  level,
  folds,
}: {
  level: LevelUnderConstruction;
  folds: readonly {
    readonly fold: BriefingFold;
    readonly path: readonly (string | number)[];
    /** Whether the fold's CONTENTS are the owner's own words, so this level reads its summary and goes no deeper. */
    readonly quoted?: boolean | undefined;
  }[];
}): readonly SectionQualityScope[] {
  // Every fold's SUMMARY, after this level's own cells. The order matters only because the reader builds a
  // level the same way — it reads the markup's cells and then the summaries of the folds inside it — and the
  // two projections are asserted equal string for string. A quoted fold's summary is here with the rest:
  // the summary is composed by the projection and only the BLOCKS behind it are the owner's.
  const cells = [...level.cells, ...folds.map((entry) => plainCell({ value: entry.fold.summary }))];
  const text = cells.filter((cell) => cell.length > 0).join(CELL_SEPARATOR);
  const own: SectionQualityScope = {
    ancestors: level.ancestors,
    path: level.path,
    section: level.section,
    text,
  };
  const inner = folds.flatMap((entry) =>
    entry.quoted === true
      ? []
      : foldScopes({
          ancestors: [...level.ancestors, text],
          fold: entry.fold,
          path: entry.path,
          section: level.section,
        }),
  );
  return [own, ...inner];
}

/** Every text cell one block contributes at its OWN level, and every fold it opens under that level. */
function blockCells({ block }: { block: BriefingBlock }): readonly string[] {
  if (block.kind === "para") {
    return [cellText({ content: block.content })];
  }
  if (block.kind === "list") {
    return block.items.map((item) => cellText({ content: item }));
  }
  if (block.kind === "image") {
    return block.caption === undefined
      ? [plainCell({ value: block.alt })]
      : [plainCell({ value: block.alt }), plainCell({ value: block.caption })];
  }
  if (block.kind === "draft") {
    return draftCells({ text: block.text });
  }
  if (block.kind === "paste") {
    // The LABEL only. The payload is bytes the owner pastes somewhere else — see the file overview.
    return [plainCell({ value: block.label })];
  }
  // A NESTED fold's own summary is added by {@link levelScopes}, with every other fold's, after this level's
  // cells. Review found it missing entirely — the HTML reader collected every nested summary and
  // this did not, so a form whose nested fold summary carried a fleet word parsed clean and then rendered to
  // a page its own check refused.
  return [];
}

/** One fold as its own disclosure level, with the levels nested inside it. */
function foldScopes({
  fold,
  section,
  path,
  ancestors,
}: {
  fold: BriefingFold;
  section: string;
  path: readonly (string | number)[];
  ancestors: readonly string[];
}): readonly SectionQualityScope[] {
  const cells = fold.blocks.flatMap((block) => blockCells({ block }));
  const nested = fold.blocks.flatMap((block, index) =>
    block.kind === "fold" ? [{ fold: block.fold, path: [...path, "blocks", index] }] : [],
  );
  return levelScopes({ folds: nested, level: { ancestors, cells, path, section } });
}

/** Every note of one collapsed section, as cells at the section's own level plus one level per detail. */
function noteScopes({
  notes,
  section,
  path,
  ancestors,
  cells,
}: {
  notes: readonly BriefingNote[];
  section: string;
  path: readonly (string | number)[];
  ancestors: readonly string[];
  cells: readonly string[];
}): readonly SectionQualityScope[] {
  return levelScopes({
    // A QUOTED note's fold contributes its summary and nothing below it, exactly as
    // `../../briefing/sectionQualityHtml.ts` skips the owner's list by role: its blocks are their own recorded words,
    // so a fleet term inside one is the owner using their own vocabulary and the only way to satisfy a refusal
    // would be to rewrite them. The headline beside it is composed here and stays in this level's cells.
    folds: notes.flatMap((note, index) =>
      note.detail === undefined
        ? []
        : [{ fold: note.detail, path: [...path, index, "detail"], quoted: note.lane === "quoted" }],
    ),
    level: {
      ancestors,
      cells: [...cells, ...notes.map((note) => cellText({ content: note.headline }))],
      path,
      section,
    },
  });
}

/** One collapsed `earlierToday` or `history` section, named the way the page names it. */
function sectionScopes({
  section,
  path,
}: {
  section: BriefingSection;
  path: readonly (string | number)[];
}): readonly SectionQualityScope[] {
  return noteScopes({
    ancestors: [],
    cells: [plainCell({ value: section.summary })],
    notes: section.notes,
    path,
    section: `"${plainCell({ value: section.summary })}"`,
  });
}

/**
 * The alignment line's levels: the generated headline, the renderer's intake fold, and the composer's own.
 *
 * The INTAKE fold is built here rather than read off a field, because `./render.ts` emits it around a field
 * that carries no fold of its own — and both halves have to agree about which level its sentence sits at.
 *
 * @internal — one section of {@link sectionQualityOfForm}.
 * @param form the whole form
 * @returns the alignment line's own level and the two folds under it
 */
function alignmentScopes({ form }: { form: BriefingForm }): readonly SectionQualityScope[] {
  const intake: BriefingFold = {
    blocks: [{ content: form.alignment.intake, kind: "para" }],
    summary: INTAKE_SUMMARY,
  };
  return levelScopes({
    // The intake fold first, because that is the order `./render.ts` emits them in.
    folds: [
      { fold: intake, path: ["alignment", "intake"] },
      ...(form.alignment.detail === undefined ? [] : [{ fold: form.alignment.detail, path: ["alignment", "detail"] }]),
    ],
    level: {
      ancestors: [],
      cells: [cellText({ content: form.alignment.headline })],
      path: ["alignment", "headline"],
      section: ALIGNMENT_SECTION,
    },
  });
}

/**
 * Project one whole form into the scopes, asks and pointers the section rules read.
 *
 * @param form the validated form
 * @returns every disclosure level outside a card's own above-the-fold prose, every ranked ask and the lede
 */
export function sectionQualityOfForm({ form }: { form: BriefingForm }): SectionQualityInput {
  const lede = cellText({ content: form.header.lede });
  const ranked = form.reactNow.openArtifacts;
  const scopes: readonly SectionQualityScope[] = [
    { ancestors: [], path: LEDE_PATH, section: LEDE_SECTION, text: lede },
    ...(ranked.length === 0
      ? []
      : [
          {
            ancestors: [],
            path: ["reactNow", "openArtifacts"],
            section: RANKED_SECTION,
            text: ranked.map((artifact) => cellText({ content: artifact.ask })).join(CELL_SEPARATOR),
          },
        ]),
    ...alignmentScopes({ form }),
    ...(form.recent.length === 0
      ? []
      : noteScopes({ ancestors: [], cells: [], notes: form.recent, path: ["recent"], section: RECENT_SECTION_NAME })),
    // The freshness section is PROJECTED rather than composed, and that exempts it from nothing: this list
    // already reads the projected open-pages index. Every section reads the way
    // a card does. A section this function never named would be the one place on the page that rule
    // silently did not reach, and it was exactly that when the scheduled-resyncs change first met this file.
    // It sits HERE because the page renders it between the recent list and earlier today, and the Nothing stale
    // section, projected the same way, renders just before it.
    ...(form.nothingStale === undefined
      ? []
      : sectionScopes({ path: ["nothingStale", "notes"], section: form.nothingStale })),
    ...(form.freshness === undefined ? [] : sectionScopes({ path: ["freshness", "notes"], section: form.freshness })),
    ...(form.earlierToday === undefined
      ? []
      : sectionScopes({ path: ["earlierToday", "notes"], section: form.earlierToday })),
    ...form.history.flatMap((section, index) => sectionScopes({ path: ["history", index, "notes"], section })),
  ];
  const asks: readonly SectionQualityAsk[] = ranked.map((artifact, index) => ({
    path: ["reactNow", "openArtifacts", index, "ask"],
    section: RANKED_SECTION,
    text: cellText({ content: artifact.ask }),
  }));
  // NO POINTERS. The pointer lane judges what the RENDERER printed, and `./schema.ts`'s `instant` already
  // refuses a `landedIso` no clock can parse — so a form has nothing left for it to find, and emitting one
  // here would refuse every form for carrying no age line the form was never meant to carry.
  return { asks, lede, parseProblems: [], pointers: [], scopes: scopes.filter((scope) => scope.text.length > 0) };
}

/**
 * The section defects ONE new recent note would carry, judged as {@link sectionQualityOfForm} judges the newest
 * `recent` note — the same projection, the same rule, the same `recent.0.…` paths.
 *
 * `supervisor tick fill` asks this before the chair runs `tick close`. MEASURED on two chair sessions
 * (`slopweaver transcripts draw --session <id>`): twelve closes refused `recent.0.detail` for a fleet
 * word in a fold, each re-run after two to four more calls. Alone, the note has fewer cells a gloss may come from
 * than it has beside the older notes, so this can report a word close would accept, never the reverse — and fill
 * only reports.
 *
 * @param note the note the sweep would add
 * @returns one issue per rule broken, with the rule and the path the close's refusal would name
 */
export function recentNoteSectionIssues({ note }: { note: BriefingNote }): readonly {
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly rule: SectionQualityRule;
}[] {
  const scopes = noteScopes({
    ancestors: [],
    cells: [],
    notes: [note],
    path: ["recent"],
    section: RECENT_SECTION_NAME,
  });
  const result = checkSectionQuality({
    applyFraming: true,
    input: {
      asks: [],
      lede: undefined,
      parseProblems: [],
      pointers: [],
      scopes: scopes.filter((scope) => scope.text.length > 0),
    },
  });
  return result.defects.map((defect) => ({ message: defect.reason, path: defect.path, rule: defect.rule }));
}

/**
 * Every section defect one form carries, as the message and the path a Zod issue needs.
 *
 * The same shape `../../briefing/cardSubject.ts`'s `subjectSelfLinkIssues` hands `./schema.ts`, and for the
 * same reason: the form's own file states the RULE it is applying and this states what applying it found,
 * so the schema keeps one line per rule rather than growing a projection inside a refinement.
 *
 * @param form the whole form
 * @returns one issue per rule broken, in the order a composer should fix them
 */
export function sectionQualityIssues({
  form,
}: {
  form: BriefingForm;
}): readonly { readonly message: string; readonly path: readonly (string | number)[] }[] {
  const result = checkSectionQuality({ applyFraming: true, input: sectionQualityOfForm({ form }) });
  // A PUBLISH CLAIM NAMES WHERE THE OWNER GOES. The criterion, and why only the
  // composed headlines are read, are in `../../briefing/publishClaim.ts`.
  return [
    ...result.defects.map((defect) => ({ message: defect.reason, path: defect.path })),
    ...publishClaimIssues({ lede: form.header.lede, recent: form.recent }),
  ];
}
