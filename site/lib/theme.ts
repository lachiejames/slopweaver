/**
 * The console's appearance: a colour family and light or dark — two values each kept under its own key, and how
 * both reach the first paint.
 *
 * They are chosen together, never one at a time: each of the Settings modal's themes (`./themePresets.ts`) sets both
 * with the orb's colours, from the few combinations judged to look right. The
 * families in `./themePalettes.ts` are the palettes those themes draw from.
 *
 * The console wants several themes, not only light and dark:
 *
 * - more themes, like Chrome's default theme colours (a purple one, a red one, a green one for different
 *   Chrome profiles), each reading well in light AND dark — so a theme is a FAMILY with two palettes;
 * - glass that looks like the macOS dock, with our colour tints — drawn by edges and shadow over an OPAQUE fill,
 *   never by letting what is behind show through (a hundred percent opacity is the default for everything,
 *   `console-tw.css`);
 * - the setting is independent of macOS system settings — so light or dark is the console's own stored
 *   choice, and nothing here reads `prefers-color-scheme`.
 *
 * Every palette is the nine `--c-*` tokens every page already draws through (shadcn's variables are names for
 * them), so no page is restyled by hand. `./themePalettes.ts` is the ONE place a palette is written: this file's
 * `appearanceStylesheet` renders the CSS from `THEME_PALETTES`, and the unit test measures every ink against its own ground from the
 * same table, so what is measured is what is drawn.
 *
 * Each choice is kept in `localStorage` like the sidebar's shape (`components/console/preference.ts`): the
 * console is served from this machine's own origin, so the browser's storage IS the install's.
 */
import { DEFAULT_ORB_RAMP, orbRampDeclarations } from "./orbRamp";
import { SLACK_PALETTE, slackTintCss } from "./slackPalette";
import {
  THEME_FAMILIES,
  THEME_MODES,
  THEME_PALETTES,
  type ThemeFamily,
  type ThemeMode,
  type ThemePalette,
} from "./themePalettes";
import { THEME_PRESETS } from "./themePresets";

/** The four verdict colours one mode draws text in, each an `oklch(L C H)` colour. */
export interface VerdictInks {
  /** `--a-success`: done, merged, green. */
  readonly success: string;
  /** `--a-warning`: waiting, the owner's call, amber. */
  readonly warning: string;
  /** `--a-danger`: stalled, refused, a draft not yet sent. */
  readonly danger: string;
  /** `--a-info`: moving, a link out. */
  readonly info: string;
}

/**
 * The verdict colours per mode, shared by every family: they mean the same thing whatever the tint, so they are
 * not a family's to change. Written here rather than in `console-tw.css` for the reason the palettes are — the
 * unit test measures each against every family's glass, so a verdict word that sinks on one family cannot ship.
 */
export const VERDICT_INKS: Readonly<Record<ThemeMode, VerdictInks>> = {
  dark: {
    danger: "oklch(0.88 0.08 25)",
    info: "oklch(0.86 0.07 220)",
    success: "oklch(0.87 0.14 145)",
    warning: "oklch(0.89 0.12 80)",
  },
  light: {
    danger: "oklch(0.4 0.16 25)",
    info: "oklch(0.36 0.08 220)",
    success: "oklch(0.36 0.11 145)",
    warning: "oklch(0.39 0.09 70)",
  },
};

/**
 * The one block that makes every `.sw-slack` surface Slack's dark palette (`./slackPalette.ts`) whatever the console's
 * look. It sets the
 * surface's own `--slack-*` colours, and it re-points the console's shared tokens inside the surface — the words,
 * the muted words, the hairlines, the quiet fill and the four verdict colours — so a `text-muted-foreground`, a
 * `border-border` or a held draft's `text-warning` reads on the dark ground rather than in the light console's ink.
 * The verdict colours are `VERDICT_INKS.dark`'s literal values, never `var(--a-*)`, which Daylight sets to its light
 * inks. No family or mode selector: the surface is dark in all of them.
 *
 * @returns the CSS block, one line
 */
