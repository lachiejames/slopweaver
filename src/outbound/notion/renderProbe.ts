/**
 * What a Notion page's own DOM is asked, and how the answers are read.
 *
 * Every selector Notion's rendered application exposes lives HERE, in one file, so the day Notion renames a
 * class there is exactly one place to look. `./renderFindings.ts` judges what comes back and knows none of
 * this; the shell in `../../cli/commands/notion/verifyRun.ts` drives the browser and knows none of it either.
 *
 * Every selector below was read off a live signed-in page, not guessed from documentation.
 * Reproduce the reading with `slopweaver notion verify <page> --json`, which prints the counts each of these
 * produced.
 *
 * ## The sign-in wall is a positive check, not the absence of content
 *
 * MEASURED, and it cost three wrong attempts. The wall renders a blurred SKELETON of the page
 * behind its modal, and those skeleton nodes carry `data-block-id` exactly as real blocks do. So
 * "`[data-block-id]` exists" reported SIGNED IN against a login screen three times running — the same class
 * of blind spot as GitHub's empty `user-login` meta tag in `../github/webSession.ts`, discovered the same
 * way. The wall also mounts its modal a second or two AFTER the skeleton, so a check that merely waits for
 * `.notion-login` to be absent races it and wins.
 *
 * What that leaves is two POSITIVE markers, raced against each other: `.notion-page-content` means the
 * document rendered, `.notion-login` (or the `notion-front-page` class the wall stamps on `<html>`) means
 * Notion is asking who you are. Neither is inferred from the other's absence, so a third state — a page that
 * is neither, because the address is wrong or the account cannot see it — reports as itself.
 *
 * ## A code block nests inside itself, and a table does not
 *
 * Measured on the same page. `.notion-code-block` appears on the OUTER block and again on the inner source
 * pane, so a naive `querySelectorAll` counted four blocks where a reader sees three; blocks with a
 * `.notion-code-block` ancestor are therefore dropped. Tables need no such care — Notion draws them as real
 * `<table>`/`<tr>`/`<td>` elements, so the browser's own `rows`/`cells` walk is exact, and the class
 * `.notion-table-block` is the one that repeats.
 */

/**
 * The rendered document's own container; its presence is what "this page rendered" means.
 *
 * @internal
 */
export const PAGE_CONTENT_SELECTOR = ".notion-page-content";

/**
 * Notion's sign-in wall.
 *
 * @internal
 */
export const LOGIN_SELECTOR = ".notion-login";

/**
 * The class the sign-in wall stamps on `<html>`, which survives the modal's own mount delay.
 *
 * @internal
 */
export const FRONT_PAGE_CLASS = "notion-front-page";

/**
 * One code block, mermaid or otherwise. Nests inside itself — see the module note.
 *
 * @internal
 */
export const CODE_BLOCK_SELECTOR = ".notion-code-block";

/**
 * The same, with the inner source pane's own copy of the class excluded.
 *
 * A CSS-only spelling of the filter the observation script applies in script, so the screenshot pass and the
 * observation pass agree on which element is "block number three" without either re-deriving it.
 * @internal
 */
export const OUTERMOST_CODE_BLOCK_SELECTOR = ".notion-code-block:not(.notion-code-block .notion-code-block)";

/**
 * The rendered diagram: mermaid's own SVG, and the wrapper Notion puts a fullscreen affordance on.
 *
 * @internal
 */
export const DIAGRAM_SELECTOR = "svg[id^='mermaid'], [data-diagram-container='true']";

/**
 * The editable source pane. Present in Code and Split, absent in Preview.
 *
 * @internal
 */
export const CODE_SOURCE_SELECTOR = "[aria-roledescription='code block']";

/**
 * The element inside a `<td>` that actually carries the cell's text, and its real line height.
 *
 * @internal
 */
export const CELL_TEXT_SELECTOR = ".notion-table-cell-text";

/**
 * Every text block a reader reads OUTSIDE a table.
 *
 * A late addition, and the reason is the whole point of this verb: the owner found the same raw
 * `[GGGG-690](url)` in an ordinary paragraph after the table check had reported the page clean. A broken link
 * is broken wherever it sits, and a check that only looked at tables was checking where the last defect
 * happened rather than where defects are.
 *
 * Keyed on `data-block-id` and narrowed to blocks with no nested block inside them, so a toggle's container
 * is not reported alongside the paragraph it holds — the same self-nesting problem the code blocks have.
 * @internal
 */
export const TEXT_BLOCK_SELECTOR = "[data-block-id]";

/**
 * The first word of a mermaid diagram's source, for every diagram type mermaid ships.
 *
 * This is how a mermaid block in pure CODE mode is recognised at all. With no diagram drawn, nothing in the
 * static DOM says the block is mermaid — Notion's language label renders only on hover, and the word
 * "Mermaid" appears nowhere on the page otherwise (measured: zero occurrences in a settled page's HTML that
 * contained three mermaid blocks). The source itself is the only evidence, and it is good evidence: no other
 * language opens a file with `flowchart TB`.
 * @internal
 */
