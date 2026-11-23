/*
 * The registry of every fixed and data-driven text colour the components draw, and the measurement that answers for
 * each kind of it: `DATA_TEXT` names a measure, `FOREGROUND_MEASURES` runs it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { INTEGRATION_KINDS, PLACE_KINDS, WEB_KIND } from "../../../lib/citationKinds";
import { CODE_THEMES } from "../../../lib/codeThemes";
import {
  compositeSrgb,
  parseHex,
  parseOklch,
  relativeLuminance,
  type SrgbColor,
  srgbContrastRatio,
  srgbToOklch,
} from "../../../lib/colorContrast";
import { VERDICT_INKS } from "../../../lib/theme";
import { THEME_MODES } from "../../../lib/themePalettes";
import {
  type ColourBox,
  drawn,
  luminanceRatio,
  mixOklab,
  PAIRS,
  PLANES,
  RENDERINGS,
  ratio,
  srgb,
} from "./paletteHarness";
import { isObject } from "./sourceHarness";

/**
 * Every text colour a component sets from data, as Tailwind's fixed white or black, or as an SVG `<text>`'s
 * `fill`, rather than as a token — with what measures it. "measures every fixed and data-driven text colour" holds
 * this list to the components both ways, so a new one cannot ship unmeasured. `${…}` in a source is written `<…>`.
 * `by` names a `FOREGROUND_MEASURES` entry, each run by a test of its own, or one of two `UNMEASURED` reasons.
 */
export const DATA_TEXT: readonly {
  by: keyof typeof FOREGROUND_MEASURES | keyof typeof UNMEASURED;
  file: string;
  text: string;
}[] = [
  { by: "highlighter", file: "ai-elements/code-block.tsx", text: "token.color" },
  { by: "inherit", file: "ai-elements/code-block.tsx", text: '"inherit"' },
  { by: "highlighter", file: "ai-elements/code-block.tsx", text: "tokenized.fg" },
  { by: "avatar", file: "console/Avatar.tsx", text: "text-white" },
  { by: "avatar", file: "console/SlackDraft.tsx", text: "text-white" },
  { by: "githubPill", file: "console/PullViewHeader.tsx", text: "text-white" },
  { by: "chip", file: "console/CitationChip.tsx", text: "`color-mix(in oklab, <colour> 25%, var(--foreground))`" },
  { by: "chip", file: "console/PersonChip.tsx", text: "`color-mix(in oklab, <colour> 25%, var(--foreground))`" },
  {
    by: "chip",
    file: "console/PullPersonChip.tsx",
    text: "`color-mix(in oklab, <GITHUB.colour> 25%, var(--foreground))`",
  },
  { by: "icon", file: "console/CitationMark.tsx", text: "kind.colour" },
  // Hang-up's phone glyph on its fixed red, `aria-hidden`; `stageRail.test.ts` measures white on HANG_UP_FILL anyway.
  { by: "icon", file: "voice/StageControls.tsx", text: "text-white" },
  { by: "verdictFill", file: "console/HandShot.tsx", text: 'fill="var(--background)"' },
  { by: "shimmer", file: "ai-elements/shimmer.tsx", text: "text-transparent" },
  { by: "hidden", file: "console/ShellCount.tsx", text: "group-data-[sidebar=icons]/console:text-transparent" },
];

/** The registered foregrounds no measurement covers, and why none is owed. */
const UNMEASURED = {
  hidden: "a nav badge's count at `text-[0px]`, drawn as a dot with no text when the sidebar is icons",
  icon: "an `aria-hidden` glyph beside the record's own words, which carries no text",
  inherit: "the measured text around it",
} as const;

/** A theme colour as drawn on `under`: `#rgb`, `#rrggbb`, or `#rrggbbaa` composited over it. */
function themeColour({ value, under }: { value: string; under: SrgbColor }): SrgbColor {
  const hex = value.toLowerCase();
  if (/^#[0-9a-f]{3}$/u.test(hex)) {
    return parseHex({ value: `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` });
  }
  if (/^#[0-9a-f]{8}$/u.test(hex)) {
    return compositeSrgb({
      alpha: Number.parseInt(hex.slice(7), 16) / 255,
      background: under,
      foreground: parseHex({ value: hex.slice(0, 7) }),
    });
  }
  return parseHex({ value: hex });
}

