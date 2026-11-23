/**
 * What a RENDERED Notion page is wrong about — decided here, in pure code, over an observation the browser
 * lane captured.
 *
 * The split matters more than it looks. Everything about opening a browser, signing in and screenshotting
 * lives in `../../cli/commands/notion/verifyRun.ts`; everything about what counts as broken lives here, over
 * a plain data structure. That is what makes a render check testable at all — the alternative is a verb
 * whose judgement can only be exercised by launching Chromium at a live workspace.
 *
 * ## Why this exists rather than a markdown check
 *
 * The defect it was built for could not be seen from the markdown at all. A record table's link cells
 * rendered broken twice on the sensitive-sources proposal, and the second time was AFTER a markdown-only fix
 * the authoring session had no way to check: nothing in the door reads a block's children, so "the markdown
 * says `[label](url)`" was the only evidence available, and it was evidence about the wrong artifact.
 * Notion's converter — not the body — decides what a reader sees.
 *
 * Pure: an observation in, findings out. No I/O, no browser, no provider client.
 */

/** One rendered table cell, as the page reported it. */
export interface ObservedCell {
  /** 1-based index of the table on the page, in document order. */
  readonly table: number;
  /** 1-based row index within that table, header row included. */
  readonly row: number;
  /** 1-based column index within that row. */
  readonly column: number;
  /** The cell's visible text, whitespace collapsed. */
  readonly text: string;
  /** The visible text of each anchor the cell rendered, in order. */
  readonly anchorTexts: readonly string[];
  /**
   * The raw `href` of each anchor, in the same order.
   *
   * Read as well as the text because a CORRUPTED link looks perfectly normal from the outside. Measured:
   * the bare-reference linkifier spliced a second link into a URL's path, and the cell rendered
   * a tidy blue "the incident thread" pointing at an address that goes nowhere. The visible half was fine;
   * only the target was wrong, and no reader would have found out without clicking.
   */
  readonly anchorHrefs: readonly string[];
  /** The cell's rendered height in CSS pixels. */
  readonly heightPx: number;
  /** The cell's computed line height in CSS pixels, which is what turns a height into a line count. */
  readonly lineHeightPx: number;
}

/**
 * One rendered mermaid code block, and which half of Notion's code/preview toggle it is showing.
 *
 * `unknown` is a real outcome rather than a gap: Notion does not expose the toggle through the API, so the
 * only reading of it is the DOM, and a DOM that changes shape must report "could not tell" instead of
 * quietly reporting "fine".
 *
 * Acting on this finding has a trap worth knowing before you try, measured over six failed attempts:
 * the split icon is not a toggle. It opens a three-way menu whose items sit ~35px below it, so
 * a click that looks like it did nothing has in fact opened a menu that the next action then dismissed. The
 * refusal message carries the instruction, because whoever reads the finding is about to hit this.
 */
export interface ObservedMermaid {
  /** 1-based index of the mermaid block on the page, in document order. */
  readonly index: number;
  /**
   * 0-based index of this block among ALL outermost code blocks on the page.
   *
   * Carried so the screenshot pass photographs the same element this judgement is about. Without it the two
   * passes count different populations — every code block versus only the mermaid ones — and a report would
   * point at the wrong picture the moment a page held one ordinary code fence.
   */
  readonly codeBlockIndex: number;
  readonly mode: "preview" | "split" | "code" | "unknown";
}

/**
 * One rendered text block that is not in a table — a paragraph, a heading, a list item, a callout.
 *
 * Carries no geometry, because the line budget is a rule about TABLES: a paragraph is supposed to be long.
 * What it carries is the link evidence, which is the half that is wrong wherever it appears.
 */
export interface ObservedProse {
  /** 1-based index of the block on the page, in document order among non-table text blocks. */
  readonly index: number;
  /** The block's visible text, whitespace collapsed. */
  readonly text: string;
  readonly anchorTexts: readonly string[];
  readonly anchorHrefs: readonly string[];
}