export function slackSurfaceBlock(): string {
  const slack = SLACK_PALETTE;
  const inks = VERDICT_INKS.dark;
  const declarations = [
    `--slack-bg:${slack.ground}`,
    `--slack-text:${slack.text}`,
    `--slack-muted:${slack.muted}`,
    `--slack-border:${slackTintCss({ tint: slack.border })}`,
    `--slack-link:${slack.link}`,
    `--slack-chip-bg:${slackTintCss({ tint: slack.chipFill })}`,
    `--slack-chip-text:${slack.chipText}`,
    `--slack-code-bg:${slackTintCss({ tint: slack.codeFill })}`,
    `--slack-code-text:${slack.codeText}`,
    "color-scheme:dark",
    "--foreground:var(--slack-text)",
    "--card-foreground:var(--slack-text)",
    "--muted-foreground:var(--slack-muted)",
    `--muted:${slackTintCss({ tint: slack.quietFill })}`,
    "--border:var(--slack-border)",
    "--input:var(--slack-border)",
    `--success:${inks.success}`,
    `--warning:${inks.warning}`,
    `--danger:${inks.danger}`,
    `--info:${inks.info}`,
  ];
  return `.sw-slack{${declarations.join(";")};}`;
}

/** The family a first visit opens in, before a choice is stored: Night sky's blue, the first look (`./themePresets.ts`). */
export const DEFAULT_THEME_FAMILY: ThemeFamily = "blue";

/** The mode a first visit opens in: dark, as the console always has. */
export const DEFAULT_THEME_MODE: ThemeMode = "dark";

/** The `localStorage` key the chosen family is kept under. */
export const THEME_FAMILY_STORAGE_KEY = "sw-theme-family";

/** The `localStorage` key light or dark is kept under. */
export const THEME_MODE_STORAGE_KEY = "sw-theme-mode";

/** The key the first four themes kept one combined id under, read once to carry an old choice forward. */
export const LEGACY_THEME_STORAGE_KEY = "sw-theme";

/** Every key whose change in another document can move the theme; `null` is that document's `localStorage.clear()`. */
const THEME_KEYS: ReadonlySet<string | null> = new Set([
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  null,
]);

/**
 * Whether a `storage` event for this key calls for re-reading the theme: a key that never moves it — the sidebar's
 * shape, an orb choice — never re-applies it.
 *
 * @param key the event's key, `null` for a cleared storage
 * @returns true when the family or mode may have changed
 */
export function themeMoves({ key }: { key: string | null }): boolean {
  return THEME_KEYS.has(key);
}

/** The `sessionStorage` key that remembers, for one window, that the desktop shell is showing this page. */
export const SURFACE_SESSION_STORAGE_KEY = "sw-surface";

/** The query parameter the desktop shell loads every page with: `?sw-surface=native`. */
export const SURFACE_PARAM = "sw-surface";

/** The four ids the earlier picker stored, and the family and mode each one now is. */
const LEGACY_THEMES: Readonly<Record<string, { readonly family: ThemeFamily; readonly mode: ThemeMode }>> = {
  "low-contrast-grey": { family: "graphite", mode: "dark" },
  "midnight-teal": { family: "teal", mode: "dark" },
  "paper-light": { family: "teal", mode: "light" },
  "warm-dark": { family: "amber", mode: "dark" },
};

/**
 * Whether a stored string is a family this console ships.
 *
 * @returns true for one of the ids in `THEME_FAMILIES`
 */
export function isThemeFamily(value: unknown): value is ThemeFamily {
  return THEME_FAMILIES.some((family) => family.id === value);
}

/**
 * Whether a stored string is light or dark.
 *
 * @returns true for `light` or `dark` — never `system`, which this console does not have
 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}

/**
 * The family and mode one of the earlier picker's ids now is, so a stored choice keeps its look.
 *
 * @param legacy a value read from the old `sw-theme` key
 * @returns the pair, or `undefined` for anything that was not one of the four ids
 */
export function migrateLegacyTheme({
  legacy,
}: {
  legacy: unknown;
}): { readonly family: ThemeFamily; readonly mode: ThemeMode } | undefined {
  if (typeof legacy !== "string" || !Object.hasOwn(LEGACY_THEMES, legacy)) {
    return undefined;
  }
  return LEGACY_THEMES[legacy];
}