/**
 * One highlighter theme's ground and every foreground it can draw on it: the editor's own ink, and each token
 * rule's colour on that rule's background where it sets one. `theme` is the registration a renderer is given —
 * `CODE_THEMES` from `lib/codeThemes.ts`, the very objects both of the console's code renderers draw with.
 *
 * @returns the theme's ground and each foreground with the ground it sits on
 */
export function codeTheme({ theme }: { theme: unknown }): {
  ground: SrgbColor;
  foregrounds: { name: string; colour: SrgbColor; on: SrgbColor }[];
} {
  if (!isObject(theme) || !isObject(theme.colors) || !Array.isArray(theme.tokenColors)) {
    throw new Error("highlighter theme has no colours and token rules");
  }
  const groundValue = theme.colors["editor.background"];
  const inkValue = theme.colors["editor.foreground"];
  if (typeof groundValue !== "string" || typeof inkValue !== "string") {
    throw new Error("highlighter theme has no editor ground and ink");
  }
  const ground = themeColour({ under: { blue: 1, green: 1, red: 1 }, value: groundValue });
  const foregrounds = [{ colour: themeColour({ under: ground, value: inkValue }), name: "editor ink", on: ground }];
  for (const rule of theme.tokenColors) {
    if (!isObject(rule) || !isObject(rule.settings) || typeof rule.settings.foreground !== "string") {
      continue;
    }
    let on = ground;
    if (typeof rule.settings.background === "string") {
      on = themeColour({ under: ground, value: rule.settings.background });
    }
    foregrounds.push({
      colour: themeColour({ under: on, value: rule.settings.foreground }),
      name: String(rule.scope),
      on,
    });
  }
  return { foregrounds, ground };
}

/** An avatar's fill, `oklch(0.5 0.13 <hue>)` in `Avatar.tsx` and `SlackDraft.tsx`, which must move with it. */
export const AVATAR_FILL = { chroma: 0.13, lightness: 0.5 } as const;

/** A chip's fill, its integration's colour at 15% (`CitationChip.tsx`, `PersonChip.tsx`, `PullPersonChip.tsx`). */
export const CHIP_TINT = 0.15;

/** A chip's words, its integration's colour mixed 25% into ink — the `DATA_TEXT` chip entries. */
const CHIP_INK_SHARE = 0.25;

/**
 * GitHub's solid state grounds as `console-tw.css` declares them, dark block then light.
 *
 * @returns each state ground's name and hex, in stylesheet order
 */
export function githubPillGrounds(): { name: string; hex: string }[] {
  const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8");
  return [...css.matchAll(/--gh-(?<name>[a-z]+)-emphasis: (?<hex>#[0-9a-f]{6});/gu)].map((match) => ({
    hex: match.groups!["hex"],
    name: match.groups!["name"],
  }));
}

/** Every integration a chip or mark can be drawn for: the registry, the places and the web. */
export const ALL_KINDS = [...INTEGRATION_KINDS, ...Object.values(PLACE_KINDS), WEB_KIND];

/** The smallest box holding every colour given, channel by channel. */
function boxAround({ colours }: { colours: readonly SrgbColor[] }): ColourBox {
  const channel = ({ pick, of }: { pick: "red" | "green" | "blue"; of: "low" | "high" }): number => {
    const values = colours.map((colour) => colour[pick]);
    if (of === "low") {
      return Math.min(...values);
    }
    return Math.max(...values);
  };
  return {
    high: {
      blue: channel({ of: "high", pick: "blue" }),
      green: channel({ of: "high", pick: "green" }),
      red: channel({ of: "high", pick: "red" }),
    },
    low: {
      blue: channel({ of: "low", pick: "blue" }),
      green: channel({ of: "low", pick: "green" }),
      red: channel({ of: "low", pick: "red" }),
    },
  };
}

/**
 * What measures each kind of `DATA_TEXT` foreground: every case it covers, the ones under 4.5:1 returned. Each is
 * run by a test of its own below, so a registry entry can only name a measurement that runs.
 */
