/**
 * The "Nothing stale" section's LAYOUT: one summary and exactly four notes, every item's evidence folded.
 *
 * ## The leading number is "known stale", and a gap is never folded into it
 *
 * The summary opens `N known stale`, counting only the rows seen in none of the three states. Whenever any
 * surface went unseen it goes on, in the same line, `not an all-clear — could not see …` naming every one, so
 * a zero read over a missing document can never resemble a clean morning. Only zero stale over every surface
 * seen reads `Nothing stale`. A board count of unproven rows above zero rides the same line as `· N unproven`,
 * so a fold is never the only place a number the headline would contradict appears. A line that would
 * then pass the fold summary's cap counts the unseen surfaces instead of naming them — the names stand in the
 * stale note's own "Could not see" fold — so no count can make the section refuse.
 *
 * ## Four notes, always, in one order
 *
 * "Nobody has it" — the stale rows, which ARE the leading count's evidence, so it stands first and also
 * carries what the read could not see, each document's stated bounds, and the board's unproven count as ONE
 * line: a count, never a list, because the design this section answers to says those entries are "reported as
 * a count, never as hundreds of cards". Then the design's three parts: "Done for you", which lists only what
 * is in flight on a receipt and points at the autonomy ledger for what finished rather than re-counting it,
 * "Waiting on a named person", and "Needs your word". Each note is a QUOTED note (`../outbound/briefing/types.ts`'s
 * `BriefingQuotedNote`): its lines quote other verbs' own words, and the plain-wording rules are instructions
 * to a composer that a projection has nobody to give to. The headlines and fold summaries are composed here
 * and stay held to them.
 *
 * Nothing is sliced, ellipsised or capped by count. Over the byte budget in `./nothingStale.ts`, every lane's
 * list is WITHHELD WHOLE — its count stands, and one line says the list is not shown and why — so a partial
 * list can never resemble the whole one, and the one source field long enough to blow the budget cannot stop
 * `supervisor tick close` rendering the page.
 *
 * Pure.
 */
import type { BriefingBlock, BriefingContent, BriefingNote, BriefingSection } from "../outbound/briefing/types.js";
import { NOTHING_STALE_SECTION_ID } from "../outbound/briefing/types.js";
import { FOLD_SUMMARY_MAX } from "../outbound/briefing/vocabulary.js";
import type {
  NothingStaleGap,
  NothingStaleItem,
  NothingStaleLane,
  NothingStaleProjection,
} from "./nothingStaleTypes.js";

/** How the summary names each gap — short, because the whole summary is one 120-character line. */
const GAP_LABELS: Readonly<Record<NothingStaleGap, string>> = {
  board: "board",
  "board-unproven": "unproven count",
  "followed-threads": "threads",
  "linear-projects": "projects",
  "linear-tickets": "tickets",
  "pull-requests": "pull requests",
};

/** The four lanes, in the order the notes stand. */
const LANES: readonly NothingStaleLane[] = ["stale", "moving", "waiting", "needs-word"];

/** Where finished work is reported — the autonomy ledger's own heading, `../outbound/briefing/autonomyRender.ts`. */
const DONE_POINTER =
  "What the fleet finished without asking is the autonomy ledger's, under done for you, without asking. " +
  "This lists only what is in flight, each with the receipt that proves it.";

