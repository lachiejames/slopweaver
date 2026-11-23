/**
 * The look the tab strip wears, applied to Electron: the colours a console page in a tab reports through its preload,
 * checked (`tabStripLook.ts` `parseStripTokens`) and kept for the strip to draw in. `tabsShell.ts` owns the strip and
 * says which pages are a tab's; this owns only what colour it is.
 */
import { ipcMain, type WebContents } from "electron";

import { parseStripTokens, type StripPaletteProperties, stripPaletteOf, stripPaletteProperties } from "./tabStripLook";

/** A console page in a tab to main: the colours of the look it wears. Spelled again in `preload.ts`. */
const PALETTE_CHANNEL = "slopweaver:strip-palette";

/** The strip's colours from the look a console page last reported, or `null` before any has — sent as `null`. */
let palette: StripPaletteProperties | null = null;

/**
 * The strip's colours now.
 *
 * @returns one value per strip property, or `null` before any console page has reported its look
 */
export function stripPaletteNow(): StripPaletteProperties | null {
  return palette;
}

/**
 * Take the look a console page wears, only from a page in one of the tabs — any of them, since every console page wears
 * the one look — and keep it until a page reports another, so a holding page that reports none leaves it. A report from
 * anywhere else, or one `parseStripTokens` refuses, is a page's word main does not take, exactly as `parseTabCommand`
 * refuses a command: nothing is drawn in its place, and the strip keeps the look it last wore.
 *
 * @param isTabPage whether a page is one of the tabs'
 * @param redraw draws the strip again, in the look just taken
 */
export function listenForStripPalette({
  isTabPage,
  redraw,
}: {
  isTabPage: (page: { readonly contents: WebContents }) => boolean;
  redraw: () => void;
}): void {
  ipcMain.on(PALETTE_CHANNEL, (event, value: unknown) => {
    if (event.senderFrame?.parent !== null || !isTabPage({ contents: event.sender })) {
      return;
    }
    const tokens = parseStripTokens({ value });
    if (tokens.isErr()) {
      return;
    }
    palette = stripPaletteProperties({ palette: stripPaletteOf({ tokens: tokens.value }) });
    redraw();
  });
}
