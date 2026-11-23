/**
 * The `new-tab` step of `slopweaver desktop e2e`, its effectful half: press the real + after the last tab on the test
 * instance, read the native menu main built for it, choose {@link NEW_TAB_CHOICE} off it, and read the tab that
 * opened. What the menu must offer and the tab must be is the pure half's (`../../../desktop/e2eNewTab.ts`).
 *
 * A native menu is no page, so nothing Playwright drives can see or click it. The step wraps the instance's own
 * `Menu.prototype.popup` in its main process for the length of the step, so the menu the + pops is kept as it pops,
 * still shown natively; the step reads its items, closes it, and clicks the chosen item through Electron's own
 * `MenuItem.click`, which is what a click on it runs. The wrap is undone before the step ends, pass or fail.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import {
  menuGlyph,
  menuName,
  NEW_TAB_CHOICE,
  NEW_TAB_CHOICE_NAME,
  type NewTabSnapshot,
  type NewTabStripTab,
  newTabMenuBreaks,
  newTabOpenBreaks,
} from "../../../desktop/e2eNewTab.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { consolePathOfUrl, pause, photograph } from "./e2ePage.js";
import { closeOpenedPages, closeOpenedTabs, STRIP_TAB, stripPage } from "./e2ePinnedQueue.js";
import { acted, type E2eActed } from "./e2eQueueCard.js";

/** How long the menu, then the chosen page's tab, has to show before the step judges it as it stands. */
const SHOW_CAP_MS = 15_000;

/** How often a settling read is repeated. */
const POLL_MS = 250;

/** How long a right read must still hold before the step passes it. */
const SETTLE_MS = 1_500;

/** The strip's + (`desktop/src/tabStrip.ts` `stripMarkup`). */
const NEW_TAB_BUTTON = "#strip button.new-tab";

/**
 * Wrap the instance's `Menu.prototype.popup` so every menu popped is kept where the step can read it. The
 * function runs in the instance's main process, so it names its globals rather than closing over constants.
 *
 * @param app the instance
 */
async function keepPoppedMenus({ app }: { app: ElectronApplication }): Promise<void> {
  await app.evaluate(({ Menu }) => {
    // `src/` has no Electron types, so a rest list stands in for each signature it wraps.
    // The original rides on the wrapper itself, a fresh function nothing else can hold, so the release restores it
    // whatever any global holds; a wrap already in place is never wrapped twice.
    // Every menu's `popup`, however the menu was built, so a menu made with `new Menu()` is kept too.
    // Every menu popped during the step is kept in order: the step judges the first, and fails if another popped
    // beside it, so no other menu can stand in for the +'s. The list starts empty even over a wrap an
    // earlier run left, so no menu popped before this step is ever judged as the +'s.
    Reflect.set(globalThis, "__swE2ePopped", []);
    if (Reflect.get(Menu.prototype.popup, "swE2eOriginal") !== undefined) {
      return;
    }
    const popup = Menu.prototype.popup;
    // named-object-params-exempt: Electron calls Menu.prototype.popup with its own receiver and arguments, so the wrapper keeps that shape
    const wrapper = function (this: unknown, ...options: unknown[]): unknown {
      Reflect.get(globalThis, "__swE2ePopped")?.push(this);
      return popup.apply(this, options);
    };
    // Fixed for the wrapper's life, so nothing the instance runs during the step can swap what the release restores.
    Object.defineProperty(wrapper, "swE2eOriginal", { configurable: false, value: popup, writable: false });
    Menu.prototype.popup = wrapper;
  });
}

/**
 * Undo {@link keepPoppedMenus}, closing a menu it kept that is still up. It throws when the step's wrapper is no
 * longer the function in place, since the original it carries can then not be restored.
 *
 * @param app the instance
 */
async function releasePoppedMenus({ app }: { app: ElectronApplication }): Promise<void> {
  await app.evaluate(({ Menu }) => {
    // Restore before anything else can throw, so a failing close never leaves the wrap in place.
    const popup = Reflect.get(Menu.prototype.popup, "swE2eOriginal");
    if (popup !== undefined) {
      Menu.prototype.popup = popup;
    }
    const popped = Reflect.get(globalThis, "__swE2ePopped");
    Reflect.deleteProperty(globalThis, "__swE2ePopped");
    if (popup === undefined) {
      throw new Error("Menu.prototype.popup was replaced during the step, so its original could not be restored");
    }
    if (Array.isArray(popped)) {
      for (const menu of popped) {
        menu.closePopup();
      }
    }
  });
}

/**
 * How many menus have popped since the step began keeping them.
 *
 * @param app the instance
 * @returns the count
 */
async function poppedCount({ app }: { app: ElectronApplication }): Promise<number> {
  const count: unknown = await app.evaluate(() => Reflect.get(globalThis, "__swE2ePopped")?.length);
  return typeof count === "number" ? count : 0;
}