/** Everything one page render reported, ready to be judged. */
export interface RenderObservation {
  readonly cells: readonly ObservedCell[];
  /** Every text block outside a table. Optional so an older capture still parses as an observation. */
  readonly prose?: readonly ObservedProse[];
  readonly mermaid: readonly ObservedMermaid[];
}

/** One way a rendered page is wrong, in the operator's vocabulary. */
export type RenderFinding =
  | {
      readonly kind: "literal-markdown-link";
      readonly cell: ObservedCell;
      readonly message: string;
    }
  | {
      readonly kind: "truncated-auto-link";
      readonly cell: ObservedCell;
      readonly message: string;
    }
  | {
      readonly kind: "corrupt-link-target";
      readonly cell: ObservedCell;
      readonly message: string;
    }
  | {
      readonly kind: "linkless-url-cell";
      readonly cell: ObservedCell;
      readonly message: string;
    }
  | {
      readonly kind: "cell-over-budget";
      readonly cell: ObservedCell;
      readonly lines: number;
      readonly message: string;
    }
  | {
      readonly kind: "literal-markdown-link-in-prose";
      readonly block: ObservedProse;
      readonly message: string;
    }
  | {
      readonly kind: "corrupt-link-target-in-prose";
      readonly block: ObservedProse;
      readonly message: string;
    }
  | {
      readonly kind: "mermaid-not-preview";
      readonly block: ObservedMermaid;
      readonly message: string;
    };

/**
 * How many rendered lines one table cell may occupy before it is called out.
 *
 * Six, and the number is a judgement rather than a measurement: a record table exists to be scanned, and a
 * cell that wraps past about six lines has stopped being a cell and become a paragraph that happens to sit
 * in a grid. It is a flag rather than a refusal for exactly that reason — `--cell-lines` moves it, and a
 * page with one deliberately long cell is a page whose author says so.
 *
 * What a number does that an opinion cannot, measured: the owner had judged by eye that cells
 * were ten-plus lines tall when they could be two, and the authoring session had held that two was
 * unreachable without deleting evidence. Given thirteen findings instead of an argument, that session
 * trimmed to 5, then 2, then 0 across three passes with no claim and no citation dropped. The budget turned
 * a disagreement about taste into a target.
 */
export const DEFAULT_CELL_LINE_BUDGET = 6;

/** A markdown link that survived into the rendered text, which is the whole broken shape. */
const LITERAL_MARKDOWN_LINK = /\[[^\]]*\]\((?:https?:\/\/|\/)[^)\s]+\)/;

/** The ellipsis Notion appends when it auto-links a bare URL and clips the label. */
const ELLIPSIS = "…";

/** A bare URL sitting in a cell's text. */
const BARE_URL = /https?:\/\/\S+/;

/**
 * An `href` that cannot be a real address: markdown punctuation or whitespace survived into it.
 *
 * Square brackets and parentheses are the tell. A legitimate URL may percent-encode them (`%5B`), so their
 * LITERAL presence in an href means text that was never meant to be an address ended up in one.
 */
