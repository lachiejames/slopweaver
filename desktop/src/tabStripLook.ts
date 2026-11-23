/**
 * The tab strip page's look: its height, its first paint, the console colours it wears and the script-free document
 * that draws it. Pure; `tabsShell.ts` applies it.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";

/** The strip's height in points — the window's buttons are centred in it (`windowChrome.ts`). */
export const STRIP_HEIGHT = 38;

/**
 * The strip's first paint in each mode — a neutral grey, worn only until a console page in a tab reports the look it is
 * wearing ({@link parseStripTokens}), and the console window's ground before any page paints. Opaque like every surface
 * (opaque is the default for everything); the tabs' translucent
 * highlights sit on it, so what they draw is opaque too.
 */
export const STRIP_GROUND = { dark: "#16181d", light: "#eceef2" } as const;

/**
 * The console's own colours the strip is drawn in, each read off a console page as that page paints it (`--c-sidebar`,
 * `--c-bg`, `--c-card`, `--c-border`, `--c-ink`, `--c-muted`, written once in `site/lib/themePalettes.ts`'s palettes), so the
 * desktop never keeps a second copy of the looks.
 */
export interface StripTokens {
  readonly sidebar: string;
  readonly bg: string;
  readonly card: string;
  readonly border: string;
  readonly ink: string;
  readonly muted: string;
}

/** The strip's own colours: its ground, a tab, the tab showing, its edge, and its text. */
export interface StripPalette {
  readonly ground: string;
  readonly tab: string;
  readonly on: string;
  readonly line: string;
  readonly ink: string;
  readonly muted: string;
}

/** The custom properties {@link stripDocument}'s stylesheet draws the strip through, one per {@link StripPalette} field. */
export type StripPaletteProperty = "--ground" | "--tab" | "--on" | "--line" | "--ink" | "--muted";

/** A value for each of the strip's custom properties. */
export type StripPaletteProperties = Readonly<Record<StripPaletteProperty, string>>;

/** Every field a console page reports, in {@link StripTokens} order. */
const STRIP_TOKEN_KEYS = [
  "sidebar",
  "bg",
  "card",
  "border",
  "ink",
  "muted",
] as const satisfies readonly (keyof StripTokens)[];

/**
 * One plain `oklch(L C H)` colour, the only spelling a console palette is written in. Nothing else passes — no `;`,
 * brace, `var()` or second declaration — because the value is set as a CSS custom property on the strip page.
 */
const OKLCH = /^oklch\((?:\d+(?:\.\d+)?|\.\d+) (?:\d+(?:\.\d+)?|\.\d+) (?:\d+(?:\.\d+)?|\.\d+)\)$/u;

/**
 * The colours a console page reported, exactly: the six fields and no other, each one plain `oklch(L C H)` colour.
 *
 * @param value what the console page's preload sent
 * @returns the colours, or what about the report is not that
 */
export function parseStripTokens({ value }: { value: unknown }): Result<StripTokens, string> {
  if (!isRecord(value) || Object.keys(value).length !== STRIP_TOKEN_KEYS.length) {
    return err(`a strip palette report is not exactly the fields ${STRIP_TOKEN_KEYS.join(", ")}`);
  }
  const read: Partial<Record<keyof StripTokens, string>> = {};
  for (const key of STRIP_TOKEN_KEYS) {
    const colour = value[key];
    if (typeof colour !== "string" || !OKLCH.test(colour)) {
      return err(`a strip palette report's ${key} is not one plain oklch(L C H) colour`);
    }
    read[key] = colour;
  }
  return ok({
    bg: read.bg!,
    border: read.border!,
    card: read.card!,
    ink: read.ink!,
    muted: read.muted!,
    sidebar: read.sidebar!,
  });
}

/**
 * The strip in the look the console is wearing, so it blends into each look's background (the top bar changes with the
 * colour themes): its ground is
 * the look's sidebar, one step below the page as a browser's strip sits; a tab is the page's own ground; the tab
 * showing is the raised card; its edge is the look's border and its text the look's ink.
 *
 * @param tokens the console's colours
 * @returns the strip's colours
 */