/**
 * The family and mode a page shows for what storage holds, by the boot script's own rules, so the Settings modal's
 * looks and the painted page never disagree: a valid stored value wins; an ABSENT one takes the earlier `sw-theme`
 * id's half while that id is still stored (a read-only storage keeps it there for good); anything else is the
 * default.
 *
 * @param storedFamily the raw `sw-theme-family` value, `null` when absent
 * @param storedMode the raw `sw-theme-mode` value, `null` when absent
 * @param legacy the raw `sw-theme` value, `null` when absent
 * @returns the pair to paint and to match against the looks
 */
export function resolveStoredTheme({
  storedFamily,
  storedMode,
  legacy,
}: {
  storedFamily: unknown;
  storedMode: unknown;
  legacy: unknown;
}): { readonly family: ThemeFamily; readonly mode: ThemeMode } {
  const carried = migrateLegacyTheme({ legacy });
  let family: ThemeFamily = DEFAULT_THEME_FAMILY;
  if (isThemeFamily(storedFamily)) {
    family = storedFamily;
  } else if (storedFamily === null && carried !== undefined) {
    family = carried.family;
  }
  let mode: ThemeMode = DEFAULT_THEME_MODE;
  if (isThemeMode(storedMode)) {
    mode = storedMode;
  } else if (storedMode === null && carried !== undefined) {
    mode = carried.mode;
  }
  return { family, mode };
}

/** The CSS custom property names, in the order `ThemePalette` lists its fields. */
const TOKEN_NAMES: Readonly<Record<keyof ThemePalette, string>> = {
  bg: "--c-bg",
  border: "--c-border",
  card: "--c-card",
  ink: "--c-ink",
  muted: "--c-muted",
  panel: "--c-panel",
  primary: "--c-primary",
  primaryInk: "--c-primary-ink",
  sidebar: "--c-sidebar",
};

/** Narrows one of `TOKEN_NAMES`'s own keys back to the palette field it names. */
function isPaletteField(key: string): key is keyof ThemePalette {
  return Object.hasOwn(TOKEN_NAMES, key);
}

/**
 * The stylesheet that gives every family its two palettes, one block per `data-sw-family` × `data-sw-mode`, then
 * each mode its verdict colours (`VERDICT_INKS`), one block per `data-sw-mode`, then the orb's two ramp colours
 * (`./orbRamp.ts`) — the default on `:root`, then each theme's (`THEME_PRESETS`) on its own family and mode, so every
 * orb on the page is lit in the theme worn, whichever presence fills it — then the Slack surface's dark palette
 * (`slackSurfaceBlock`), the same in every theme.
 *
 * Rendered into the document head by the console's root layout. The selectors carry two attributes, so they
 * beat `console-tw.css`'s bare `:root` defaults whatever order the two sheets load in.
 *
 * @returns CSS text
 */
export function appearanceStylesheet(): string {
  const blocks: string[] = [];
  for (const family of THEME_FAMILIES) {
    for (const mode of THEME_MODES) {
      const palette = THEME_PALETTES[family.id][mode];
      const lines = Object.keys(TOKEN_NAMES)
        .filter(isPaletteField)
        .map((field) => `${TOKEN_NAMES[field]}:${palette[field]};`);
      blocks.push(`:root[data-sw-family="${family.id}"][data-sw-mode="${mode}"]{${lines.join("")}}`);
    }
  }
  for (const mode of THEME_MODES) {
    const inks = VERDICT_INKS[mode];
    blocks.push(
      `:root[data-sw-mode="${mode}"]{--a-success:${inks.success};--a-warning:${inks.warning};--a-danger:${inks.danger};--a-info:${inks.info};}`,
    );
  }
  blocks.push(`:root{${orbRampDeclarations({ ramp: DEFAULT_ORB_RAMP })}}`);
  for (const preset of THEME_PRESETS) {
    blocks.push(
      `:root[data-sw-family="${preset.family}"][data-sw-mode="${preset.mode}"]{${orbRampDeclarations({ ramp: preset.ramp })}}`,
    );
  }
  blocks.push(slackSurfaceBlock());
  return blocks.join("\n");
}

