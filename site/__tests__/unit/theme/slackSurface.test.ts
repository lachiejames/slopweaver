/*
 * The Slack surface, dark in every look: its stylesheet block and every word it draws on its own ground.
 */

import { describe, expect, it } from "vitest";

import {
  compositeSrgb,
  oklchToSrgb,
  parseHex,
  parseOklch,
  type SrgbColor,
  srgbContrastRatio,
} from "../../../lib/colorContrast";
import { DEFAULT_ORB_RAMP, orbRampDeclarations } from "../../../lib/orbRamp";
import { SLACK_PALETTE, type SlackTint } from "../../../lib/slackPalette";
import { appearanceStylesheet, slackSurfaceBlock, VERDICT_INKS } from "../../../lib/theme";
import { THEME_PRESETS } from "../../../lib/themePresets";
import { OWN_TINT_MAX } from "./paletteHarness";

describe("the Slack surface, dark in every look (the owner's Slack is dark)", () => {
  const ground = parseHex({ value: SLACK_PALETTE.ground });
  /** A tint as the eye sees it, laid over Slack's ground. */
  const laid = ({ tint }: { tint: SlackTint }): SrgbColor =>
    compositeSrgb({ alpha: tint.alpha, background: ground, foreground: parseHex({ value: tint.colour }) });
  /** A verdict ink, `oklch(…)`, as the browser draws it. */
  const ink = ({ value }: { value: string }): SrgbColor => oklchToSrgb({ color: parseOklch({ value }) });

  it("renders the one Slack block last, exactly, with no family or mode selector", () => {
    const dark = VERDICT_INKS.dark;
    expect(slackSurfaceBlock()).toBe(
      ".sw-slack{--slack-bg:#1a1d21;--slack-text:#d1d2d3;--slack-muted:#ababad;--slack-border:rgb(209 210 211 / 13%);" +
        "--slack-link:#1d9bd1;--slack-chip-bg:rgb(29 155 209 / 10%);--slack-chip-text:#1d9bd1;" +
        "--slack-code-bg:rgb(232 232 232 / 4%);--slack-code-text:#e8912d;color-scheme:dark;" +
        "--foreground:var(--slack-text);--card-foreground:var(--slack-text);--muted-foreground:var(--slack-muted);" +
        "--muted:rgb(232 232 232 / 13%);--border:var(--slack-border);--input:var(--slack-border);" +
        `--success:${dark.success};--warning:${dark.warning};--danger:${dark.danger};--info:${dark.info};}`,
    );
    const lines = appearanceStylesheet().split("\n");
    expect(lines.at(-1)).toBe(slackSurfaceBlock());
    expect(lines.filter((line) => line.includes("sw-slack")).length).toBe(1);
  });

  it("lights the orb in the default ramp, then in each theme's own under its family and mode, just before the Slack block", () => {
    const lines = appearanceStylesheet().split("\n");
    expect(THEME_PRESETS.length).toBeGreaterThan(0);
    expect(lines.slice(-(THEME_PRESETS.length + 2), -1)).toEqual([
      `:root{${orbRampDeclarations({ ramp: DEFAULT_ORB_RAMP })}}`,
      ...THEME_PRESETS.map(
        (preset) =>
          `:root[data-sw-family="${preset.family}"][data-sw-mode="${preset.mode}"]{${orbRampDeclarations({ ramp: preset.ramp })}}`,
      ),
    ]);
    expect(lines.at(-8)).toBe(":root{--sw-orb-ramp-dark:#5B86D8;--sw-orb-ramp-light:#F4E6C8;}");
  });

  it("puts every word the surface draws at 4.5:1 or better on its own ground", () => {
    const words = [
      {
        name: "text",
        ratio: srgbContrastRatio({ background: ground, foreground: parseHex({ value: SLACK_PALETTE.text }) }),
      },
      {
        name: "muted",
        ratio: srgbContrastRatio({ background: ground, foreground: parseHex({ value: SLACK_PALETTE.muted }) }),
      },
      {
        name: "link",
        ratio: srgbContrastRatio({ background: ground, foreground: parseHex({ value: SLACK_PALETTE.link }) }),
      },
      {
        name: "chip",
        ratio: srgbContrastRatio({
          background: laid({ tint: SLACK_PALETTE.chipFill }),
          foreground: parseHex({ value: SLACK_PALETTE.chipText }),
        }),
      },
      {
        name: "code",
        ratio: srgbContrastRatio({
          background: laid({ tint: SLACK_PALETTE.codeFill }),
          foreground: parseHex({ value: SLACK_PALETTE.codeText }),
        }),
      },
      {
        name: "app-badge",
        ratio: srgbContrastRatio({
          background: laid({ tint: SLACK_PALETTE.quietFill }),
          foreground: parseHex({ value: SLACK_PALETTE.muted }),
        }),
      },
    ];
    expect(words.length).toBe(6);
    expect(words.filter((word) => word.ratio < 4.5).map((word) => word.name)).toEqual([]);
  });

  it("puts every dark verdict ink at 4.5:1 or better on the ground and on its own strongest tint, Daylight included", () => {
    const inks = Object.entries(VERDICT_INKS.dark).map(([name, value]) => ({ name, srgb: ink({ value }) }));
    expect(inks.map((one) => one.name).toSorted()).toEqual(["danger", "info", "success", "warning"]);
    const sunk = inks.flatMap((one) => {
      const tinted = compositeSrgb({ alpha: OWN_TINT_MAX, background: ground, foreground: one.srgb });
      return [
        { on: "ground", ratio: srgbContrastRatio({ background: ground, foreground: one.srgb }) },
        { on: "tint", ratio: srgbContrastRatio({ background: tinted, foreground: one.srgb }) },
      ]
        .filter((pair) => pair.ratio < 4.5)
        .map((pair) => `${one.name} on ${pair.on}`);
    });
    expect(sunk).toEqual([]);
  });
});