export function stripPaletteOf({ tokens }: { tokens: StripTokens }): StripPalette {
  return {
    ground: tokens.sidebar,
    ink: tokens.ink,
    line: tokens.border,
    muted: tokens.muted,
    on: tokens.card,
    tab: tokens.bg,
  };
}

/**
 * The custom properties that put a palette on the strip page.
 *
 * @returns one value per property
 */
export function stripPaletteProperties({ palette }: { palette: StripPalette }): StripPaletteProperties {
  return {
    "--ground": palette.ground,
    "--ink": palette.ink,
    "--line": palette.line,
    "--muted": palette.muted,
    "--on": palette.on,
    "--tab": palette.tab,
  };
}

/**
 * The strip page: a script-free document that first paints in a neutral grey for the console's light or dark choice
 * (main pins the native appearance to it), then wears the look a console page reports, which its preload sets as
 * {@link stripPaletteProperties} on the root. Its preload draws {@link stripMarkup} into `#strip`; the window's buttons
 * sit in the left gap, which `data-controls="inset"` holds open and full screen closes. Its blank space moves the
 * window.
 *
 * @returns a `data:` URL
 */
export function stripDocument(): string {
  const css = [
    `:root{color-scheme:light dark;--ground:${STRIP_GROUND.light};--ink:#1d2027;--muted:#6b7180;--line:rgba(0,0,0,.1);--tab:rgba(255,255,255,.28);--on:rgba(255,255,255,.78)}`,
    `@media (prefers-color-scheme:dark){:root{--ground:${STRIP_GROUND.dark};--ink:#e7e9ee;--muted:#9aa0ad;--line:rgba(255,255,255,.1);--tab:rgba(255,255,255,.05);--on:rgba(255,255,255,.14)}}`,
    "html,body{margin:0;height:100%;background:var(--ground);overflow:hidden;font:12px/1 -apple-system,system-ui,sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none}",
    `#strip{display:flex;align-items:center;gap:4px;height:${String(STRIP_HEIGHT)}px;padding:0 8px;box-sizing:border-box;border-bottom:1px solid var(--line);-webkit-app-region:drag}`,
    "body[data-controls=inset] #strip{padding-left:84px}",
    "#strip button,#strip .tab{-webkit-app-region:no-drag}",
    ".nav{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--ink);font-size:18px;line-height:1;cursor:default}",
    ".nav:hover:not([disabled]){background:var(--tab)}.nav[disabled]{color:var(--muted);opacity:.45}",
    ".tabs{display:flex;align-items:center;gap:4px;min-width:0;flex:1;height:100%}",
    ".tab{display:flex;align-items:center;gap:6px;min-width:56px;max-width:220px;flex:1 1 220px;height:28px;padding:0 6px 0 10px;box-sizing:border-box;border-radius:8px;background:var(--tab);color:var(--muted);cursor:default}",
    ".tab.pinned{flex:0 1 auto;max-width:180px}",
    ".tab.selected{background:var(--on);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}",
    ".tab.dragging{opacity:.4}.tab.drop-before{box-shadow:inset 2px 0 0 #7c6cf0}.tab.drop-after{box-shadow:inset -2px 0 0 #7c6cf0}",
    ".title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}",
    ".icon{flex:none;width:14px;text-align:center;font-size:12px;opacity:.75}.tab.selected .icon{opacity:1}",
    ".new-tab{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:17px;line-height:1;cursor:default}",
    ".new-tab:hover{background:var(--tab);color:var(--ink)}",
    ".close{width:18px;height:18px;flex:none;border:0;border-radius:4px;background:transparent;color:inherit;font-size:14px;line-height:1;opacity:.55;cursor:default}",
    ".close:hover{opacity:1;background:var(--tab)}",
  ].join("");
  const html = `<!doctype html><meta charset="utf-8"><title>Slopweaver tabs</title><style>${css}</style><body><div id="strip"></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
