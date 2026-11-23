/**
 * The tables a pull-request body DRAWS, read off a real rendering rather than its source.
 *
 * The body is rendered by micromark with its GFM extensions, raw HTML allowed and GFM's tag filter applied, which
 * is the CommonMark + GFM pipeline GitHub runs, and the HTML is built into a tree by parse5, the WHATWG parser a
 * browser follows. A source reader chased that pair one construct at a time: eleven review rounds, each finding a new
 * way to hide a lead row (a fence or code span inside an open table, a closing backtick inside a comment, an
 * implicit row with no `<tr>`, a paragraph ended by a heading), and a structured fuzz of 30,000 bodies still found
 * ten more. What the renderer draws is the question the lead rule asks, so the rule reads that.
 *
 * What remains between this and GitHub is the two implementations (micromark against cmark-gfm) and GitHub's HTML
 * sanitiser, which removes markup but keeps the text a row shows. One known place they disagree: a cell holding `\\|`
 * splits there in micromark and not on GitHub (cmark-gfm), so a row can read here with its cells shifted and
 * its last dropped where GitHub draws it whole. Nor is math drawn: GitHub typesets `$…$` in the
 * browser, so a label built of it a letter at a time (`$\text{P}\text{r}…$`) reads here as its source (r27). That
 * residue is unjudged.
 */

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { parse } from "parse5";

import {
  annotates,
  childrenOf,
  conceals,
  type Element,
  isElement,
  type Node,
  RAISED,
  READ_THROUGH,
  SEPARATED,
  STRUCK,
  shownChildren,
} from "./drawnNodes.js";

import { collapsed, type ProblemSigns, SPELLED_BREAK, type SpelledRun, spelledRun, spelling } from "./spelling.js";

/**
 * One drawn table. `rows` are its rows in the order a reader sees them, each row its cells' visible text as
 * {@link walk} reads it, so a line break shows as a space and struck text sits between `~`. `signs` holds, cell for
 * cell, whether the letters that cell could be read as spelling (`./spelling.ts`) could carry or name Problem, in
 * what it shows or with what any tag in it hides, for a caller that must never MISS a word, only ever over-read one. `turned`
 * says, row for row, whether the row may be drawn right to left (see {@link turns}), so its label need not be first.
 */
export interface RenderedTable {
  readonly rows: readonly (readonly string[])[];
  readonly signs: readonly (readonly ProblemSigns[])[];
  readonly turned: readonly boolean[];
}

/**
 * How many characters of a node's text are kept. The rule asks only whether a cell says anything and what its label
 * reads, and a deeply nested body would otherwise concatenate its whole text once per enclosing cell.
 */
const TEXT_KEPT = 256;

/**
 * A run of characters a reader sees as space: JavaScript's `\s` without U+FEFF, which it counts as white space but
 * draws with no width at all, so `Blast\u{FEFF}radius` reads "Blastradius", never the label (fallback review r16).
 */
const DRAWN_SPACE = /[^\S\u{FEFF}]+/gu;

/**
 * What an image contributes to a node's text: U+FFFC, the object replacement character. It is neither a letter nor a
 * digit, so an image alone says nothing, but a row holding only an image is still a row a reader sees.
 */
const DRAWN_OBJECT = "\u{FFFC}";

/**
 * A node's text when nothing under it is read — a text node's value, an image's {@link DRAWN_OBJECT}, nothing for a
 * comment — or undefined for a node whose text is its children's.
 */
function leafText({ node }: { node: Node }): string | undefined {
  if (node.nodeName === "#text" && "value" in node) {
    return node.value.replace(DRAWN_SPACE, " ").slice(0, TEXT_KEPT);
  }
  if (isElement(node) && node.tagName === "img") {
    return DRAWN_OBJECT;
  }
  if (!("childNodes" in node)) {
    return "";
  }
  return undefined;
}

/** Every letter under a node (`./spelling.ts`), and only those a reader is shown, each read once as a {@link SpelledRun}. */
interface Spelled {
  readonly all: SpelledRun;
  readonly shown: SpelledRun;
}

/**
 * What an element could SAY without drawing it as text, each attribute read whole: any element's `title`, a tooltip
 * (`<abbr title="Problem">Prob.</abbr>`), and an image's `alt` and `src`, since a badge draws its label from its URL
 * (`<img src="https://img.shields.io/badge/-Problem-555">`, fallback reviews r30, r31). It is spelled with what is
 * hidden, never as what is shown. An image whose pixels alone say Problem is out of reach of any reading of the body,
 * and so, for an image carrying its own `alt`, is its `src`'s scheme and host ({@link drawnPartOf}).
 */
