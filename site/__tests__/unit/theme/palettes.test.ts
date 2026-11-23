/*
 * Every palette measured against its own ground, from `THEME_PALETTES`, the same table `appearanceStylesheet`
 * renders, so a palette that reads badly cannot ship by drifting away from what was measured.
 */

import { describe, expect, it } from "vitest";

import { parseOklch, relativeLuminance } from "../../../lib/colorContrast";
import { appearanceStylesheet, VERDICT_INKS } from "../../../lib/theme";
import { THEME_PALETTES } from "../../../lib/themePalettes";
import { FOREGROUND_MEASURES, githubPillGrounds } from "./foregroundHarness";
import { PAIRS, type RENDERINGS, ratio, srgb } from "./paletteHarness";

describe("the palettes", () => {
  it("gives every family a light and a dark palette, all eighteen readable as oklch", () => {
    expect(PAIRS.length).toBe(18);
    for (const { palette } of PAIRS) {
      expect(Object.keys(palette).toSorted()).toEqual([
        "bg",
        "border",
        "card",
        "ink",
        "muted",
        "panel",
        "primary",
        "primaryInk",
        "sidebar",
      ]);
      for (const value of Object.values(palette)) {
        expect(parseOklch({ value }).lightness).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("puts body, secondary, link and verdict text at 4.5:1 or better on every ground, card, panel and sidebar", () => {
    const failing = PAIRS.flatMap(({ family, mode, palette }) => {
      const inks = { ...VERDICT_INKS[mode], ink: palette.ink, muted: palette.muted, primary: palette.primary };
      return (["bg", "card", "panel", "sidebar"] as const).flatMap((plane) =>
        Object.entries(inks)
          .filter(([, value]) => ratio({ background: palette[plane], foreground: value }) < 4.5)
          .map(([text]) => `${family}/${mode} ${text} on ${plane}`),
      );
    });
    expect(PAIRS.length).toBe(18);
    expect(failing).toEqual([]);
  });

  it("draws the dark verdict colours differently on the two screens, so measuring both is not measuring one twice", () => {
    const luminanceOn = ({ value, rendering }: { value: string; rendering: (typeof RENDERINGS)[number] }): number =>
      Number(relativeLuminance({ color: srgb({ rendering, value }) }).toFixed(4));
    expect(luminanceOn({ rendering: "srgb", value: VERDICT_INKS.dark.danger })).toBe(0.6424);
    expect(luminanceOn({ rendering: "display-p3", value: VERDICT_INKS.dark.danger })).toBe(0.6607);
    expect(luminanceOn({ rendering: "srgb", value: THEME_PALETTES.graphite.dark.bg })).toBe(
      luminanceOn({ rendering: "display-p3", value: THEME_PALETTES.graphite.dark.bg }),
    );
  });

  it("puts text on the accent at 4.5:1 or better, since a button's label is ordinary text", () => {
    const failing = PAIRS.filter(
      ({ palette }) => ratio({ background: palette.primary, foreground: palette.primaryInk }) < 4.5,
    ).map(({ family, mode }) => `${family}/${mode}`);
    expect(failing).toEqual([]);
  });

  it("makes a light palette light and a dark palette dark", () => {
    const lightness = ({ value }: { value: string }): number => parseOklch({ value }).lightness;
    const darkLight = PAIRS.filter(({ mode, palette }) => mode === "light" && lightness({ value: palette.bg }) <= 0.9);
    const lightDark = PAIRS.filter(({ mode, palette }) => mode === "dark" && lightness({ value: palette.bg }) >= 0.35);
    expect(darkLight.map(({ family }) => family)).toEqual([]);
    expect(lightDark.map(({ family }) => family)).toEqual([]);
  });

  it("puts the ground's colour at 4.5:1 or better on a solid verdict fill, an approve button's label included", () => {
    expect(PAIRS.length).toBe(18);
    expect(FOREGROUND_MEASURES.verdictFill()).toEqual([]);
  });

  it("puts white at 4.5:1 or better on each of GitHub's state grounds, the pull request page's pill", () => {
    expect(githubPillGrounds().map(({ name }) => name)).toEqual([
      "success",
      "danger",
      "done",
      "neutral",
      "success",
      "danger",
      "done",
      "neutral",
    ]);
    expect(FOREGROUND_MEASURES.githubPill()).toEqual([]);
  });

  it("renders one stylesheet block per family and mode, carrying all nine tokens, then one verdict block per mode, then the orb's ramps, then the Slack surface", () => {
    const css = appearanceStylesheet();
    expect(css.split("\n").length).toBe(28);
    expect(css).toContain(
      ':root[data-sw-family="purple"][data-sw-mode="light"]{--c-bg:oklch(0.97 0.014 300);--c-border:oklch(0.85 0.04 300);',
    );
    expect(css.match(/--c-primary-ink:/gu)!.length).toBe(18);
    expect(css).toContain(`:root[data-sw-mode="light"]{--a-success:${VERDICT_INKS.light.success};`);
    expect(css.match(/--a-danger:/gu)!.length).toBe(2);
  });
});
