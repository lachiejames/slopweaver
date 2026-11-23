/**
 * The page-side half of a monitor backtest capture: where the panel is, where the box goes, what is cropped.
 *
 * ## Everything in {@link markBacktestPanel} runs inside the Datadog page
 *
 * Playwright serialises the function's SOURCE and evaluates it in the browser, so it closes over nothing in
 * this module and imports nothing. Its constants arrive as its one argument instead — which is why the
 * selectors below are exported and passed in rather than inlined twice, and why a change to one of them
 * cannot leave the Node-side waits and the page-side reader disagreeing.
 *
 * ## Anchored by visible text and by STRUCTURE, never by class name
 *
 * MEASURED against this install's live console (in the private repo this design is ported from, and
 * re-confirmed by this verb's own capture — reproduce with `slopweaver datadog shot monitor --id <id>`):
 * the chart container's own class is `.with_default_dimensions`, a build-hashed Druids name that is NOT a
 * contract, and Datadog A/B-tests the monitor form's layout with a one-column and a two-column variant both
 * live. So nothing here matches a class. The heading's own words are the anchor in both variants, and the
 * crop is then found by walking UP until the region satisfies a structural condition.
 *
 * ## What the crop must contain — three conditions, and each earns its place
 *
 * The crop is the smallest ancestor of the heading that contains ALL of:
 *
 * 1. **a real SVG chart** — more than three of `svg g.tick, svg line, svg text`. Datadog's backtest chart is
 *    genuine d3 SVG, not a canvas or a placeholder, so this distinguishes a drawn chart from a skeleton and
 *    is the reason this verb needs no pixel-statistics blank check (see `capture.ts`).
 * 2. **all four count labels** — the `N Alert / N Warn / N Recover / N No Data` row, which is the claim.
 * 3. **the time-range picker** — so the image PROVES ITS OWN WINDOW rather than asking a reader to take the
 *    caption's word for it.
 *
 * Conditions 1 and 2 come from the live-verified structural walk; condition 3 comes from the crop rule of the
 * skill this framing is contracted with. Requiring all three at once is the union of both, and it is what
 * makes the image the skill describes: the graph with its window, the transition sentence, and the counts
 * row — nothing else.
 *
 * The walk is DEPTH-BOUNDED. An unbounded walk that fails to satisfy its condition ends at `<html>` and
 * crops the entire page, which is the exact "a full-page Datadog screenshot is not this" failure the skill
 * names — so running out of depth is a refusal here rather than a bigger picture.
 */

/**
 * The console's own time-range control on the monitor edit form. Also what the crop is widened to contain.
 * @internal
 */
export const TIME_RANGE_PICKER = 'input[aria-label="Time range picker"]';

/** The window every monitor backtest proof is taken over. Not configurable, for the reason the crop is not. */
export const PAST_ONE_WEEK = "Past 1 Week";

/** The panel's own heading — the anchor, because it survives both live layout variants.
 * @internal
 */
export const PANEL_HEADING = "Monitor behavior with this threshold";

/** The attribute stamped on the crop region, whose viewport rectangle the capture is then cut to. */
export const PANEL_MARKER = "data-slopweaver-backtest-panel";

/** The counts the panel reports, in the order it prints them. The crop must contain every one.
 * @internal
 */
export const COUNT_LABELS = ["Alert", "Warn", "Recover", "No Data"] as const;

/**
 * How far up the tree the crop walk may go before it refuses.
 *
 * Twelve: the live-verified structural walk satisfied its own two conditions within eight, and this walk
 * carries a third (the time-range picker), which sits further out in the two-column layout variant. Bounded
 * at all for the reason the file header gives — an unbounded walk crops the whole page.
 * @internal
 */
export const MAX_CROP_DEPTH = 12;

/** The red box drawn around the Alert count, and nothing else on the page.
 * @internal
 */
export const ALERT_OUTLINE = { color: "#d63031", offsetPx: 4, radiusPx: 3, widthPx: 3 } as const;

/** What {@link markBacktestPanel} is told, so the selectors have exactly one definition.
 * @internal
 */
export interface MarkPanelOptions {
  readonly heading: string;
  readonly pickerSelector: string;
  /** What the picker must read before anything is marked — {@link PAST_ONE_WEEK}. */
  readonly window: string;
  readonly marker: string;
  readonly labels: readonly string[];
  readonly maxDepth: number;
  readonly outline: {
    readonly color: string;
    readonly offsetPx: number;
    readonly radiusPx: number;
    readonly widthPx: number;
  };
}

/** What one marking pass saw. Every field is stated, so "not found" is never inferred from an empty string.
 * @internal
 */
export interface MarkPanelResult {
  /** The panel's normalised text, or `null` when the heading and its claim were not found. */
  readonly panelText: string | null;
  /** Whether a region satisfying all three crop conditions was found and stamped. */
  readonly marked: boolean;
  /** Whether the `N Alert` count was found and boxed. */
  readonly alertBoxed: boolean;
  /** What the time-range picker was showing, or `null` when the picker is not on the page. */
  readonly pickerValue: string | null;
  /** Which crop conditions the deepest candidate still failed, so a refusal names what was missing. */
  readonly unmet: readonly string[];
}

/**
 * Find the backtest region, box the Alert count, stamp the crop, and report the panel's text.
 *
 * Runs INSIDE the page. It reads text and sets three CSS properties and one attribute; it types nothing,
 * clicks nothing and submits nothing — the monitor edit form is open in front of it, and this never touches
 * it. Deliberately does no PARSING: the counts become numbers in `parseBacktestPanel`, in Node, where a
 * Datadog rewording is a failing unit test instead of a wrong image.
 *
 * @param options the selectors, labels, depth bound and box style — passed in, because a serialised
 *   function closes over nothing
 * @returns what was found, marked and read on this pass
 */