/**
 * The script that puts the stored family and mode on `<html>` before the first paint, and marks the
 * page as shown by the desktop shell when it was loaded with `?sw-surface=native`.
 *
 * Without it every load would paint the default and swap a frame later — a flash of the very colours the owner chose
 * to be rid of. A plain string is safe here because the only values in it are keys, ids and numbers from this
 * module, and every stored value is checked against them rather than interpolated.
 *
 * Its rules, each its own `try` so one throwing storage cannot cost another choice:
 * - family and mode are read independently; an invalid one is that dimension's default;
 * - while the old `sw-theme` id is still stored, each new key that is ABSENT is filled from it, one at a time,
 *   and the old key is removed only once both new keys read back valid — so a load that died between the two
 *   writes finishes the carry on the next one rather than losing half the choice;
 * - the surface is a shell capability, not a preference: `?sw-surface=native` stamps it and remembers it for this
 *   window only (`sessionStorage`), so a reload inside the shell keeps the shell's flat ground; any OTHER value of the query
 *   clears that memory and stamps nothing, and only a load with no query at all falls back to it. A tab that copies
 *   its opener's `sessionStorage` (a duplicated tab) does inherit the mark until it loads with a non-native value,
 *   and storage that refuses the removal keeps it, since nothing else could clear it.
 *
 * Nothing here reads the system's light or dark appearance: it is independent of macOS.
 *
 * @returns JavaScript source for an inline `<script>` in the document head
 */
export function appearanceBootScript(): string {
  const config = JSON.stringify({
    families: THEME_FAMILIES.map((family) => family.id),
    family: DEFAULT_THEME_FAMILY,
    familyKey: THEME_FAMILY_STORAGE_KEY,
    legacy: LEGACY_THEMES,
    legacyKey: LEGACY_THEME_STORAGE_KEY,
    mode: DEFAULT_THEME_MODE,
    modeKey: THEME_MODE_STORAGE_KEY,
    modes: THEME_MODES,
    param: SURFACE_PARAM,
    surfaceKey: SURFACE_SESSION_STORAGE_KEY,
  });
  return [
    `(function(c){`,
    `var d=document.documentElement,f=c.family,m=c.mode;`,
    // Each key is read on its own, an unreadable one as absent — exactly as the controls' `readPreference` reads it.
    `function g(k){try{return localStorage.getItem(k);}catch(e){return null;}}`,
    `try{`,
    `var sf=g(c.familyKey),sm=g(c.modeKey);`,
    `var lg=g(c.legacyKey);`,
    `var old=lg!==null&&Object.prototype.hasOwnProperty.call(c.legacy,lg)?c.legacy[lg]:null;`,
    `if(c.families.indexOf(sf)>=0){f=sf;}else if(sf===null&&old!==null){f=old.family;try{localStorage.setItem(c.familyKey,f);}catch(e){}}`,
    `if(c.modes.indexOf(sm)>=0){m=sm;}else if(sm===null&&old!==null){m=old.mode;try{localStorage.setItem(c.modeKey,m);}catch(e){}}`,
    `if(lg!==null&&c.families.indexOf(g(c.familyKey))>=0&&c.modes.indexOf(g(c.modeKey))>=0){`,
    `try{localStorage.removeItem(c.legacyKey);}catch(e){}`,
    `}`,
    `}catch(e){}`,
    `d.setAttribute("data-sw-family",f);`,
    `d.setAttribute("data-sw-mode",m);`,
    `var nat=false,q=null;`,
    `try{q=new URLSearchParams(location.search).get(c.param);}catch(e){}`,
    // A query naming the surface is authoritative either way; only its absence falls back to the window's memory.
    `if(q==="native"){nat=true;try{sessionStorage.setItem(c.surfaceKey,"native");}catch(e){}}`,
    `else if(q!==null){try{sessionStorage.removeItem(c.surfaceKey);}catch(e){}}`,
    `else{try{nat=sessionStorage.getItem(c.surfaceKey)==="native";}catch(e){}}`,
    `if(nat){d.setAttribute("data-sw-surface","native");}`,
    `})(${config});`,
  ].join("");
}