/**
 * The labels of the menu the + popped, read until one has popped or the cap passes.
 *
 * @param app the instance
 * @returns its items' labels in order, or `undefined` when none popped
 */
async function poppedLabels({ app }: { app: ElectronApplication }): Promise<readonly string[] | undefined> {
  const deadline = Date.now() + SHOW_CAP_MS;
  for (;;) {
    const read: unknown = await app.evaluate(() => {
      const menu = Reflect.get(globalThis, "__swE2ePopped")?.[0];
      if (menu === undefined) {
        return null;
      }
      // An item the popup does not show, or shows greyed, is not offered, so its label is marked and fails the judge
      // while every index still matches the menu's own.
      return menu.items.map((item: { label: string; visible: boolean; enabled: boolean }) =>
        item.visible && item.enabled ? item.label : `${item.label} (not offered)`,
      );
    });
    if (Array.isArray(read)) {
      return read.filter((label): label is string => typeof label === "string");
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await pause({ ms: POLL_MS });
  }
}

/**
 * Close the kept menu and click one of its items through Electron's own `MenuItem.click`.
 *
 * @param app the instance
 * @param index the item's place in the menu
 */
async function choose({ app, index }: { app: ElectronApplication; index: number }): Promise<void> {
  await app.evaluate((_electron, at) => {
    const menu = Reflect.get(globalThis, "__swE2ePopped")[0];
    menu.closePopup();
    menu.items[at].click();
  }, index);
}

/**
 * Read what the strip shows now.
 *
 * @param strip the tab strip
 * @param origin the console's origin, read off the pinned tab: a page at the choice's path anywhere else is not it
 * @param opened every page the instance opened since just before the choice, closed ones included: only those count,
 *   so one closing cannot hide two opening, and one that opened and closed again still counts.
 * @returns the snapshot
 */
async function snapshotOf({
  strip,
  origin,
  opened,
}: {
  strip: Page;
  origin: string;
  opened: readonly Page[];
}): Promise<NewTabSnapshot> {
  const tabs = await strip.locator(STRIP_TAB).evaluateAll((nodes) =>
    nodes.map((node) => ({
      icon: node.querySelector(".icon")?.textContent,
      id: node.getAttribute("data-tab"),
      selected: node.getAttribute("aria-selected") === "true",
    })),
  );
  // A closed page keeps its last address, so only an open one stands on the choice; a closed one counts as another
  // page.
  const choicePages = opened.filter(
    (page) =>
      !page.isClosed() &&
      URL.canParse(page.url()) &&
      new URL(page.url()).origin === origin &&
      consolePathOfUrl({ url: page.url() }) === NEW_TAB_CHOICE,
  ).length;
  return {
    choicePages,
    otherPages: opened.length - choicePages,
    tabs: tabs.map((tab) => stripTabOf(tab)),
  };
}

/**
 * A value the strip's DOM read reports absent as `null` (no attribute, no text) or `undefined` (no such element),
 * as the one absence the step's shape carries.
 *
 * @param value what the DOM read gave
 * @returns the value, or `undefined` when the DOM reported none
 */
function presentOrUndefined({ value }: { value: string | null | undefined }): string | undefined {
  if (value === null) {
    return undefined;
  }
  return value;
}

/**
 * One tab as the strip's DOM read gave it, made the shape the pure judge reads.
 *
 * @param icon the `.icon` element's text, `null` for none drawn and `undefined` for no such element
 * @param id the `data-tab` attribute, `null` when the tab draws none
 * @param selected whether `aria-selected` reads `true`
 * @returns the tab, each absence `undefined`
 */
export function stripTabOf({
  icon,
  id,
  selected,
}: {
  icon: string | null | undefined;
  id: string | null;
  selected: boolean;
}): NewTabStripTab {
  return { icon: presentOrUndefined({ value: icon }), id: presentOrUndefined({ value: id }), selected };
}

/**
 * Hold a first right read for {@link SETTLE_MS}, judging the strip at every poll rather than only at the end, so a
 * second tab the same choice opened a moment later still fails the step, and so does one that stood
 * across a poll inside the settle before closing again.
 *
 * @param strip the tab strip
 * @param before the strip just before the choice
 * @param glyph the chosen item's glyph, the new tab's icon
 * @param origin the console's origin
 * @param opened every page the instance opened since just before the choice
 * @returns nothing once it held, or every way it broke at the first read that broke
 */
async function settle({
  strip,
  before,
  glyph,
  origin,
  opened,
}: {
  strip: Page;
  before: NewTabSnapshot;
  glyph: string;
  origin: string;
  opened: readonly Page[];
}): Promise<Result<void, E2eStepBlock>> {
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    await pause({ ms: POLL_MS });
    const breaks = newTabOpenBreaks({ after: await snapshotOf({ opened, origin, strip }), before, glyph });
    if (breaks.length > 0) {
      return err(E2eStepBlocks.newTabBroken({ breaks }));
    }
    if (Date.now() > deadline) {
      return ok(undefined);
    }
  }
}

