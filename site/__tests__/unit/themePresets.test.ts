import { describe, expect, it } from "vitest";

import { isRampColour } from "../../lib/orbRamp";
import { DEFAULT_THEME_FAMILY, DEFAULT_THEME_MODE, isThemeFamily, isThemeMode } from "../../lib/theme";
import { presetWorn, THEME_PRESET_IDS, THEME_PRESETS } from "../../lib/themePresets";
import {
  DEFAULT_ORB_BACKING,
  DEFAULT_ORB_BACKING_OPACITY,
  isOrbBacking,
  isOrbBackingOpacity,
} from "../../lib/voiceStage";

describe("THEME_PRESETS", () => {
  it("offers six themes, one per id, in the ids' order, each under its own name", () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([...THEME_PRESET_IDS]);
    expect(THEME_PRESETS.map((preset) => `${preset.id}:${preset.name}`)).toEqual([
      "night-sky:Night sky",
      "deep-sea:Deep sea",
      "ember:Ember",
      "dusk:Dusk",
      "daylight:Daylight",
      "graphite:Graphite",
    ]);
  });

  it("sets only values every key's own reader accepts, so the boot script and the orb wear each one as given", () => {
    expect(THEME_PRESETS.length).toBeGreaterThan(0);
    expect(THEME_PRESETS.filter((preset) => !isThemeFamily(preset.family))).toEqual([]);
    expect(THEME_PRESETS.filter((preset) => !isThemeMode(preset.mode))).toEqual([]);
    expect(THEME_PRESETS.filter((preset) => !isOrbBacking(preset.backing))).toEqual([]);
    expect(THEME_PRESETS.filter((preset) => !isOrbBackingOpacity(preset.backingOpacity))).toEqual([]);
    expect(
      THEME_PRESETS.filter(
        (preset) => !isRampColour({ value: preset.ramp.dark }) || !isRampColour({ value: preset.ramp.light }),
      ),
    ).toEqual([]);
  });

  it("lights the orb in each theme's own two colours", () => {
    expect(THEME_PRESETS.map((preset) => `${preset.id}:${preset.ramp.dark}>${preset.ramp.light}`)).toEqual([
      "night-sky:#5B86D8>#F4E6C8",
      "deep-sea:#A36A00>#FFD54A",
      "ember:#D9771A>#FFD27A",
      "dusk:#5A6488>#C9C8E6",
      "daylight:#D9771A>#FFD27A",
      "graphite:#6E7787>#E6E9EF",
    ]);
  });

  it("sits every corner orb on the dark disc at full strength", () => {
    expect(THEME_PRESETS.map((preset) => `${preset.backing}@${preset.backingOpacity}`)).toEqual([
      "disc@100",
      "disc@100",
      "disc@100",
      "disc@100",
      "disc@100",
      "disc@100",
    ]);
  });

  it("opens on the blue-tinted dark, the pairing the owner named on the call, and ends on the plain graphite dark", () => {
    expect(THEME_PRESETS.map((preset) => `${preset.family}/${preset.mode}`)).toEqual([
      "blue/dark",
      "teal/dark",
      "amber/dark",
      "purple/dark",
      "graphite/light",
      "graphite/dark",
    ]);
  });

  it("carries no presence, so the presence the owner picked sticks whichever theme they wear", () => {
    expect(THEME_PRESETS.filter((preset) => Object.keys(preset).includes("look"))).toEqual([]);
    expect(THEME_PRESETS.filter((preset) => Object.keys(preset).includes("presence"))).toEqual([]);
  });

  it("never offers two themes that set the same family and mode, so the page's ramp follows the theme worn", () => {
    const keys = THEME_PRESETS.map((preset) => `${preset.family}|${preset.mode}`);
    expect(new Set(keys).size).toBe(THEME_PRESETS.length);
  });
});

describe("presetWorn", () => {
  it("finds each theme from its own four values", () => {
    expect(THEME_PRESETS.map((preset) => presetWorn({ values: preset })?.id)).toEqual([...THEME_PRESET_IDS]);
  });

  it("finds none when any one of the four differs", () => {
    const night = THEME_PRESETS[0];
    expect(presetWorn({ values: { ...night, family: "green" } })).toBeUndefined();
    expect(presetWorn({ values: { ...night, mode: "light" } })).toBeUndefined();
    expect(presetWorn({ values: { ...night, backing: "ring" } })).toBeUndefined();
    expect(presetWorn({ values: { ...night, backingOpacity: "90" } })).toBeUndefined();
  });

  it("finds Night sky in the console's first-visit defaults, so a first visit wears the first theme", () => {
    expect(
      presetWorn({
        values: {
          backing: DEFAULT_ORB_BACKING,
          backingOpacity: DEFAULT_ORB_BACKING_OPACITY,
          family: DEFAULT_THEME_FAMILY,
          mode: DEFAULT_THEME_MODE,
        },
      })!.id,
    ).toBe("night-sky");
  });

  it("finds the theme a family and mode belong to whichever presence is worn, since a theme never sets one", () => {
    const night = THEME_PRESETS[0];
    expect(presetWorn({ values: { ...night, family: "teal" } })!.id).toBe("deep-sea");
    expect(presetWorn({ values: { ...night, family: "graphite", mode: "light" } })!.id).toBe("daylight");
  });
});
