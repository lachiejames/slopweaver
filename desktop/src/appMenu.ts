/**
 * The macOS application menu, as data: the app-name menu with "Check for Updates…" where ChatGPT and Chrome put it,
 * then the standard File, Edit, View and Window menus. Pure; `main.ts` builds it into Electron's menu.
 *
 * A macOS app-name menu conventionally offers "Check for Updates…", so the shell sets its own application menu
 * rather than leaving Electron's default. The update item's words and its click are
 * the menu bar icon's own (`trayUpdateItem` in `updatePlan.ts`, `clickUpdate` in `updateShell.ts`): one decision,
 * shown in two places. The standard menus are Electron's roles, so copy, paste, undo, select all, reload, zoom, full
 * screen and minimise work as they did under the default; ⌘F, ⌘W and the tab keys are taken in each page's
 * `before-input-event`, which runs before any menu accelerator. There is no Help menu: Electron's default one points
 * at Electron, and Slopweaver has no help page to put there.
 */

/** The id the update item carries, so the shell can attach its click to that one entry. */
export const APP_MENU_UPDATE_ID = "app-update";

/** One entry of the app-name menu. */
export type AppMenuEntry =
  | { readonly role: "about" | "services" | "hide" | "hideOthers" | "unhide" | "quit" }
  | { readonly type: "separator" }
  | { readonly enabled: false; readonly label: string }
  | { readonly id: typeof APP_MENU_UPDATE_ID; readonly enabled: boolean; readonly label: string };

/** The whole application menu: the app-name menu, then the four standard menus. */
export type AppMenuTemplate = readonly [
  { readonly label: string; readonly submenu: readonly AppMenuEntry[] },
  { readonly role: "fileMenu" },
  { readonly role: "editMenu" },
  { readonly role: "viewMenu" },
  { readonly role: "windowMenu" },
];

const SEPARATOR = { type: "separator" } as const;

/**
 * The application menu for the update standing now: About, the last failed update's line when there is one, the
 * update item, Services, Hide, Hide Others, Show All and Quit, then File, Edit, View and Window.
 *
 * @param appName the name the app runs under, the app-name menu's label — macOS titles that menu with the bundle's
 *   own name whatever the label says, so a dev run's still reads "Electron"
 * @param update the update item's words and whether pressing it does anything now, as the menu bar icon shows it
 * @param outcomeLine the last failed update's line, or `undefined` when there is none
 * @returns the menu, as plain data with no click attached
 */
export function appMenuTemplate({
  appName,
  update,
  outcomeLine,
}: {
  appName: string;
  update: { readonly label: string; readonly enabled: boolean };
  outcomeLine: string | undefined;
}): AppMenuTemplate {
  const submenu: AppMenuEntry[] = [{ role: "about" }, SEPARATOR];
  if (outcomeLine !== undefined) {
    submenu.push({ enabled: false, label: outcomeLine });
  }
  submenu.push({ enabled: update.enabled, id: APP_MENU_UPDATE_ID, label: update.label });
  submenu.push(
    SEPARATOR,
    { role: "services" },
    SEPARATOR,
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    SEPARATOR,
    { role: "quit" },
  );
  return [
    { label: appName, submenu },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