export const MERMAID_OPENERS: readonly string[] = [
  "flowchart",
  "graph",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "erdiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitgraph",
  "quadrantchart",
  "requirementdiagram",
  "c4context",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "packet-beta",
  "architecture-beta",
];

/**
 * Which of the two raced markers the page is showing, or neither.
 * @internal
 */
export type RenderState = "rendered" | "sign-in-wall" | "neither";

/**
 * Read which state the page is in, from inside the browser.
 *
 * Written as a string rather than a function reference because it is evaluated in the PAGE's realm, not
 * this process's: it closes over nothing here, and the selectors above are inlined into it so there is
 * still only one definition of each.
 *
 * @returns the script to evaluate in the page
 * @internal
 */
export function renderStateScript(): string {
  return `(() => {
    if (document.querySelector(${JSON.stringify(PAGE_CONTENT_SELECTOR)}) !== null) { return "rendered"; }
    if (document.querySelector(${JSON.stringify(LOGIN_SELECTOR)}) !== null) { return "sign-in-wall"; }
    if (document.documentElement.className.includes(${JSON.stringify(FRONT_PAGE_CLASS)})) { return "sign-in-wall"; }
    return "neither";
  })()`;
}

/**
 * Read every table cell and mermaid block off the rendered page, as one plain object.
 *
 * The whole observation is taken in ONE evaluation rather than by walking the page with locators, because a
 * Notion document re-renders as it settles: two hundred separate round trips would each see a slightly
 * different page and the report would describe a document that never existed at one instant.
 *
 * A cell's height comes from `getBoundingClientRect` on the `<td>` and its line height from the computed
 * style of the text element INSIDE it — measured, the `<td>` itself computes `line-height: normal`, which
 * parses to `NaN`, while the inner `.notion-table-cell-text` carries the real `20px`. A line height that
 * still cannot be read is passed through as zero and handled in `./renderFindings.ts` rather than papered
 * over here: this function reports, it does not judge.
 *
 * @returns the script to evaluate in the page
 */
export function observationScript(): string {
  return `(() => {
    const collapse = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
    const cells = [];
    [...document.querySelectorAll("table")].forEach((table, tableIndex) => {
      [...table.rows].forEach((row, rowIndex) => {
        [...row.cells].forEach((cell, columnIndex) => {
          const inner = cell.querySelector(${JSON.stringify(CELL_TEXT_SELECTOR)});
          const measured = window.getComputedStyle(inner ?? cell);
          const lineHeight = Number.parseFloat(measured.lineHeight);
          cells.push({
            table: tableIndex + 1,
            row: rowIndex + 1,
            column: columnIndex + 1,
            text: collapse(cell.textContent),
            anchorTexts: [...cell.querySelectorAll("a")].map((a) => collapse(a.textContent)),
            anchorHrefs: [...cell.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
            heightPx: cell.getBoundingClientRect().height,
            lineHeightPx: Number.isFinite(lineHeight) ? lineHeight : 0,
          });
        });
      });
    });
    const prose = [];
    [...document.querySelectorAll(${JSON.stringify(TEXT_BLOCK_SELECTOR)})]
      .filter((block) => block.querySelector(${JSON.stringify(TEXT_BLOCK_SELECTOR)}) === null
        && block.closest("table") === null
        && block.closest(${JSON.stringify(CODE_BLOCK_SELECTOR)}) === null)
      .forEach((block, index) => {
        const text = collapse(block.textContent);
        if (text.length === 0) { return; }
        prose.push({
          index: index + 1,
          text,
          anchorTexts: [...block.querySelectorAll("a")].map((a) => collapse(a.textContent)),
          anchorHrefs: [...block.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
        });
      });
    const openers = ${JSON.stringify(MERMAID_OPENERS)};
    const outermost = [...document.querySelectorAll(${JSON.stringify(CODE_BLOCK_SELECTOR)})].filter(
      (block) => block.parentElement === null
        || block.parentElement.closest(${JSON.stringify(CODE_BLOCK_SELECTOR)}) === null,
    );
    const mermaid = [];
    outermost.forEach((block, blockIndex) => {
      const diagram = block.querySelector(${JSON.stringify(DIAGRAM_SELECTOR)}) !== null;
      const sourceEl = block.querySelector(${JSON.stringify(CODE_SOURCE_SELECTOR)});
      const source = collapse(sourceEl === null ? "" : sourceEl.textContent);
      const firstWord = source.split(/[\\s{(]/)[0].toLowerCase();
      const looksMermaid = openers.includes(firstWord);
      if (!diagram && !looksMermaid) { return; }
      let mode = "unknown";
      if (diagram && source.length > 0) { mode = "split"; }
      else if (diagram) { mode = "preview"; }
      else if (source.length > 0) { mode = "code"; }
      mermaid.push({ index: mermaid.length + 1, codeBlockIndex: blockIndex, mode });
    });
    return { cells, mermaid, prose };
  })()`;
}
