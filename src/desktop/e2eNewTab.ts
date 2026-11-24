/**
 * The `new-tab` step of `slopweaver desktop e2e`, its pure half: what the + after the last tab must offer and what
 * choosing a page off it must leave, judged from what the effectful half (`../cli/commands/desktop/e2eNewTab.ts`)
 * reads off the real app.
 *
 * The tabs are modelled on Chrome's, and the + is the one piece of that model a
 * unit test cannot reach: it pops a NATIVE menu, so a parse test proves the strip sends the command and never that the
 * menu opens, lists the right pages, or opens the one chosen. The step presses the real + on the test instance, reads
 * the menu main built, chooses {@link NEW_TAB_CHOICE} off it, and judges the tab that opened.
 *
 * Pure.
 */

/** The page the step chooses off the menu: a sidebar page that is neither the Queue nor the walk's own last stop. */
export const NEW_TAB_CHOICE = "/pull-requests";

/**
 * The pages the menu must offer, in order, by the glyph and name each item shows: every sidebar page but the Queue,
 * which has exactly one tab, the pinned one. `src/` reaches neither `desktop/` nor `site/`, so this restates
 * `desktop/src/tabPages.ts`; `site/__tests__/unit/tabPagesMirror.test.ts` holds the two equal, and
 * `e2eNewTab.test.ts` holds the paths to `CONSOLE_ROUTES`.
 */
export const NEW_TAB_PAGES: readonly { readonly glyph: string; readonly name: string; readonly path: string }[] = [
  { glyph: "◇", name: "Alignment", path: "/alignment" },
  { glyph: "⇄", name: "Pull requests", path: NEW_TAB_CHOICE },
  { glyph: "▰", name: "Workstreams", path: "/workstreams" },
  { glyph: "↻", name: "Automations", path: "/automations" },
  { glyph: "◎", name: "Fleet", path: "/fleet" },
  { glyph: "▦", name: "Store", path: "/store" },
  { glyph: "¶", name: "Docs", path: "/docs" },
];

/** The name the chosen page's item shows. */
export const NEW_TAB_CHOICE_NAME = "Pull requests";

/** What separates a menu item's glyph from its page's name (`desktop/src/newTabShell.ts`). */
const LABEL_GAP = "  ";

/**
 * The glyph a menu item wears ahead of its page's name, which the tab it opens must wear too.
 *
 * @param label the item's label, `<glyph>  <name>`
 * @returns the glyph, or `undefined` for a label of any other shape
 */
export function menuGlyph({ label }: { label: string }): string | undefined {
  const gap = label.indexOf(LABEL_GAP);
  if (gap <= 0 || label.slice(gap + LABEL_GAP.length).trim() === "") {
    return undefined;
  }
  return label.slice(0, gap);
}

/**
 * The page's name a menu item shows after its glyph.
 *
 * @param label the item's label, `<glyph>  <name>`
 * @returns the name, or `undefined` for a label of any other shape
 */
export function menuName({ label }: { label: string }): string | undefined {
  if (menuGlyph({ label }) === undefined) {
    return undefined;
  }
  return label.slice(label.indexOf(LABEL_GAP) + LABEL_GAP.length);
}

/**
 * Whether the menu the + popped offers exactly the pages it should, in order, each with its glyph.
 *
 * @param labels the menu's items, in order, or `undefined` when no menu popped
 * @returns every way it did not, in the owner's terms; empty when it held
 */
export function newTabMenuBreaks({ labels }: { labels: readonly string[] | undefined }): readonly string[] {
  if (labels === undefined) {
    return ["pressing + popped no menu"];
  }
  const breaks: string[] = [];
  const shown = labels.map((label) => menuName({ label }));
  const wanted = NEW_TAB_PAGES.map((page) => page.name);
  if (shown.length !== wanted.length || shown.some((name, at) => name !== wanted[at])) {
    breaks.push(`the menu offered ${shown.map(String).join(", ")}, not ${wanted.join(", ")}`);
  }
  if (labels.some((label) => label.endsWith(`${LABEL_GAP}Queue`))) {
    breaks.push("the menu offered the Queue, which has only its pinned tab");
  }
  const bare = labels.filter((label) => menuGlyph({ label }) === undefined);
  if (bare.length > 0) {
    breaks.push(`menu item(s) with no glyph ahead of the name: ${bare.join(", ")}`);
  }
  // A chosen tab is judged against its item's glyph, so that glyph must be its sidebar page's.
  const misdrawn = labels.flatMap((label) => {
    const page = NEW_TAB_PAGES.find((candidate) => candidate.name === menuName({ label }));
    const glyph = menuGlyph({ label });
    if (page === undefined || glyph === undefined || glyph === page.glyph) {
      return [];
    }
    return [`${label} (not ${page.glyph})`];
  });
  if (misdrawn.length > 0) {
    breaks.push(`menu item(s) wearing another page's glyph: ${misdrawn.join(", ")}`);
  }
  return breaks;
}

