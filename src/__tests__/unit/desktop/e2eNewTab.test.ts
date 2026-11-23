import { describe, expect, it } from "vitest";

import { CONSOLE_ROUTES } from "../../../consoleProfile/plan.js";
import {
  menuGlyph,
  menuName,
  NEW_TAB_CHOICE,
  NEW_TAB_CHOICE_NAME,
  NEW_TAB_PAGES,
  type NewTabSnapshot,
  newTabMenuBreaks,
  newTabOpenBreaks,
} from "../../../desktop/e2eNewTab.js";

/** What the menu must show, as the break names it. */
const WANTED = "Alignment, Pull requests, Workstreams, Automations, Fleet, Docs";

/** The menu `desktop/src/newTabShell.ts` builds today, as its items' labels. */
const MENU = ["◇  Alignment", "⇄  Pull requests", "▰  Workstreams", "↻  Automations", "◎  Fleet", "¶  Docs"];

const QUEUE_TAB = { icon: "☰", id: "t1", selected: true };

const BEFORE: NewTabSnapshot = { choicePages: 0, otherPages: 0, tabs: [QUEUE_TAB] };

describe("NEW_TAB_PAGES", () => {
  it("is every console sidebar page but the Queue, in the sidebar's order", () => {
    const sidebar = CONSOLE_ROUTES.filter((route) => route.inSidebar && route.path !== "/queue");
    expect(sidebar.length).toBeGreaterThan(0);
    expect(NEW_TAB_PAGES.map((page) => page.path)).toEqual(sidebar.map((route) => route.path));
  });

  it("names the choice as the item for its path", () => {
    expect(NEW_TAB_PAGES.find((page) => page.path === NEW_TAB_CHOICE)!.name).toBe(NEW_TAB_CHOICE_NAME);
  });
});

describe("menuGlyph and menuName", () => {
  it("split a label at the two-space gap, and read nothing from a label with no name or no glyph", () => {
    expect(menuGlyph({ label: "⇄  Pull requests" })).toBe("⇄");
    expect(menuName({ label: "⇄  Pull requests" })).toBe("Pull requests");
    expect(menuGlyph({ label: "Pull requests" })).toBeUndefined();
    expect(menuName({ label: "Pull requests" })).toBeUndefined();
    expect(menuGlyph({ label: "  Pull requests" })).toBeUndefined();
    expect(menuGlyph({ label: "⇄  " })).toBeUndefined();
    expect(menuName({ label: "⇄  " })).toBeUndefined();
  });
});

describe("newTabMenuBreaks", () => {
  it("passes the menu the shell builds", () => {
    expect(newTabMenuBreaks({ labels: MENU })).toEqual([]);
  });

  it("names a + that popped no menu", () => {
    expect(newTabMenuBreaks({ labels: undefined })).toEqual(["pressing + popped no menu"]);
  });

  it("names a menu that offers the Queue, a page short, or an item with no glyph", () => {
    expect(newTabMenuBreaks({ labels: ["☰  Queue", ...MENU.slice(0, 5), "Docs"] })).toEqual([
      `the menu offered Queue, Alignment, Pull requests, Workstreams, Automations, Fleet, undefined, not ${WANTED}`,
      "the menu offered the Queue, which has only its pinned tab",
      "menu item(s) with no glyph ahead of the name: Docs",
    ]);
    expect(newTabMenuBreaks({ labels: MENU.slice(1) })).toEqual([
      `the menu offered Pull requests, Workstreams, Automations, Fleet, Docs, not ${WANTED}`,
    ]);
  });

  it("names an item the popup hid or greyed, which the effectful half marks as not offered", () => {
    const hidden = [`${MENU[0]!} (not offered)`, ...MENU.slice(1)];
    expect(newTabMenuBreaks({ labels: hidden })).toEqual([
      `the menu offered Alignment (not offered), Pull requests, Workstreams, Automations, Fleet, Docs, not ${WANTED}`,
    ]);
  });

  it("names an item wearing a glyph that is not its sidebar page's", () => {
    const relabelled = MENU.map((label) => `X  ${menuName({ label })!}`);
    expect(newTabMenuBreaks({ labels: relabelled })).toEqual([
      "menu item(s) wearing another page's glyph: X  Alignment (not ◇), X  Pull requests (not ⇄), X  Workstreams (not ▰), X  Automations (not ↻), X  Fleet (not ◎), X  Docs (not ¶)",
    ]);
  });

  it("names a menu of the right length whose items are the wrong pages or out of order", () => {
    const swapped = [MENU[1]!, MENU[0]!, ...MENU.slice(2)];
    expect(newTabMenuBreaks({ labels: swapped })).toEqual([
      `the menu offered Pull requests, Alignment, Workstreams, Automations, Fleet, Docs, not ${WANTED}`,
    ]);
    const renamed = [...MENU.slice(0, 5), "¶  Help"];
    expect(newTabMenuBreaks({ labels: renamed })).toEqual([
      `the menu offered Alignment, Pull requests, Workstreams, Automations, Fleet, Help, not ${WANTED}`,
    ]);
  });
});