// max-lines-exempt: Playwright serialises this function's SOURCE into the page, so every helper it uses must be declared INSIDE it — the length is that constraint, not undecomposed logic
export function markBacktestPanel(options: MarkPanelOptions): MarkPanelResult {
  const readText = ({ element }: { element: Element }): string =>
    (element instanceof HTMLElement ? element.innerText : element.textContent).replace(/\s+/g, " ").trim();

  const picker = document.querySelector(options.pickerSelector);
  const pickerValue = picker instanceof HTMLInputElement ? picker.value : null;

  // A pass runs again on every poll, and the panel can re-render between two of them: only THIS pass's region
  // may carry the marker, or the crop would follow whichever stale one comes first in the document.
  for (const stale of Array.from(document.querySelectorAll(`[${options.marker}]`))) {
    stale.removeAttribute(options.marker);
  }

  const heading = Array.from(document.querySelectorAll("div, span, h1, h2, h3")).find(
    (element) => element.children.length === 0 && readText({ element }) === options.heading,
  );
  if (heading === undefined) {
    return { alertBoxed: false, marked: false, panelText: null, pickerValue, unmet: ["the panel heading"] };
  }

  // The smallest ancestor carrying the WHOLE claim: the transition sentence and the counts row together.
  let panel: Element | null = heading;
  while (
    panel !== null &&
    !(/would have transitioned/.test(readText({ element: panel })) && /\d+ Alert\b/.test(readText({ element: panel })))
  ) {
    panel = panel.parentElement;
  }
  if (panel === null) {
    return { alertBoxed: false, marked: false, panelText: null, pickerValue, unmet: ["the transition sentence"] };
  }
  const panelText = readText({ element: panel });

  // The window itself, not just the control: a picker left on `Past 1 Month` renders a panel that reads back
  // perfectly well and proves the wrong seven days. Ported from the acme-admin capture, which holds off the same way.
  if (pickerValue !== options.window) {
    return {
      alertBoxed: false,
      marked: false,
      panelText,
      pickerValue,
      unmet: [`the picker reading "${options.window}"`],
    };
  }

  // Declared inline because Playwright serialises this function's SOURCE: a helper in module scope would
  // not exist in the page. Each takes what it needs rather than closing over anything, for the same reason.
  const missingConditions = ({
    region,
    pickerEl,
    opts,
    read,
  }: {
    region: Element;
    pickerEl: Element | null;
    opts: MarkPanelOptions;
    read: (args: { element: Element }) => string;
  }): readonly string[] => {
    const text = read({ element: region });
    const missing: string[] = [];
    if (region.querySelectorAll("svg g.tick, svg line, svg text").length <= 3) {
      missing.push("the SVG chart");
    }
    for (const label of opts.labels) {
      if (!text.includes(label)) {
        missing.push(`the ${label} count`);
      }
    }
    if (pickerEl === null || !region.contains(pickerEl)) {
      missing.push("the time-range picker");
    }
    return missing;
  };

  const findCropRegion = ({
    from,
    pickerEl,
    opts,
    read,
  }: {
    from: Element;
    pickerEl: Element | null;
    opts: MarkPanelOptions;
    read: (args: { element: Element }) => string;
  }): { region: Element | null; unmet: readonly string[] } => {
    let region: Element | null = from;
    let unmet: readonly string[] = [];
    for (let depth = 0; depth < opts.maxDepth && region !== null; depth += 1) {
      const missing = missingConditions({ opts, pickerEl, read, region });
      if (missing.length === 0) {
        return { region, unmet: [] };
      }
      unmet = missing;
      region = region.parentElement;
    }
    return { region: null, unmet };
  };

  const walk = findCropRegion({ from: panel, opts: options, pickerEl: picker, read: readText });
  if (walk.region !== null) {
    walk.region.setAttribute(options.marker, "true");
  }
  const marked = walk.region !== null;
  const unmet = walk.unmet;

  // Outermost match wins by document order; a leaf counts too, since Datadog may render the value as one element.
  const alertCount = Array.from(panel.querySelectorAll("*")).find(
    (element) => element instanceof HTMLElement && /^\d+ Alert$/.test(readText({ element })),
  );
  if (!(alertCount instanceof HTMLElement)) {
    return { alertBoxed: false, marked, panelText, pickerValue, unmet };
  }
  alertCount.style.outline = `${String(options.outline.widthPx)}px solid ${options.outline.color}`;
  alertCount.style.outlineOffset = `${String(options.outline.offsetPx)}px`;
  alertCount.style.borderRadius = `${String(options.outline.radiusPx)}px`;
  return { alertBoxed: true, marked, panelText, pickerValue, unmet };
}

/**
 * The options {@link markBacktestPanel} is evaluated with, built from this module's own constants.
 *
 * A function rather than a constant because it crosses into another runtime as JSON, and building it in one
 * place is what keeps the page-side reader and the Node-side waits anchored to the same selectors.
 *
 * @returns the marking options for this capture
 */
export function markPanelOptions(): MarkPanelOptions {
  return {
    heading: PANEL_HEADING,
    labels: [...COUNT_LABELS],
    marker: PANEL_MARKER,
    maxDepth: MAX_CROP_DEPTH,
    outline: ALERT_OUTLINE,
    pickerSelector: TIME_RANGE_PICKER,
    window: PAST_ONE_WEEK,
  };
}