export const FOREGROUND_MEASURES = {
  /** White on `AVATAR_FILL` at every hue `avatarHue` returns, on both screens. */
  avatar: (): string[] =>
    RENDERINGS.flatMap((rendering) =>
      Array.from({ length: 360 }, (_, hue) => hue)
        .filter(
          (hue) =>
            srgbContrastRatio({
              background: drawn({ color: { ...AVATAR_FILL, hue }, rendering }),
              foreground: parseHex({ value: "#ffffff" }),
            }) < 4.5,
        )
        .map((hue) => `${rendering} hue ${String(hue)}`),
    ),

  /**
   * An integration's colour mixed `CHIP_INK_SHARE` into ink, on its `CHIP_TINT` over every opaque plane, for every
   * integration, palette and screen.
   */
  chip: (): string[] => {
    const failing: string[] = [];
    for (const rendering of RENDERINGS) {
      for (const { family, mode, palette } of PAIRS) {
        const ink = parseOklch({ value: palette.ink });
        for (const plane of PLANES) {
          const fill = srgb({ rendering, value: palette[plane] });
          for (const kind of ALL_KINDS) {
            const colour = parseHex({ value: kind.colour });
            const words = drawn({
              color: mixOklab({ a: srgbToOklch({ color: colour }), b: ink, share: CHIP_INK_SHARE }),
              rendering,
            });
            const tinted = compositeSrgb({ alpha: CHIP_TINT, background: fill, foreground: colour });
            if (srgbContrastRatio({ background: tinted, foreground: words }) < 4.5) {
              failing.push(`${rendering} ${family}/${mode} ${kind.id} chip on ${plane}`);
            }
          }
        }
      }
    }
    return failing;
  },

  /**
   * Every token colour of both `CODE_THEMES` on its own ground, and muted line numbers on that ground — the objects
   * `code-block.tsx` and Streamdown's code plugin both draw with, and line numbers both draw in full muted ink.
   */
  highlighter: (): string[] => {
    const failing: string[] = [];
    for (const mode of THEME_MODES) {
      const theme = CODE_THEMES[mode];
      const { foregrounds, ground } = codeTheme({ theme });
      for (const { colour, name, on } of foregrounds) {
        if (srgbContrastRatio({ background: on, foreground: colour }) < 4.5) {
          failing.push(`${String(theme.name)} ${name}`);
        }
      }
      for (const rendering of RENDERINGS) {
        for (const { family, palette } of PAIRS.filter((pair) => pair.mode === mode)) {
          if (srgbContrastRatio({ background: ground, foreground: srgb({ rendering, value: palette.muted }) }) < 4.5) {
            failing.push(`${rendering} ${family}/${mode} line numbers on ${String(theme.name)}`);
          }
        }
      }
    }
    return failing;
  },

  /**
   * The "Thinking…" shimmer: transparent text clipped to a muted base with an ink highlight composited over it, so
   * every glyph pixel is a per-channel blend of the two — inside their box, whose darkest and lightest corners are
   * measured on every opaque plane, a control's ground among them.
   */
  shimmer: (): string[] => {
    const failing: string[] = [];
    for (const rendering of RENDERINGS) {
      for (const { family, mode, palette } of PAIRS) {
        const box = boxAround({
          colours: [srgb({ rendering, value: palette.muted }), srgb({ rendering, value: palette.ink })],
        });
        const ends = [box.low, box.high].map((color) => relativeLuminance({ color }));
        for (const plane of PLANES) {
          const fill = relativeLuminance({ color: srgb({ rendering, value: palette[plane] }) });
          if (Math.min(...ends.map((text) => luminanceRatio({ one: text, two: fill }))) < 4.5) {
            failing.push(`${rendering} ${family}/${mode} shimmer on ${plane}`);
          }
        }
      }
    }
    return failing;
  },

  /** White on each of GitHub's solid state grounds, in both modes — the pull request page's state pill. */
  githubPill: (): string[] =>
    githubPillGrounds()
      .filter(
        ({ hex }) =>
          srgbContrastRatio({ background: parseHex({ value: hex }), foreground: parseHex({ value: "#ffffff" }) }) < 4.5,
      )
      .map(({ name, hex }) => `white on ${name} ${hex}`),

  /** The ground's colour on every solid verdict fill, in every palette and on both screens. */
  verdictFill: (): string[] =>
    PAIRS.flatMap(({ family, mode, palette }) =>
      Object.entries(VERDICT_INKS[mode])
        .filter(([, fill]) => ratio({ background: fill, foreground: palette.bg }) < 4.5)
        .map(([verdict]) => `${family}/${mode} bg on ${verdict}`),
    ),
};
