/*
 * The orb's colour: the ramp a theme supplies and how a canvas reads it, the gradient map's filter values number for
 * number, the grounds it is drawn over, and how the brightness gain follows who is talking.
 */
import { describe, expect, it } from "vitest";

import { ORB_MOODS } from "../../lib/orbMood";
import {
  DEFAULT_ORB_RAMP,
  hexChannels,
  isOrbGround,
  isRampColour,
  LIGHTNESS_SETTLED,
  lightnessOf,
  lightnessToward,
  ORB_GROUNDS,
  ORB_RAMP_DARK_PROPERTY,
  ORB_RAMP_LIGHT_PROPERTY,
  orbGroundOf,
  orbRampDeclarations,
  orbRampFromCss,
  orbRampStyle,
  RAMP_OPACITY_GAIN,
  rampChannels,
  rampGainOf,
  rampMatrix,
  rampOpacityMatrix,
  rampTable,
  rampToward,
} from "../../lib/orbRamp";

describe("the ramp a theme supplies", () => {
  it("is Night sky's ice-blue round a warm-white core where no theme names one", () => {
    expect(DEFAULT_ORB_RAMP).toEqual({ dark: "#5B86D8", light: "#F4E6C8" });
  });

  it("rides two custom properties the page sets and the canvas reads", () => {
    expect([ORB_RAMP_DARK_PROPERTY, ORB_RAMP_LIGHT_PROPERTY]).toEqual(["--sw-orb-ramp-dark", "--sw-orb-ramp-light"]);
    expect(orbRampDeclarations({ ramp: { dark: "#6E7787", light: "#E6E9EF" } })).toBe(
      "--sw-orb-ramp-dark:#6E7787;--sw-orb-ramp-light:#E6E9EF;",
    );
    expect(orbRampStyle({ ramp: { dark: "#6E7787", light: "#E6E9EF" } })).toEqual({
      "--sw-orb-ramp-dark": "#6E7787",
      "--sw-orb-ramp-light": "#E6E9EF",
    });
  });

  it("accepts a colour only as # and six hex digits", () => {
    expect(
      ["#5B86D8", "#f4e6c8", "5B86D8", "#5B86D", "#5B86D8FF", "blue", "", "#GGGGGG"].map((value) =>
        isRampColour({ value }),
      ),
    ).toEqual([true, true, false, false, false, false, false, false]);
  });

  it("reads a canvas's pair as given, trimmed of the whitespace a computed style carries", () => {
    expect(orbRampFromCss({ dark: " #6E7787", light: "#E6E9EF " })).toEqual({ dark: "#6E7787", light: "#E6E9EF" });
  });

  it("draws the default ramp whole when either half is missing or mangled, never half of two themes", () => {
    expect(orbRampFromCss({ dark: "", light: "" })).toEqual(DEFAULT_ORB_RAMP);
    expect(orbRampFromCss({ dark: "#6E7787", light: "" })).toEqual(DEFAULT_ORB_RAMP);
    expect(orbRampFromCss({ dark: "red", light: "#E6E9EF" })).toEqual(DEFAULT_ORB_RAMP);
  });
});

describe("hexChannels", () => {
  it("reads a colour's three channels, 0 to 1", () => {
    expect(hexChannels({ hex: "#000000" })).toEqual([0, 0, 0]);
    expect(hexChannels({ hex: "#FFFFFF" })).toEqual([1, 1, 1]);
    expect(hexChannels({ hex: "#5B86D8" })).toEqual([91 / 255, 134 / 255, 216 / 255]);
  });
});