/** One tab in the strip as the step reads it. */
export interface NewTabStripTab {
  /** The strip's own id for it (`data-tab`), stable for the tab's life; `undefined` when it draws none. */
  readonly id: string | undefined;
  /** It is the one selected. */
  readonly selected: boolean;
  /** Its icon, or `undefined` when it draws none. */
  readonly icon: string | undefined;
}

/** What the app showed at one moment of the step. */
export interface NewTabSnapshot {
  /** The tabs in the strip, in strip order. */
  readonly tabs: readonly NewTabStripTab[];
  /** How many pages opened since just before the choice still stand open on the console's {@link NEW_TAB_CHOICE}. */
  readonly choicePages: number;
  /**
   * How many other pages opened since just before the choice, wherever they stand now and closed again or not, so a
   * second page the choice opened at the choice and then moved off it or closed is still seen.
   */
  readonly otherPages: number;
}

/**
 * Whether choosing a page off the menu opened it as Chrome's + does: exactly one new tab — told apart from the tabs
 * standing before by its id, never by being last — and that tab last, in front, on a new page at the choice, wearing
 * the glyph the menu showed for it.
 *
 * @param before the snapshot just before the choice
 * @param after the snapshot once it settled
 * @param glyph the chosen item's glyph
 * @returns every way it did not; empty when it held
 */
export function newTabOpenBreaks({
  before,
  after,
  glyph,
}: {
  before: NewTabSnapshot;
  after: NewTabSnapshot;
  glyph: string;
}): readonly string[] {
  const breaks: string[] = [];
  if (after.choicePages !== before.choicePages + 1) {
    breaks.push(`no new console page stands on ${NEW_TAB_CHOICE}`);
  }
  if (after.otherPages !== before.otherPages) {
    breaks.push(`choosing ${NEW_TAB_CHOICE} also opened ${String(after.otherPages - before.otherPages)} other page(s)`);
  }
  // A tab with no id cannot be told apart from one that stood before, so the step judges nothing past it.
  if (after.tabs.some((tab) => tab.id === undefined)) {
    breaks.push("a tab in the strip draws no id, so the new one cannot be told apart");
    return breaks;
  }
  // Counted as well as told apart by id, so a second new tab reusing a standing id still fails.
  if (after.tabs.length !== before.tabs.length + 1) {
    breaks.push(
      `the strip went from ${String(before.tabs.length)} tab(s) to ${String(after.tabs.length)}, not one more`,
    );
  }
  // A choice leaves every standing tab as it was, in its place, so a tab changed, moved or whose id was handed on
  // fails here, and the new tab is never told apart from a standing one by id alone.
  const shape = ({ tabs }: { tabs: readonly NewTabStripTab[] }): string =>
    tabs.map((tab) => `${String(tab.id)}:${String(tab.icon)}`).join(", ");
  const kept = shape({ tabs: after.tabs.slice(0, before.tabs.length) });
  const stood = shape({ tabs: before.tabs });
  if (kept !== stood) {
    breaks.push(`the standing tabs went from ${stood} to ${kept}`);
    return breaks;
  }
  const standing = new Set(before.tabs.map((tab) => tab.id));
  const added = after.tabs.filter((tab) => !standing.has(tab.id));
  const [opened] = added;
  if (added.length !== 1 || opened === undefined) {
    breaks.push(`choosing ${NEW_TAB_CHOICE} added ${String(added.length)} tab(s), not exactly one`);
    return breaks;
  }
  if (after.tabs.at(-1)?.id !== opened.id) {
    breaks.push("the chosen page's tab is not the last one");
  }
  if (!opened.selected) {
    breaks.push("the chosen page's tab did not come in front");
  }
  // In front means the one tab in front, so a standing tab still or newly selected beside it fails.
  const alsoSelected = after.tabs.filter((tab) => tab.selected && tab.id !== opened.id);
  if (alsoSelected.length > 0) {
    breaks.push(`standing tab(s) still selected: ${alsoSelected.map((tab) => String(tab.id)).join(", ")}`);
  }
  if (opened.icon !== glyph) {
    breaks.push(`the new tab wears ${String(opened.icon)}, not the menu's ${glyph}`);
  }
  return breaks;
}
