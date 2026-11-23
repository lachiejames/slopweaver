/**
 * The macOS application menu, applied to Electron: `appMenu.ts`'s template with the update item's click attached,
 * set only when what it shows has changed.
 */
import { app, Menu, type MenuItemConstructorOptions } from "electron";

import { appMenuTemplate } from "./appMenu";
import { clickUpdate, updateMenuView } from "./updateShell";

/** The application menu last set, as its plain template's JSON, so an unchanged one is never set again. */
let appMenuKey: string | undefined;

/**
 * Set the application menu when what it shows has changed. Every shell event redraws the menu bar icon, which calls
 * this, and replacing an unchanged application menu could close it under you, so the plain template — no click in
 * it yet, which JSON would drop — is compared first.
 */
export function drawAppMenu(): void {
  const { item, outcomeLine } = updateMenuView();
  const template = appMenuTemplate({ appName: app.getName(), outcomeLine, update: item });
  const key = JSON.stringify(template);
  if (key === appMenuKey) {
    return;
  }
  const [appNameMenu, ...standard] = template;
  const submenu: MenuItemConstructorOptions[] = appNameMenu.submenu.map((entry) => {
    // Only the update item carries an id (`APP_MENU_UPDATE_ID`, the one value its type allows).
    if ("id" in entry) {
      return { ...entry, click: clickUpdate };
    }
    return { ...entry };
  });
  const items: MenuItemConstructorOptions[] = [{ label: appNameMenu.label, submenu }, ...standard];
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
  appMenuKey = key;
}