describe("newTabOpenBreaks", () => {
  it("passes one more tab, last and in front, on a new page at the choice, wearing the menu's glyph", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [
        { ...QUEUE_TAB, selected: false },
        { icon: "⇄", id: "t2", selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([]);
  });

  it("names a second page the choice opened, wherever it stands now", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 1,
      tabs: [
        { ...QUEUE_TAB, selected: false },
        { icon: "⇄", id: "t2", selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([
      "choosing /pull-requests also opened 1 other page(s)",
    ]);
  });

  it("names a choice that opened nothing", () => {
    expect(newTabOpenBreaks({ after: BEFORE, before: BEFORE, glyph: "⇄" })).toEqual([
      "no new console page stands on /pull-requests",
      "the strip went from 1 tab(s) to 1, not one more",
      "choosing /pull-requests added 0 tab(s), not exactly one",
    ]);
  });

  it("names a tab that opened behind, and one that draws no icon", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [QUEUE_TAB, { icon: undefined, id: "t2", selected: false }],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([
      "the chosen page's tab did not come in front",
      "standing tab(s) still selected: t1",
      "the new tab wears undefined, not the menu's ⇄",
    ]);
  });

  it("judges the tab that was added, never an older last tab wearing the right glyph", () => {
    const detail = { icon: "⇄", id: "t2", selected: true };
    const before: NewTabSnapshot = { choicePages: 0, otherPages: 0, tabs: [{ ...QUEUE_TAB, selected: false }, detail] };
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [{ ...QUEUE_TAB, selected: false }, { icon: "○", id: "t3", selected: false }, detail],
    };
    expect(newTabOpenBreaks({ after, before, glyph: "⇄" })).toEqual([
      "the standing tabs went from t1:☰, t2:⇄ to t1:☰, t3:○",
    ]);
  });

  it("never mistakes a standing tab handed a new id for the new tab", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [
        { icon: "⇄", id: "t1", selected: false },
        { icon: "⇄", id: "t2", selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([
      "the standing tabs went from t1:☰ to t1:⇄",
    ]);
  });

  it("names a second new tab that reuses a standing tab's id", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [
        { ...QUEUE_TAB, selected: false },
        { icon: "○", id: "t1", selected: false },
        { icon: "⇄", id: "t2", selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([
      "the strip went from 1 tab(s) to 3, not one more",
    ]);
  });

  it("names a standing tab left selected beside the new one", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [QUEUE_TAB, { icon: "⇄", id: "t2", selected: true }],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual(["standing tab(s) still selected: t1"]);
  });

  it("names standing tabs the choice moved", () => {
    const before: NewTabSnapshot = {
      choicePages: 0,
      otherPages: 0,
      tabs: [QUEUE_TAB, { icon: "◇", id: "t2", selected: false }],
    };
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [
        { icon: "◇", id: "t2", selected: false },
        { ...QUEUE_TAB, selected: false },
        { icon: "⇄", id: "t3", selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before, glyph: "⇄" })).toEqual([
      "the standing tabs went from t1:☰, t2:◇ to t2:◇, t1:☰",
    ]);
  });

  it("never passes a strip with a tab that draws no id, the new one included", () => {
    const after: NewTabSnapshot = {
      choicePages: 1,
      otherPages: 0,
      tabs: [
        { ...QUEUE_TAB, selected: false },
        { icon: "⇄", id: undefined, selected: true },
      ],
    };
    expect(newTabOpenBreaks({ after, before: BEFORE, glyph: "⇄" })).toEqual([
      "a tab in the strip draws no id, so the new one cannot be told apart",
    ]);
  });
});