const CORRUPT_HREF = /[[\]]|\]\(|\s/;

/** Where a cell is, said the way an operator reads a table. */
function cellAt({ cell }: { cell: ObservedCell }): string {
  return `table ${String(cell.table)}, row ${String(cell.row)}, column ${String(cell.column)}`;
}

/** A cell's text, clipped so one finding cannot flood the report. */
function excerpt({ text }: { text: string }): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * How many rendered lines a cell occupies.
 *
 * A zero or absent line height means the browser could not compute one, and a division by it would report
 * an infinite cell. Reported as one line instead, because a cell whose metrics cannot be read is not
 * evidence that it is too tall.
 *
 * @param cell the observed cell
 * @returns the cell's height in lines, rounded to the nearest whole line, never below one
 */
export function cellLines({ cell }: { cell: ObservedCell }): number {
  if (cell.lineHeightPx <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(cell.heightPx / cell.lineHeightPx));
}

/** The link findings for one cell — the literal markdown, the truncated auto-link, the un-linked URL. */
function linkFindingsFor({ cell }: { cell: ObservedCell }): readonly RenderFinding[] {
  const found: RenderFinding[] = [];
  const literal = LITERAL_MARKDOWN_LINK.test(cell.text);
  if (literal) {
    found.push({
      cell,
      kind: "literal-markdown-link",
      message:
        `${cellAt({ cell })} shows its markdown source as text: "${excerpt({ text: cell.text })}". ` +
        "Notion's converter only parses an inline link in a table cell when the cell IS exactly one link, " +
        "so a cell mixing prose and a link renders the brackets literally. Make the cell exactly one link " +
        "and move the prose to its own column.",
    });
  }
  const truncated = cell.anchorTexts.filter((text) => text.endsWith(ELLIPSIS) && BARE_URL.test(text));
  if (truncated.length > 0) {
    found.push({
      cell,
      kind: "truncated-auto-link",
      message:
        `${cellAt({ cell })} renders a link whose label is a clipped URL ("${truncated[0]!}"). ` +
        "That is Notion auto-linking a BARE url it found in the text, not the labelled link that was " +
        "written — the label was lost. Write the cell as exactly one markdown link.",
    });
  }
  const corrupt = cell.anchorHrefs.filter((href) => CORRUPT_HREF.test(href));
  if (corrupt.length > 0) {
    found.push({
      cell,
      kind: "corrupt-link-target",
      message:
        `${cellAt({ cell })} renders a normal-looking link whose TARGET is malformed: "${corrupt[0]!}". ` +
        "Nothing about this cell looks wrong on the page — the label is fine and the link is blue — and it " +
        "goes nowhere. It is the signature of a reference linkified twice; see `outbound/linkify/bareRefs.ts`.",
    });
  }
  // Suppressed when the cell is already reported as showing its markdown source: a cell full of literal
  // `[label](url)` has an unlinked URL BY CONSTRUCTION, so saying so a second time describes the same defect
  // twice and doubles the report for no new information.
  if (!literal && cell.anchorTexts.length === 0 && BARE_URL.test(cell.text)) {
    found.push({
      cell,
      kind: "linkless-url-cell",
      message:
        `${cellAt({ cell })} contains a URL that did not render as a link at all: ` +
        `"${excerpt({ text: cell.text })}". A reader cannot click it.`,
    });
  }
  return found;
}

/**
 * The height findings, ONE per over-tall row rather than one per cell.
 *
 * Measured on the live proposal page: a per-cell rule reported 36 findings over 12 rows, three
 * identical lines each. That is not noise to tune away — it is the rule being wrong. A table row lays out as
 * one band, so every cell in it has the SAME rendered height whatever it contains, and "this cell is nine
 * lines tall" said of an empty cell beside a long one is simply false. The row is the thing that is too
 * tall, and the cell worth naming is the one whose text made it so.
 */
function budgetFindings({
  cells,
  cellLineBudget,
}: {
  cells: readonly ObservedCell[];
  cellLineBudget: number;
}): readonly RenderFinding[] {
  const rows = new Map<string, ObservedCell[]>();
  for (const cell of cells) {
    const key = `${String(cell.table)}:${String(cell.row)}`;
    // A row's first cell opens it; every later cell of the same row joins it, in the order the page reported.
    const row = rows.get(key);
    if (row === undefined) {
      rows.set(key, [cell]);
      continue;
    }
    row.push(cell);
  }
  const found: RenderFinding[] = [];
  for (const row of rows.values()) {
    const tallest = row.reduce((worst, cell) => (cellLines({ cell }) > cellLines({ cell: worst }) ? cell : worst));
    const lines = cellLines({ cell: tallest });
    if (lines <= cellLineBudget) {
      continue;
    }
    // The cell whose own text is longest is the one that decided the row's height, and naming it is what
    // makes the finding actionable — "row 13 is too tall" leaves a reader counting columns.
    const culprit = row.reduce((worst, cell) => (cell.text.length > worst.text.length ? cell : worst));
    found.push({
      cell: culprit,
      kind: "cell-over-budget",
      lines,
      message:
        `table ${String(culprit.table)}, row ${String(culprit.row)} renders ${String(lines)} lines tall, past ` +
        `the ${String(cellLineBudget)}-line budget; its longest cell is column ${String(culprit.column)} ` +
        `("${excerpt({ text: culprit.text })}"). A table is for scanning; move the detail below the table or ` +
        "into a linked page.",
    });
  }
  return found;
}

/**
 * The link findings for one block of prose.
 *
 * The same two failures the cells are checked for, and deliberately NOT the height one: a paragraph is meant
 * to be long. Added after a page this verb had already called clean was found carrying a raw
 * `[GGGG-690](url)` in an ordinary paragraph — the check had been looking where the previous defect was.
 */
function proseFindingsFor({ block }: { block: ObservedProse }): readonly RenderFinding[] {
  const found: RenderFinding[] = [];
  if (LITERAL_MARKDOWN_LINK.test(block.text)) {
    found.push({
      block,
      kind: "literal-markdown-link-in-prose",
      message:
        `text block ${String(block.index)} shows its markdown source as text: "${excerpt({ text: block.text })}". ` +
        "A nested or unparsed link renders literally in a paragraph exactly as it does in a table cell.",
    });
  }
  const corrupt = block.anchorHrefs.filter((href) => CORRUPT_HREF.test(href));
  if (corrupt.length > 0) {
    found.push({
      block,
      kind: "corrupt-link-target-in-prose",
      message:
        `text block ${String(block.index)} renders a normal-looking link whose TARGET is malformed: ` +
        `"${corrupt[0]!}". Nothing about it looks wrong on the page, and it goes nowhere.`,
    });
  }
  return found;
}

/** The finding for one mermaid block, when its toggle is not showing the diagram. */
function mermaidFindingFor({ block }: { block: ObservedMermaid }): readonly RenderFinding[] {
  if (block.mode === "preview") {
    return [];
  }
  const showing = {
    code: "showing its source instead of the diagram",
    split: "split, showing source beside the diagram",
    unknown: "in a state this check could not read",
  }[block.mode];
  return [
    {
      block,
      kind: "mermaid-not-preview",
      message:
        `mermaid block ${String(block.index)} is ${showing}. A reader meets the code, not the picture — ` +
        "set the block to Preview in Notion, or say in the doc that the source is deliberate. The affordance " +
        "is a trap: the split icon is NOT a toggle, it opens a three-way menu (code / preview / split) whose " +
        "items sit about 35px BELOW it, so hover the icon, click it, then click the MIDDLE item.",
    },
  ];
}

/**
 * Judge one captured render.
 *
 * Every finding is a report rather than a repair: this verb never touches the page it is looking at, and a
 * check that quietly fixed what it found would leave the operator with no idea what the page had done.
 *
 * @param observation what the browser lane captured off the rendered page
 * @param cellLineBudget how many rendered lines a table cell may occupy before it is called out
 * @returns every finding — cell links, then one height finding per over-tall row, then prose, then mermaid
 */
export function renderFindings({
  observation,
  cellLineBudget = DEFAULT_CELL_LINE_BUDGET,
}: {
  observation: RenderObservation;
  cellLineBudget?: number;
}): readonly RenderFinding[] {
  const cellFindings = [
    ...observation.cells.flatMap((cell) => linkFindingsFor({ cell })),
    ...budgetFindings({ cellLineBudget, cells: observation.cells }),
  ];
  // `prose` is optional because a capture taken before the prose pass existed carries none: no blocks, no findings.
  const { prose } = observation;
  const proseFindings = prose === undefined ? [] : prose.flatMap((block) => proseFindingsFor({ block }));
  const mermaidFindings = observation.mermaid.flatMap((block) => mermaidFindingFor({ block }));
  return [...cellFindings, ...proseFindings, ...mermaidFindings];
}
