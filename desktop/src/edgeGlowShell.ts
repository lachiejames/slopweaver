/**
 * The four screen-edge strip windows that draw the call's edge glow and a share's amber frame (`edgeGlow.ts` says why
 * four strips, not the voice's own window). Main owns them: the voice's page reports its glow on
 * `slopweaver:overlay-glow`, main's capture ledger says whether a share is live, and these windows draw both.
 *
 * Each strip is a frameless, transparent, shadowless, non-activating panel that never takes the pointer, at the
 * voice's own level (`overlayWindow.ts` `WHOLE_LEVEL`), on every Space, full-screen ones included. Never
 * content-protected — every picture of the owner's screen has the glow in it as they see it. Shown only while something is lit, so outside that the window picker never meets them, and created on the
 * first lit moment, so a session with no call makes none. Showing or hiding a strip never moves the orb's window, so
 * the orb never jumps as the window flips between its corner and the display.
 *
 * Residue, accepted: showing a strip orders it front of its level, so a glow that FIRST
 * lights while a ⌘⇧5 veil is already up draws its thin edge undimmed over that veil until the veil closes. Making
 * the strips earlier does not help, since each hide-to-show re-orders them; only strips kept shown while dark would,
 * and a shown strip is one the window picker meets at the screen's edge, the defect this module exists to remove.
 */
import { app, BrowserWindow, type IpcMainEvent, ipcMain, screen } from "electron";

import {
  DARK_REPORT,
  EDGE_STRIP_DEPTH,
  EDGES,
  type Edge,
  type EdgeGlowView,
  edgeGlowDocument,
  edgeGlowLit,
  edgeStripBounds,
  edgeStripCall,
  type OverlayGlowReport,
  parseOverlayGlowReport,
} from "./edgeGlow";
import { WHOLE_LEVEL } from "./overlayWindow";
import type { Bounds } from "./persistedState";

/** The channel the voice's page reports its glow on (`preload.ts` `reportOverlayGlow`). */
const GLOW_CHANNEL = "slopweaver:overlay-glow";

/** What a window's title reads, so a window list names it. */
const STRIP_TITLE = "Slopweaver edge glow";

/** What main does to the strips. */
export interface EdgeGlowShell {
  /** The voice's page is gone (reloaded, crashed, closed): its glow goes dark until the next page reports. */
  readonly retire: () => void;
  /** Main's capture ledger changed: whether a share is live. */
  readonly setSharing: (input: { readonly sharing: boolean }) => void;
}

/** One strip: its window, and whether its page is up to take a draw. */
interface Strip {
  readonly window: BrowserWindow;
  loaded: boolean;
}

/**
 * Start the strips' shell: listen for the page's glow and draw it, with the share main already knows about.
 *
 * @param fromOverlay whether a message came from the voice's own page, the one sender the glow is taken from
 * @returns what main does to the strips
 */
export function startEdgeGlowShell({
  fromOverlay,
}: {
  fromOverlay: (input: { readonly event: IpcMainEvent }) => boolean;
}): EdgeGlowShell {
  let report: OverlayGlowReport = DARK_REPORT;
  let sharing = false;
  const strips = new Map<Edge, Strip>();

  const viewNow = (): EdgeGlowView => ({ ...report, sharing });

  const make = ({ edge, bounds }: { edge: Edge; bounds: Bounds }): Strip => {
    const window = new BrowserWindow({
      ...bounds,
      backgroundColor: "#00000000",
      // As the overlay: without it macOS pulls the top strip down below the menu bar as it is shown.
      enableLargerThanScreen: true,
      focusable: false,
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      movable: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      title: STRIP_TITLE,
      transparent: true,
      type: "panel",
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, WHOLE_LEVEL);
    window.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true, visibleOnFullScreen: true });
    window.on("page-title-updated", (event) => {
      event.preventDefault();
    });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    const strip: Strip = { loaded: false, window };
    contents.on("did-finish-load", () => {
      strip.loaded = true;
      draw();
    });
    window.on("closed", () => {
      if (strips.get(edge) === strip) {
        strips.delete(edge);
      }
    });
    // A strip whose page died is closed and redrawn, so a live share never loses its frame. A crash
    // inside a pulse's 900ms replays that one flash on the rebuilt strip, which starts with no key: left as is,
    // since only main remembering the key per strip would close it, and one repeated flash harms nothing.
    contents.on("render-process-gone", () => {
      if (strips.get(edge) === strip) {
        strips.delete(edge);
      }
      window.destroy();
      draw();
    });
    void window.loadURL(edgeGlowDocument());
    return strip;
  };

  const draw = (): void => {
    const view = viewNow();
    if (!edgeGlowLit({ view })) {
      for (const strip of strips.values()) {
        if (strip.window.isVisible()) {
          strip.window.hide();
        }
      }
      return;
    }
    const display = screen.getPrimaryDisplay().bounds;
    const bounds = edgeStripBounds({ depth: EDGE_STRIP_DEPTH, display });
    for (const edge of EDGES) {
      let strip = strips.get(edge);
      if (strip === undefined || strip.window.isDestroyed()) {
        strip = make({ bounds: bounds[edge], edge });
        strips.set(edge, strip);
      }
      paint({ display, strip, stripBounds: bounds[edge], view });
    }
  };

  const paint = ({
    strip,
    stripBounds,
    display,
    view,
  }: {
    strip: Strip;
    stripBounds: Bounds;
    display: Bounds;
    view: EdgeGlowView;
  }): void => {
    const { window } = strip;
    const now = window.getBounds();
    const moved =
      now.x !== stripBounds.x ||
      now.y !== stripBounds.y ||
      now.width !== stripBounds.width ||
      now.height !== stripBounds.height;
    if (moved) {
      window.setBounds(stripBounds);
    }
    if (!strip.loaded) {
      return;
    }
    // Drawn before it is shown, so a strip coming back never shows the last glow it held.
    void reveal({ call: edgeStripCall({ display, strip: stripBounds, view }), window });
  };

  const reveal = async ({ window, call }: { window: BrowserWindow; call: string }): Promise<void> => {
    try {
      await window.webContents.executeJavaScript(call);
    } catch {
      // A strip torn down mid-draw: the next draw makes a fresh one.
      return;
    }
    if (!window.isDestroyed() && !window.isVisible() && edgeGlowLit({ view: viewNow() })) {
      window.showInactive();
    }
  };

  const onGlow = (event: IpcMainEvent, value: unknown): void => {
    const parsed = parseOverlayGlowReport({ value });
    if (parsed === undefined || !fromOverlay({ event })) {
      return;
    }
    report = parsed;
    draw();
  };
  ipcMain.on(GLOW_CHANNEL, onGlow);
  // The strips line the primary display, wherever it is now.
  screen.on("display-metrics-changed", draw);
  screen.on("display-added", draw);
  screen.on("display-removed", draw);
  app.on("will-quit", () => {
    ipcMain.removeListener(GLOW_CHANNEL, onGlow);
    for (const strip of strips.values()) {
      if (!strip.window.isDestroyed()) {
        strip.window.destroy();
      }
    }
    strips.clear();
  });

  return {
    retire: () => {
      report = DARK_REPORT;
      draw();
    },
    setSharing: (input) => {
      if (sharing === input.sharing) {
        return;
      }
      sharing = input.sharing;
      draw();
    },
  };
}