/** One plain text run. */
function text({ value }: { readonly value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/**
 * The section summary: the known-stale count, and every gap when there is one.
 *
 * @param projection the classification
 * @returns one line of at most 120 characters for every gap combination
 */
function nothingStaleSummary({ projection }: { readonly projection: NothingStaleProjection }): string {
  const stale = projection.items.filter((item) => item.lane === "stale").length;
  const gaps = [...projection.couldNotSee.keys()];
  const unproven =
    projection.unproven === undefined || projection.unproven === 0 ? "" : ` · ${String(projection.unproven)} unproven`;
  if (gaps.length === 0 && stale === 0) {
    return `Nothing stale · all five surfaces seen${unproven}`;
  }
  if (gaps.length === 0) {
    return `${String(stale)} known stale · all five surfaces seen${unproven}`;
  }
  const named = `${String(stale)} known stale; not an all-clear — could not see ${gaps.map((gap) => GAP_LABELS[gap]).join(", ")}${unproven}`;
  if (named.length <= FOLD_SUMMARY_MAX) {
    return named;
  }
  return `${String(stale)} known stale; not an all-clear — ${String(gaps.length)} surfaces unseen${unproven}`;
}

/** What the whole list weighed against the budget, when the lists are withheld. */
interface NothingStaleWithheld {
  readonly bytes: number;
  readonly cap: number;
}

/**
 * The lane's items as one list, one line saying the lane is empty at this read, or one line saying its list is
 * withheld whole.
 */
function laneBlock({
  items,
  withheld,
}: {
  readonly items: readonly NothingStaleItem[];
  readonly withheld: NothingStaleWithheld | undefined;
}): BriefingBlock {
  if (items.length === 0) {
    return { content: text({ value: "Nothing here at this read." }), kind: "para" };
  }
  if (withheld !== undefined) {
    const value =
      `${String(items.length)} row(s), withheld whole: every list in this section came to ` +
      `${String(withheld.bytes)} bytes against its ${String(withheld.cap)}-byte cap, and none is ever cut to fit.`;
    return { content: text({ value }), kind: "para" };
  }
  return { items: items.map((item) => item.line), kind: "list", ordered: false };
}

/** What the read could not see, one line per gap with every reason it carried. */
function gapBlocks({ projection }: { readonly projection: NothingStaleProjection }): readonly BriefingBlock[] {
  const gaps = [...projection.couldNotSee];
  if (gaps.length === 0) {
    return [];
  }
  return [
    {
      fold: {
        blocks: [
          {
            items: gaps.map(([gap, reasons]) => text({ value: `${GAP_LABELS[gap]}: ${reasons.join("; ")}` })),
            kind: "list",
            ordered: false,
          },
        ],
        summary: `Could not see ${gaps.map(([gap]) => GAP_LABELS[gap]).join(", ")} — why, for each`,
      },
      kind: "fold",
    },
  ];
}

/** Each document's standing bounds, one line per bound. */
function caveatBlocks({ projection }: { readonly projection: NothingStaleProjection }): readonly BriefingBlock[] {
  const lines = [...projection.caveats].flatMap(([label, bounds]) => bounds.map((bound) => `${label}: ${bound}`));
  if (lines.length === 0) {
    return [];
  }
  return [
    {
      fold: {
        blocks: [{ items: lines.map((value) => text({ value })), kind: "list", ordered: false }],
        summary: "What each read says it can never see, on any morning",
      },
      kind: "fold",
    },
  ];
}

/** The board's unproven count as its one line, or nothing when the count is itself a gap. */
function unprovenBlocks({ projection }: { readonly projection: NothingStaleProjection }): readonly BriefingBlock[] {
  if (projection.unproven === undefined) {
    return [];
  }
  return [
    { content: text({ value: `Board: ${String(projection.unproven)} rows unproven, count only.` }), kind: "para" },
  ];
}

/**
 * One lane's note: a headline counting it, and its items behind a fold.
 *
 * @param lane which of the four
 * @param items the lane's items, in classification order
 * @param projection the classification, for the stale note's coverage blocks
 * @param withheld the whole section's weight when its lists are withheld, else undefined
 * @returns the note
 */
function laneNote({
  lane,
  items,
  projection,
  withheld,
}: {
  readonly lane: NothingStaleLane;
  readonly items: readonly NothingStaleItem[];
  readonly projection: NothingStaleProjection;
  readonly withheld: NothingStaleWithheld | undefined;
}): BriefingNote {
  const count = String(items.length);
  if (lane === "stale") {
    return {
      detail: {
        blocks: [
          laneBlock({ items, withheld }),
          ...unprovenBlocks({ projection }),
          ...gapBlocks({ projection }),
          ...caveatBlocks({ projection }),
        ],
        summary: "Each one, with why nothing proves it is moving",
      },
      headline: text({ value: `Nobody has it — ${count}` }),
      lane: "quoted",
    };
  }
  if (lane === "moving") {
    return {
      detail: {
        blocks: [{ content: text({ value: DONE_POINTER }), kind: "para" }, laneBlock({ items, withheld })],
        summary: "Each one, with its receipt",
      },
      headline: text({ value: `Done for you — ${count} moving` }),
      lane: "quoted",
    };
  }
  if (lane === "waiting") {
    return {
      detail: { blocks: [laneBlock({ items, withheld })], summary: "Each one, with who it waits on and why" },
      headline: text({ value: `Waiting on a named person — ${count}` }),
      lane: "quoted",
    };
  }
  return {
    detail: { blocks: [laneBlock({ items, withheld })], summary: "Each one, with the word that answers it" },
    headline: text({ value: `Needs your word — ${count}` }),
    lane: "quoted",
  };
}

/**
 * The whole section, laid out.
 *
 * @param projection the classification
 * @param withheld the whole section's weight when it went over its budget, so every list is withheld whole
 * @returns the section under its fixed id, not yet checked against the schema or the byte budget
 */
export function renderNothingStaleSection({
  projection,
  withheld,
}: {
  readonly projection: NothingStaleProjection;
  readonly withheld?: NothingStaleWithheld | undefined;
}): BriefingSection {
  return {
    id: NOTHING_STALE_SECTION_ID,
    notes: LANES.map((lane) =>
      laneNote({ items: projection.items.filter((item) => item.lane === lane), lane, projection, withheld }),
    ),
    summary: nothingStaleSummary({ projection }),
  };
}

/**
 * Every item in the order the section lists them — the order an over-budget refusal names them in.
 *
 * @param projection the classification
 * @returns the items, lane by lane
 */
export function itemsInSectionOrder({
  projection,
}: {
  readonly projection: NothingStaleProjection;
}): readonly NothingStaleItem[] {
  return LANES.flatMap((lane) => projection.items.filter((item) => item.lane === lane));
}

/** The UTF-8 bytes of every run of text in one block, folds included. */
function blockBytes({ block }: { readonly block: BriefingBlock }): number {
  if (block.kind === "para") {
    return contentBytes({ content: block.content });
  }
  if (block.kind === "list") {
    return block.items.reduce((sum, content) => sum + contentBytes({ content }), 0);
  }
  if (block.kind === "fold") {
    const inner = block.fold.blocks.reduce((sum, child) => sum + blockBytes({ block: child }), 0);
    return Buffer.byteLength(block.fold.summary, "utf8") + inner;
  }
  return 0;
}

/**
 * The UTF-8 bytes of one run list's text.
 *
 * @param content the runs
 * @returns their text's byte length
 */
export function contentBytes({ content }: { readonly content: BriefingContent }): number {
  return content.reduce((sum, run) => sum + Buffer.byteLength(run.text, "utf8"), 0);
}

/**
 * The UTF-8 bytes of every run of text the section carries — the same thing `PAGE_TEXT_MAX_BYTES` bounds for
 * the whole page, counted for this one section.
 *
 * @param section the laid-out section
 * @returns its text's byte length
 */
export function sectionTextBytes({ section }: { readonly section: BriefingSection }): number {
  const notes = section.notes.reduce((sum, note) => {
    const detail = note.detail === undefined ? 0 : blockBytes({ block: { fold: note.detail, kind: "fold" } });
    return sum + contentBytes({ content: note.headline }) + detail;
  }, 0);
  return Buffer.byteLength(section.summary, "utf8") + notes;
}