function saidBy({ node }: { node: Node }): readonly SpelledRun[] {
  if (!isElement(node)) {
    return [];
  }
  const image = node.tagName === "img";
  const alt = node.attrs.find((attr) => attr.name === "alt");
  const labelled = image && alt !== undefined && alt.value.trim() !== "";
  return node.attrs
    .filter((attr) => attr.name === "title" || (image && (attr.name === "alt" || attr.name === "src")))
    .map((attr) => (attr.name === "src" && labelled ? drawnPartOf({ src: attr.value }) : attr.value))
    .map((value) => spelledRun({ spelled: spelling({ text: value }), within: [] }));
}

/**
 * The part of a labelled image's `src` a badge can draw a label from: an `http(s)` URL's path, query and fragment,
 * never its scheme or host. A badge service draws what the path or query asks for (`/badge/-Problem-555`); a host
 * names the server, and a server that draws a word nobody asked for is the pixels-alone case above. Read whole, a
 * host over-read: Renovate's Mend badges live on `developer.mend.io`, whose `loper.m` spells Problem with the dot as
 * its `b`, so every Renovate bump owed Risk and Blast radius above its own update table.
 * A word split across the host and the path (`https://pro/blem`) goes unread with it: its host half is drawn
 * nowhere, so no reader sees the word whole.
 *
 * Only for an image with a non-empty `alt` ({@link saidBy}): one with none may show its URL where it fails to load,
 * host included. Cut off the RAW text, never a parsed URL's path: `URL` percent-encodes what
 * it keeps, so a Cyrillic `о` in a badge's path would stop reading as a letter. The host ends at the first `/`, `?`,
 * `#` or `\`, which a browser reads as a slash. An authority carrying userinfo (`https://Problem:x@host/`) is not a
 * bare host — a server can draw the user it was asked as — so it is read whole. So is any authority that
 * is not a bare host by a positive grammar — letters, digits, marks, `.`, `-`, `_`, `~`, never a bracketed IP, then an
 * port of at most five digits — since a space, a lettered port (`https://x.test:Problem/`) or one no server can listen
 * on would otherwise hide a word past the host, and so is any other source: relative,
 * protocol-relative, `data:`, another scheme. The scheme's cases are spelled out rather than flagged `i`: Unicode
 * case folding would let `httpſ` pass for `https`.
 *
 * What this closes and what it does not: it stops reading the scheme, host and port, which no renderer draws; a word
 * matched there, whole or in part, goes unread. It never read pixels, so a server answering any URL with an image
 * of the word was never caught and still is not; only reading the fetched image would.
 */
