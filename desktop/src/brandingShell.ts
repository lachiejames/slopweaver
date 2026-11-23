/**
 * Which Slopweaver this is, applied to Electron: a window's title held to the build's name, and a dev run's Dock
 * icon. The decisions are `buildIdentity.ts`.
 */
import { app, type BrowserWindow, nativeImage } from "electron";

import { appIconBitmap, encodePng } from "./appIcon";
import { type BuildIdentity, DEV_DOCK_BADGE, windowTitle } from "./buildIdentity";
import { readAppLogo } from "./trayImage";

/**
 * Hold a window to a title naming Slopweaver, and in a dev run the dev build — the document's own `<title>` is kept
 * as the page's part of it, never the whole.
 *
 * @param target the window
 * @param identity this run, fixed at boot before any window is made
 * @param fixed a title that stands whatever the document says; omitted, the document's title is the page's part
 */
export function brandTitle({
  target,
  identity,
  fixed,
}: {
  target: BrowserWindow;
  identity: BuildIdentity;
  fixed?: string;
}): void {
  const titleOf = ({ page }: { page: string }): string => {
    if (fixed !== undefined) {
      return windowTitle({ identity, page: fixed });
    }
    return windowTitle({ identity, page });
  };
  target.setTitle(titleOf({ page: "" }));
  target.on("page-title-updated", (event, page) => {
    event.preventDefault();
    target.setTitle(titleOf({ page }));
  });
}

/**
 * A dev run wears the logo in the Dock, badged, instead of Electron's atom; the packaged app's icon is its own.
 *
 * @param identity this run
 */
export function brandDock({ identity }: { identity: BuildIdentity }): void {
  if (process.platform !== "darwin" || !identity.dev) {
    return;
  }
  const size = 256;
  app.dock?.setIcon(
    nativeImage.createFromBuffer(encodePng({ pixels: appIconBitmap({ logo: readAppLogo(), size }), size })),
  );
  app.dock?.setBadge(DEV_DOCK_BADGE);
}