describe("the gradient map", () => {
  it("reads brightness by the sRGB weights, times the gain, on all three channels", () => {
    expect(rampMatrix({ gain: 1 })).toBe(
      "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0",
    );
    expect(rampMatrix({ gain: 1.2 })).toBe(
      "0.2551 0.8582 0.0866 0 0 0.2551 0.8582 0.0866 0 0 0.2551 0.8582 0.0866 0 0 0 0 0 1 0",
    );
  });

  it("on a dark ground maps each channel through black, the dark colour, the light colour and white", () => {
    const ramp = rampChannels({ ramp: { dark: "#5B86D8", light: "#F4E6C8" } });
    expect(([0, 1, 2] as const).map((channel) => rampTable({ channel, lightness: 0, ramp }))).toEqual([
      "0 0.3569 0.9569 1",
      "0 0.5255 0.9020 1",
      "0 0.8471 0.7843 1",
    ]);
  });

  // Daylight's orb on its pale page must not read as blotches, so it stays within the theme's two colours.
  it("on a light ground never leaves the theme's two colours: the light one faint, deepening to the dark one", () => {
    const ramp = rampChannels({ ramp: { dark: "#D9771A", light: "#FFD27A" } });
    expect(([0, 1, 2] as const).map((channel) => rampTable({ channel, lightness: 1, ramp }))).toEqual([
      "1.0000 1.0000 0.8510 0.8510",
      "0.8235 0.8235 0.4667 0.4667",
      "0.4784 0.4784 0.1020 0.1020",
    ]);
  });

  it("eases between the two tables stop by stop, held to the two ends", () => {
    const ramp = rampChannels({ ramp: { dark: "#D9771A", light: "#FFD27A" } });
    expect(rampTable({ channel: 0, lightness: 0.5, ramp })).toBe("0.5000 0.9255 0.9255 0.9255");
    expect(rampTable({ channel: 0, lightness: -1, ramp })).toBe("0 0.8510 1.0000 1");
    expect(rampTable({ channel: 0, lightness: 2, ramp })).toBe("1.0000 1.0000 0.8510 0.8510");
  });

  it("settles a dark ground at 0 and a light one at 1", () => {
    expect(lightnessOf({ ground: "dark" })).toBe(0);
    expect(lightnessOf({ ground: "light" })).toBe(1);
  });

  it("steps a lightness toward its ground's, and lands on it exactly once within the settle", () => {
    expect(lightnessToward({ from: 0, ground: "light", share: 0.25 })).toBe(0.25);
    expect(lightnessToward({ from: 1, ground: "dark", share: 0.5 })).toBe(0.5);
    expect(lightnessToward({ from: 0.00015, ground: "dark", share: 0.5 })).toBe(0);
    expect(lightnessToward({ from: 0.99985, ground: "light", share: 0.5 })).toBe(1);
    expect(lightnessToward({ from: 0, ground: "dark", share: 0.5 })).toBe(0);
    expect(LIGHTNESS_SETTLED).toBe(0.0001);
  });

  it("makes the brightness before the ramp the opacity, so every presence fades at the same light", () => {
    expect(RAMP_OPACITY_GAIN).toBe(4);
    expect(rampOpacityMatrix()).toBe("0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 0");
  });

  it("eases from one ramp toward another by the share asked", () => {
    const from = { dark: [0, 0, 0], light: [1, 1, 1] };
    const to = { dark: [1, 0.5, 0], light: [0, 0.5, 1] };
    expect(rampToward({ from, share: 0, to })).toEqual(from);
    expect(rampToward({ from, share: 1, to })).toEqual(to);
    expect(rampToward({ from, share: 0.5, to })).toEqual({ dark: [0.5, 0.25, 0], light: [0.5, 0.75, 1] });
  });
});

describe("the grounds", () => {
  it("are exactly dark and light", () => {
    expect(ORB_GROUNDS).toEqual(["dark", "light"]);
    expect(["dark", "light", "Light", "", undefined, 1].map((value) => isOrbGround(value))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("take the nearest container's ground over the page's mode, a page's mode over nothing, and dark otherwise", () => {
    expect(orbGroundOf({ ancestor: "light", mode: "dark" })).toBe("light");
    expect(orbGroundOf({ ancestor: "dark", mode: "light" })).toBe("dark");
    expect(orbGroundOf({ ancestor: null, mode: "light" })).toBe("light");
    expect(orbGroundOf({ ancestor: "paper", mode: "light" })).toBe("light");
    expect(orbGroundOf({ ancestor: undefined, mode: null })).toBe("dark");
    expect(orbGroundOf({ ancestor: "paper", mode: "sepia" })).toBe("dark");
  });
});

// The owner's colour and the voice's must stay clearly distinct — here, by brightness, never by hue.
describe("rampGainOf", () => {
  it("dims the orb while the owner talks, burns it hotter while the voice does, and leaves every other mood alone", () => {
    expect(rampGainOf({ mood: "hearing" })).toBe(0.8);
    expect(rampGainOf({ mood: "speaking" })).toBe(1.2);
    expect(ORB_MOODS.length).toBeGreaterThan(0);
    expect(
      ORB_MOODS.filter((mood) => mood !== "hearing" && mood !== "speaking").filter(
        (mood) => rampGainOf({ mood }) !== 1,
      ),
    ).toEqual([]);
  });
});