function drawnPartOf({ src }: { src: string }): string {
  return src.replace(/^\s*[Hh][Tt][Tt][Pp][Ss]?:\/\/[\p{L}\p{N}\p{M}._~-]+(?::\d{0,5})?(?=[/?#\\]|$)/u, "");
}

/** A node's {@link Spelled} runs from its children's, which are already computed. */
function spelledFrom({ node, spelled }: { node: Node; spelled: ReadonlyMap<Node, Spelled> }): Spelled {
  if (node.nodeName === "#text" && "value" in node) {
    const run = spelledRun({ spelled: spelling({ text: node.value }), within: [] });
    return { all: run, shown: run };
  }
  const said = saidBy({ node });
  const children = childrenOf({ node });
  const shown = new Set(shownChildren({ node }));
  const broken = ({ child, part }: { child: Node; part: string }): string =>
    isElement(child) && SEPARATED.has(child.tagName) && !RAISED.has(child.tagName)
      ? `${SPELLED_BREAK}${part}${SPELLED_BREAK}`
      : part;
  const joined = ({
    parts,
    also,
  }: {
    parts: readonly { child: Node; run: SpelledRun }[];
    also: readonly SpelledRun[];
  }): SpelledRun =>
    spelledRun({
      spelled: collapsed({ spelled: parts.map(({ child, run }) => broken({ child, part: run.edges })).join("") }),
      within: [...parts.map(({ run }) => run), ...also],
    });
  return {
    all: joined({ also: said, parts: children.map((child) => ({ child, run: spelled.get(child)!.all })) }),
    shown: joined({
      also: [],
      parts: children
        .filter((child) => shown.has(child) && !conceals({ node: child }) && !annotates({ node: child }))
        .map((child) => ({ child, run: spelled.get(child)!.shown })),
    }),
  };
}

/**
 * What one child adds to its parent's text: its own, read through by {@link READ_THROUGH}, set apart by
 * {@link SEPARATED}, marked by {@link STRUCK}, or {@link DRAWN_OBJECT} for one that {@link conceals} and for any
 * other tag, a template's inert content included.
 */
function childText({ child, text }: { child: Node; text: ReadonlyMap<Node, string> }): string {
  const own = text.get(child)!;
  if (!isElement(child)) {
    return own;
  }
  if (conceals({ node: child })) {
    return DRAWN_OBJECT;
  }
  if (READ_THROUGH.has(child.tagName)) {
    return own;
  }
  if (STRUCK.has(child.tagName)) {
    return `~${own}~`;
  }
  return SEPARATED.has(child.tagName) ? ` ${own} ` : DRAWN_OBJECT;
}

/** What {@link walk} reads off a tree. */
interface Walked {
  readonly tables: readonly Element[];
  readonly text: ReadonlyMap<Node, string>;
  readonly hidden: ReadonlySet<Node>;
  readonly turned: ReadonlySet<Node>;
  readonly spelled: ReadonlyMap<Node, Spelled>;
}

/** One node on {@link walk}'s stack: whether its children are joined yet, and whether a reader is kept from it. */
interface WalkFrame {
  readonly node: Node;
  readonly entered: boolean;
  readonly hidden: boolean;
  readonly turned: boolean;
}

/**
 * Whether an element may draw what it holds right to left: a `dir` other than `ltr` (`auto` follows its text), a
 * `<bdo>` or a `<bdi>`. A table under one draws its first cell rightmost, so the label a left-to-right reader
 * takes is its LAST (fallback review r21); an inner `dir="ltr"` is not trusted to turn it back.
 */
function turns({ node }: { node: Node }): boolean {
  return (
    isElement(node) &&
    (node.tagName === "bdo" ||
      node.tagName === "bdi" ||
      node.attrs.some((attr) => attr.name === "dir" && attr.value.toLowerCase() !== "ltr"))
  );
}

/**
 * The frames for a node's children, last first so the first is walked first: a child is hidden when its parent is,
 * when it {@link conceals}, or when a closed `<details>` does not show it.
 */
function childFrames({ frame }: { frame: WalkFrame }): readonly WalkFrame[] {
  const shown = new Set(shownChildren({ node: frame.node }));
  return childrenOf({ node: frame.node })
    .toReversed()
    .map((child) => ({
      entered: false,
      hidden: frame.hidden || !shown.has(child) || conceals({ node: child }),
      node: child,
      turned: frame.turned || turns({ node: child }),
    }));
}

/**
 * Every table under `root` in document order, with the visible text of every node, computed ONCE in one iterative
 * pass (a deeply nested body overflowed the call stack a recursive walk used): text descendants joined and capped at
 * {@link TEXT_KEPT}, a template's inert content and every comment left out. `hidden` holds every node a reader is
 * kept from, by its own attribute or an ancestor's; `turned` every node {@link turns} reaches.
 */
function walk({ root }: { root: Node }): Walked {
  const tables: Element[] = [];
  const text = new Map<Node, string>();
  const hidden = new Set<Node>();
  const turned = new Set<Node>();
  const spelled = new Map<Node, Spelled>();
  const stack: WalkFrame[] = [{ entered: false, hidden: false, node: root, turned: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { node } = frame;
    if (frame.hidden) {
      hidden.add(node);
    }
    if (frame.turned) {
      turned.add(node);
    }
    if (frame.entered) {
      const joined = shownChildren({ node })
        .map((child) => childText({ child, text }))
        .join("");
      text.set(node, joined.replace(DRAWN_SPACE, " ").slice(0, TEXT_KEPT));
      spelled.set(node, spelledFrom({ node, spelled }));
      continue;
    }
    const leaf = leafText({ node });
    if (leaf !== undefined) {
      text.set(node, leaf);
      spelled.set(node, spelledFrom({ node, spelled }));
      continue;
    }
    if (isElement(node) && node.tagName === "table") {
      tables.push(node);
    }
    stack.push({ ...frame, entered: true }, ...childFrames({ frame }));
  }
  return { hidden, spelled, tables, text, turned };
}

/** The rows of one table section, or of a table's own direct rows. */
function rowsIn({ node }: { node: Node }): readonly Element[] {
  return childrenOf({ node }).filter((child): child is Element => isElement(child) && child.tagName === "tr");
}

/**
 * A table's rows in the order a reader sees them: its first `<thead>` first and its first `<tfoot>` last, wherever
 * the source put them, as a browser lays a table out. A nested table's rows belong to that table, never to this one.
 */
function orderedRows({ table }: { table: Element }): readonly Element[] {
  const sections = childrenOf({ node: table }).filter((child): child is Element => isElement(child));
  const head = sections.find((section) => section.tagName === "thead");
  const foot = sections.find((section) => section.tagName === "tfoot");
  const body = sections.filter((section) => section !== head && section !== foot);
  return [
    ...(head === undefined ? [] : rowsIn({ node: head })),
    ...body.flatMap((section) => (section.tagName === "tr" ? [section] : rowsIn({ node: section }))),
    ...(foot === undefined ? [] : rowsIn({ node: foot })),
  ];
}

/** A row's cells, a `<th>` read like a `<td>`. */
function cellsOf({ row }: { row: Element }): readonly Element[] {
  return childrenOf({ node: row }).filter(
    (child): child is Element => isElement(child) && (child.tagName === "td" || child.tagName === "th"),
  );
}

/**
 * Drawn space at either end of a text. `trim()` would take U+FEFF too, so a label cut at {@link TEXT_KEPT} inside a
 * run of them, `Risk` + U+FEFF × 300 + `y?`, read as exactly `Risk` (fallback review r20).
 */
const DRAWN_EDGES = /^[^\S\u{FEFF}]+|[^\S\u{FEFF}]+$/gu;

/**
 * A row's cells' visible text, whitespace collapsed. A hidden cell — hidden itself, or by its row, section, table or
 * any ancestor — reads as {@link DRAWN_OBJECT}, so a hidden lead row is still a row, and one whose label no reader
 * sees is refused (fallback review r18).
 */
function cellTexts({ row, text, hidden }: Walked & { row: Element }): readonly string[] {
  return cellsOf({ row }).map((cell) =>
    hidden.has(cell) ? DRAWN_OBJECT : text.get(cell)!.replace(DRAWN_SPACE, " ").replace(DRAWN_EDGES, ""),
  );
}

/**
 * How many `*` and `_` characters a body may carry and still have its emphasis parsed. micromark resolves emphasis
 * in time quadratic in its delimiters: `*_` repeated took 225 ms at 8,192 marks, 1.3 s at 16,384 and 29 s at GitHub's
 * 65,536-character cap (repro: time `micromark` with `gfm()` on `"*_".repeat(n / 2)`). A description carries a few
 * hundred. Past the cap emphasis is left unparsed, its marks stay in a label's text and a `**Risk**` label reads as
 * written, so the cost of the cap is a refusal, never an acceptance.
 */
const EMPHASIS_MARKS_PARSED = 8192;

/** `markdown` rendered and built into a tree, as this file's header describes, with every node's visible text. */
function renderedTree({ markdown }: { markdown: string }): Walked & { root: Node } {
  const root = renderedDocument({ markdown });
  return { ...walk({ root }), root };
}

/**
 * `markdown` rendered by micromark with GFM and built into a tree by parse5, as this file's header describes — the
 * one pipeline every reader of what a body DRAWS goes through.
 *
 * @param markdown a pull-request description, as markdown with raw HTML
 * @returns the document node of the rendered HTML
 */
export function renderedDocument({ markdown }: { markdown: string }): Node {
  const marks = markdown.length - markdown.replace(/[*_]/g, "").length;
  // Emphasis is parsed so a label reads as a reader sees it: `**Risk**` draws bold "Risk", while an escaped `\*Risk\*`,
  // a spaced `* Risk *` or marks inside a raw HTML block draw their stars (fallback review r13). Strikethrough is never
  // parsed (`~~a` repeated to the cap took 3 s): a struck label keeps its tildes and is refused, as it should be.
  const disabled = marks > EMPHASIS_MARKS_PARSED ? ["attention", "strikethrough"] : ["strikethrough"];
  const html = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm(), { disable: { null: disabled } }],
    htmlExtensions: [gfmHtml()],
  });
  // Scripting off, as GitHub's sanitiser reads a `<noscript>`: its content stays markup rather than raw text.
  return parse(html, { scriptingEnabled: false });
}

/**
 * Every table `body` draws, nested ones included, each as its rows' cell texts.
 *
 * @param body the pull-request description, as markdown with raw HTML
 * @returns the drawn tables, in document order
 */
export function renderedTables({ body }: { body: string }): readonly RenderedTable[] {
  const walked = renderedTree({ markdown: body });
  return walked.tables.map((table) => {
    const rows = orderedRows({ table });
    return {
      rows: rows.map((row) => cellTexts({ ...walked, row })),
      signs: rows.map((row) =>
        cellsOf({ row }).map((cell) => {
          const { all, shown } = walked.spelled.get(cell)!;
          return { carries: all.carries || shown.carries, names: all.names || shown.names };
        }),
      ),
      turned: rows.map((row) => walked.turned.has(row)),
    };
  });
}

/**
 * Whether a cell's markdown SHOWS a reader anything once drawn: a letter or a digit. Whitespace, a character
 * reference such as `&nbsp;`, a dash, bare markup, an image alone, a comment or a default-ignorable letter (U+3164
 * HANGUL FILLER, which Unicode classes a letter, draws blank) draw nothing a reader can read.
 *
 * @param fragment one cell's markdown or rendered HTML
 * @returns true when the drawn text carries a letter or a digit
 */
export function saysAnything({ fragment }: { fragment: string }): boolean {
  const { text, root } = renderedTree({ markdown: fragment });
  return /[\p{L}\p{N}]/u.test(text.get(root)!.replace(/\p{Default_Ignorable_Code_Point}/gu, ""));
}
