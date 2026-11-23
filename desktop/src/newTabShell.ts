/**
 * The new-tab button's menu, applied to Electron: a native menu of the console's pages under the button, each with the
 * icon its tab will wear, and the one chosen opened in a new tab in front. The pages are `tabPages.ts`'s; what opening
 * one does is the caller's, `tabsShell.ts`'s `openNewTab`, whose load puts a docs page inside the viewer as every
 * other tab's does.
 *
 * A menu rather than a blank tab, because the console has no new-tab page and every page the owner would open from one is a
 * sidebar page: choosing it is the one step a blank tab would make them take anyway.
 */
import { type BaseWindow, Menu } from "electron";

import { NEW_TAB_PAGES } from "./tabPages";

/**
 * Open the menu of pages at a point in the window, the strip's coordinates being the window's own.
 *
 * @param target the console window
 * @param x the point's left, in the window's content
 * @param y the point's top
 * @param open opens a console page in a new tab in front
 */
export function popNewTabMenu({
  target,
  x,
  y,
  open,
}: {
  target: BaseWindow;
  x: number;
  y: number;
  open: (page: { readonly path: string }) => void;
}): void {
  const items = NEW_TAB_PAGES.map((page) => ({
    click: (): void => {
      open({ path: page.path });
    },
    label: `${page.glyph}  ${page.label}`,
  }));
  Menu.buildFromTemplate(items).popup({ window: target, x, y });
}
