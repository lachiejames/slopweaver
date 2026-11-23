/**
 * The page-side half of an Explorer capture: what the console actually rendered, and what to crop to.
 *
 * ## Why this reads the view back instead of trusting the address it opened
 *
 * MEASURED (reproduce: open a Metrics Explorer view, set a scope and a group-by, and read the
 * address bar): the Metrics Explorer keeps its query, group-by and visualisation in an OPAQUE URL FRAGMENT
 * — a compressed state blob — which Datadog rewrites into a `session_id` plus a state hash on load. The
 * legacy `exp_metric`/`exp_agg` params do seed a view, and no param carrying the scope or the group-by was
 * found. So an address built from `--metric`/`--scope`/`--group` is a REQUEST, not a guarantee.
 *
 * A screenshot is evidence a reader cannot re-run, and the failure that matters is an image of the wrong
 * query captioned as the right one. So the build-a-URL mode reads the console's own query control back and
 * REFUSES when what rendered does not carry what was asked for. That is the same discipline `datadog probe`
 * applies to a citation link — never hand back a view you have not watched resolve.
 *
 * Everything in {@link readExplorerView} runs inside the page and closes over nothing in this module.
 */

/** Where the Metrics Explorer prints the query it is actually showing. Matched by role, never by class.
 * @internal
 */
export const QUERY_CONTROL_SELECTORS: readonly string[] = [
  '[data-testid="query-editor"]',
  '[aria-label="Query"]',
  ".druids_query-editor",
  "[class*='query-editor']",
];

/**
 * The attribute stamped on the region an Explorer capture clips to.
 * @internal
 */
export const VIEW_MARKER = "data-slopweaver-explorer-view";

/**
 * How far up the tree the Explorer crop walk may go before it gives up and reports `marked: false`.
 *
 * Running out of depth here IS a refusal, exactly as in the monitor lane. It briefly was not: a viewport
 * shot was offered as a "stated fallback", and that fallback shipped two bad images before it was removed
 * (a pure-white PNG, then the nav rail with an empty content pane, both reported as success). A capture
 * that cannot anchor the query and a drawn chart has not established what it claims.
 * @internal
 */
export const MAX_VIEW_DEPTH = 10;

/** What {@link readExplorerView} is told.
 * @internal
 */
export interface ReadExplorerOptions {
  readonly querySelectors: readonly string[];
  readonly marker: string;
  readonly maxDepth: number;
}

/** What one read of an Explorer view saw.
 * @internal
 */
export interface ReadExplorerResult {
  /** The query the console's own control is showing, or `null` when no query control was found. */
  readonly renderedQuery: string | null;
  /** Whether a region carrying both the query and a drawn chart was found and stamped. */
  readonly marked: boolean;
  /** The page's whole visible text, so a caller can confirm a group-by that the query control abbreviates. */
  readonly viewText: string;
}

/**
 * Read what the Explorer is showing, and stamp the region worth cropping to.
 *
 * @param options the query selectors, the marker attribute and the crop walk's depth bound
 * @returns the rendered query, whether a crop region was marked, and the view's visible text
 */
export function readExplorerView(options: ReadExplorerOptions): ReadExplorerResult {
  const readText = ({ element }: { element: Element }): string =>
    (element instanceof HTMLElement ? element.innerText : element.textContent).replace(/\s+/g, " ").trim();

  let control: Element | null = null;
  for (const selector of options.querySelectors) {
    const found = document.querySelector(selector);
    if (found !== null) {
      control = found;
      break;
    }
  }
  const renderedQuery = control === null ? null : readText({ element: control });
  const viewText = readText({ element: document.body });

  if (control === null) {
    return { marked: false, renderedQuery, viewText };
  }
  // Widen from the query control until the region also holds a drawn chart — that pair is the claim: this
  // query, this result. Bounded, and a miss returns `marked: false` with nothing marked — this function never
  // falls back to the viewport or the whole page.
  let region: Element | null = control;
  for (let depth = 0; depth < options.maxDepth && region !== null; depth += 1) {
    if (region.querySelectorAll("svg g.tick, svg line, svg text, table").length > 3) {
      region.setAttribute(options.marker, "true");
      return { marked: true, renderedQuery, viewText };
    }
    region = region.parentElement;
  }
  return { marked: false, renderedQuery, viewText };
}

/**
 * The options {@link readExplorerView} is evaluated with, built from this module's own constants.
 *
 * @returns the read options for this capture
 */
export function readExplorerOptions(): ReadExplorerOptions {
  return { marker: VIEW_MARKER, maxDepth: MAX_VIEW_DEPTH, querySelectors: QUERY_CONTROL_SELECTORS };
}