/**
 * Choose the page off the kept menu and wait, bounded, for its tab to show as it should.
 *
 * @param app the instance
 * @param strip the tab strip
 * @param labels the kept menu's labels
 * @param origin the console's origin
 * @returns nothing once it held, or every way it broke
 */
async function chooseAndJudge({
  app,
  strip,
  labels,
  origin,
}: {
  app: ElectronApplication;
  strip: Page;
  labels: readonly string[];
  origin: string;
}): Promise<Result<void, E2eStepBlock>> {
  const index = labels.findIndex((label) => menuName({ label }) === NEW_TAB_CHOICE_NAME);
  const label = labels[index];
  const glyph = label === undefined ? undefined : menuGlyph({ label });
  if (glyph === undefined) {
    return err(E2eStepBlocks.newTabBroken({ breaks: [`the menu has no ${NEW_TAB_CHOICE_NAME} item`] }));
  }
  const opened: Page[] = [];
  const keep: (page: Page) => void = (page) => {
    opened.push(page);
  };
  app.context().on("page", keep);
  try {
    const before = await snapshotOf({ opened, origin, strip });
    // The cap runs from the click, so time the item's own handler spends counts against it.
    const deadline = Date.now() + SHOW_CAP_MS;
    await choose({ app, index });
    for (;;) {
      // Timed before the read, so a first right read the cap had already passed fails rather than passes.
      const late = Date.now() > deadline;
      const breaks = newTabOpenBreaks({ after: await snapshotOf({ opened, origin, strip }), before, glyph });
      if (late && breaks.length === 0) {
        return err(
          E2eStepBlocks.newTabBroken({ breaks: [`the choice came right only after ${String(SHOW_CAP_MS)}ms`] }),
        );
      }
      if (late) {
        return err(E2eStepBlocks.newTabBroken({ breaks }));
      }
      if (breaks.length === 0) {
        return await settle({ before, glyph, opened, origin, strip });
      }
      await pause({ ms: POLL_MS });
    }
  } finally {
    app.context().off("page", keep);
  }
}

/**
 * Take the step: press +, judge the menu it popped, choose a page off it, judge the tab that opened, then photograph
 * the strip and close the tab.
 *
 * @param app the instance
 * @param pinned the pinned tab's page, the Queue the walk stands on
 * @param stripShot where the strip's photograph goes
 * @returns the pinned tab's page to photograph, or every way the + broke
 */
export async function proveNewTab({
  app,
  pinned,
  stripShot,
}: {
  app: ElectronApplication;
  pinned: Page;
  stripShot: string;
}): Promise<Result<E2eActed, E2eStepBlock>> {
  const strip = await stripPage({ app });
  if (strip === undefined) {
    return err(E2eStepBlocks.noTabStrip());
  }
  const baseline = await strip.locator(STRIP_TAB).count();
  const standing = new Set(app.context().pages());
  let broke: E2eStepBlock | undefined;
  try {
    await keepPoppedMenus({ app });
    await strip.locator(NEW_TAB_BUTTON).click();
    const labels = await poppedLabels({ app });
    const breaks = newTabMenuBreaks({ labels });
    if (labels === undefined || breaks.length > 0) {
      broke = E2eStepBlocks.newTabBroken({ breaks });
    } else {
      const chosen = await chooseAndJudge({ app, labels, origin: new URL(pinned.url()).origin, strip });
      const popped = await poppedCount({ app });
      if (chosen.isErr()) {
        broke = chosen.error;
      } else if (popped !== 1) {
        broke = E2eStepBlocks.newTabBroken({ breaks: [`${String(popped)} menus popped during the step, not one`] });
      }
    }
  } catch (cause: unknown) {
    broke = E2eStepBlocks.actionThrew({ cause });
  } finally {
    // A wrap left in place would keep every later menu of the instance, so a failed release fails the step.
    const released = await releasePoppedMenus({ app }).then(
      () => undefined,
      (cause: unknown) => E2eStepBlocks.actionThrew({ cause }),
    );
    // The step's own break names what went wrong first; a failed release stands only when nothing else broke.
    broke = [broke, released].find((block) => block !== undefined);
    await photograph({ page: strip, path: stripShot }).catch(() => undefined);
    await closeOpenedTabs({ baseline, strip }).catch(() => undefined);
    await closeOpenedPages({ app, standing });
  }
  if (broke !== undefined) {
    return err(broke);
  }
  return ok(acted({ page: pinned }));
}
