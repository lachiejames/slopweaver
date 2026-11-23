/*
 * Text on the opaque planes: body, secondary, link and verdict text on every plane and nested control, on both
 * screens, and the tints the components lay under a word held to the strongest one measured.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compositeSrgb, srgbContrastRatio } from "../../../lib/colorContrast";
import { VERDICT_INKS } from "../../../lib/theme";
import { OWN_TINT_MAX, PAIRS, PLANES, RENDERINGS, srgb } from "./paletteHarness";
import { sourceFiles } from "./sourceHarness";

/**
 * The strongest accent highlight under body text: a `bg-primary/25` mention chip, a selected option. An accent
 * WORD never sits on an accent tint — measured, `text-primary` on its own 15% tint fell under 4.5:1 in 14 of 18
 * palettes (spread `primary: palette.primary` into the tint test's verdict inks below and run this file) —
 * so a tinted chip draws in `text-foreground` and the tint and border carry the colour.
 */
const PRIMARY_UNDER_INK_MAX = 0.25;

/** A fill this opaque or more is a solid button, measured by the solid-fill tests rather than as a tint. */
const SOLID_FROM = 90;

describe("contrast on the opaque planes", () => {
  it("reads at 4.5:1 or better on every opaque plane and every control nested in one, body, secondary, link and verdict text alike, on both screens", () => {
    const failing: string[] = [];
    for (const rendering of RENDERINGS) {
      for (const { family, mode, palette } of PAIRS) {
        // `primary` is text too: every `<a>` (`console-tw.css`) and each `text-primary` button draws in it.
        const inks = Object.entries({
          ...VERDICT_INKS[mode],
          ink: palette.ink,
          muted: palette.muted,
          primary: palette.primary,
        });
        // A control's fill is the page's own ground, opaque, whatever plane it sits in.
        const grounds = [
          ...PLANES.map((plane) => ({ fill: srgb({ rendering, value: palette[plane] }), where: plane })),
          { fill: srgb({ rendering, value: palette.bg }), where: "a control" },
        ];
        for (const { fill, where } of grounds) {
          for (const [text, value] of inks) {
            if (srgbContrastRatio({ background: fill, foreground: srgb({ rendering, value }) }) < 4.5) {
              failing.push(`${rendering} ${family}/${mode} ${text} on ${where}`);
            }
          }
        }
      }
    }
    expect(PAIRS.length).toBe(18);
    expect(failing).toEqual([]);
  });

  it("reads a verdict word on its own strongest tint, and body text on the strongest accent highlight, at 4.5:1 or better on every opaque plane", () => {
    const failing: string[] = [];
    for (const rendering of RENDERINGS) {
      for (const { family, mode, palette } of PAIRS) {
        const accent = srgb({ rendering, value: palette.primary });
        const body = srgb({ rendering, value: palette.ink });
        for (const plane of PLANES) {
          const fill = srgb({ rendering, value: palette[plane] });
          for (const [colour, value] of Object.entries(VERDICT_INKS[mode])) {
            const ink = srgb({ rendering, value });
            const tinted = compositeSrgb({ alpha: OWN_TINT_MAX, background: fill, foreground: ink });
            if (srgbContrastRatio({ background: tinted, foreground: ink }) < 4.5) {
              failing.push(`${rendering} ${family}/${mode} ${colour} on its tint on ${plane}`);
            }
          }
          const highlight = compositeSrgb({ alpha: PRIMARY_UNDER_INK_MAX, background: fill, foreground: accent });
          if (srgbContrastRatio({ background: highlight, foreground: body }) < 4.5) {
            failing.push(`${rendering} ${family}/${mode} ink on the accent highlight on ${plane}`);
          }
        }
      }
    }
    expect(PAIRS.length).toBe(18);
    expect(failing).toEqual([]);
  });

  it("keeps every tint in the components at or under the strongest one measured for what is drawn on it", () => {
    const files = sourceFiles({ dir: join(import.meta.dirname, "../../../components") });
    const over: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        // Both spellings of an alpha: `bg-danger/15` and `bg-danger/[0.15]`.
        // `destructive` is the danger ink under shadcn's name (`--destructive: var(--a-danger)`).
        for (const match of line.matchAll(
          /bg-(success|warning|danger|destructive|info|primary)\/(?:(\d+)|\[(0?\.\d+)\])/g,
        )) {
          let percent = Number(match[2]);
          if (match[2] === undefined) {
            percent = Number(match[3]) * 100;
          }
          // An accent word on an accent tint has no cap that reads: any tint at all on its line is over it.
          let cap = OWN_TINT_MAX * 100;
          if (match[1] === "primary") {
            cap = PRIMARY_UNDER_INK_MAX * 100;
            if (/text-primary(?![-\w])/.test(line)) {
              cap = 0;
            }
          }
          if (percent > cap && percent < SOLID_FROM) {
            over.push(`${file}: ${match[0]}`);
          }
        }
      }
    }
    expect(files.length).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });

  it("draws no component in a stock Tailwind palette colour, which no theme measures and no mode moves", () => {
    const files = sourceFiles({ dir: join(import.meta.dirname, "../../../components") });
    const stock =
      /\b(?:text|bg|border|ring|fill|stroke|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;
    const found = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(stock)].map((match) => `${file}: ${match[0]}`),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
